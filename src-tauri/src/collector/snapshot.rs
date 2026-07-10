//! Assemblage du `Snapshot` unique envoyé au front : jauges, MCPs, compte,
//! méta (voir `docs/specs/2026-07-09-junimo.md`).
//!
//! Combine les trois collecteurs (`config`, `transcripts`, `windows`),
//! résout les plafonds par défaut / réglages utilisateur, et calcule
//! l'activité du jour. Le JSON produit par `serde_json::to_value(&Snapshot)`
//! doit correspondre EXACTEMENT au contrat TypeScript déjà implémenté par le
//! front (noms de champs `snake_case` inclus) : ne jamais ajouter de
//! `#[serde(rename_all = ...)]` sur les structs de ce module.

use super::config::{self, ConfigData, McpServer};
use super::transcripts::{self, UsageEvent};
use super::windows::{self, Caps, Gauges};
use chrono::{DateTime, Duration, Local, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Fenêtre de scan des transcripts en amont des jauges : 8 jours, pour
/// couvrir la fenêtre glissante de 7 jours avec une marge de sécurité (même
/// ordre de grandeur que `MTIME_CUTOFF_DAYS` dans `transcripts.rs`).
const SNAPSHOT_LOOKBACK_DAYS: i64 = 8;

/// Plafonds par défaut, en tokens pondérés — **estimations** (aucune valeur
/// officielle n'est publiée par Anthropic), ajustables dans les réglages de
/// l'app (`junimo-settings.json`, voir [`AppSettings`]).
///
/// Calibrage Max 5x (2026-07-10) par **résolution deux points** : deux
/// lectures de `/usage` (session 7 % puis 12 %) croisées avec les
/// composantes locales ont résolu le poids du cache read (~0,01, voir
/// `WEIGHT_CACHE_READ`) et le plafond session (~3,9M pondérés) — les deux
/// points se vérifient à 0,1 % près. Plafonds hebdo déduits du même
/// instant : semaine 12,9M pondérés = 2 % → ~650M ; Fable/Opus 6,4M = 4 %
/// → ~160M. Pro ≈ 1/5 de Max 5x, Max 20x ≈ 4× (ratios annoncés des plans).
pub const DEFAULT_CAPS_PRO: Caps = Caps {
    block_5h: 780_000,
    weekly: 130_000_000,
    weekly_fable: 32_000_000,
};
pub const DEFAULT_CAPS_MAX_5X: Caps = Caps {
    block_5h: 3_900_000,
    weekly: 650_000_000,
    weekly_fable: 160_000_000,
};
pub const DEFAULT_CAPS_MAX_20X: Caps = Caps {
    block_5h: 15_600_000,
    weekly: 2_600_000_000,
    weekly_fable: 640_000_000,
};

/// Réglages persistés par l'utilisateur dans `junimo-settings.json`
/// (dossier `app_config_dir` de l'app). Quand `caps` est présent, il
/// surcharge intégralement les plafonds par défaut résolus depuis le tier.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AppSettings {
    pub caps: Option<CapsSettings>,
    /// Référence de reset de la fenêtre hebdomadaire (RFC3339), à recopier
    /// une fois depuis `/usage` (ex. `"2026-07-15T00:00:00+02:00"`). La
    /// grille 7 jours se projette dessus dans les deux sens ; sans elle, la
    /// référence est estimée depuis l'historique local (moins fiable).
    pub weekly_reset_reference: Option<String>,
}

/// Plafonds éditables depuis les réglages de l'app, en tokens pondérés.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CapsSettings {
    pub block_5h: u64,
    pub weekly: u64,
    pub weekly_fable: u64,
}

/// Compte tel qu'exposé au front : mapping lisible depuis `ConfigData`, tous
/// les champs optionnels réduits à `String` (`"?"` par défaut).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AccountSnapshot {
    pub plan: String,
    pub tier: String,
    pub email: String,
    pub org: String,
    pub default_model: String,
    pub cli_version: String,
    pub today_messages: u64,
    pub today_tokens: u64,
}

/// Métadonnées du snapshot : horodatage de génération, sources dégradées
/// agrégées, et rappel que les jauges sont des estimations (toujours `true`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Meta {
    pub generated_at: DateTime<Utc>,
    pub degraded: Vec<String>,
    pub estimated: bool,
}

/// Snapshot unique envoyé au front. Le contrat JSON exact (contrat
/// TypeScript déjà implémenté côté front) est : `{ gauges, mcps, account,
/// meta }`, voir le commentaire de module.
#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub gauges: Gauges,
    pub mcps: Vec<McpServer>,
    pub account: AccountSnapshot,
    pub meta: Meta,
}

/// Résout le home Claude Code : `JUNIMO_HOME` si définie (tests,
/// dégradation manuelle sans toucher aux vrais fichiers), sinon le home
/// système (`dirs::home_dir`). Ne panique jamais : repli sur `.` si même
/// `dirs::home_dir` échoue (cas extrême, plateforme sans notion de home).
pub fn resolve_home() -> PathBuf {
    if let Ok(value) = std::env::var("JUNIMO_HOME") {
        if !value.is_empty() {
            return PathBuf::from(value);
        }
    }
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// Sélectionne les plafonds par défaut selon le tier détecté
/// (`user_rate_limit_tier` brut, ex `"default_claude_max_5x"`), puis les
/// surcharge intégralement par les réglages utilisateur s'ils sont présents.
/// Fonction pure (aucune I/O), testée directement.
pub fn resolve_caps(tier: Option<&str>, settings: Option<&AppSettings>) -> Caps {
    let defaults = match tier {
        Some(t) if t.contains("20x") => DEFAULT_CAPS_MAX_20X,
        Some(t) if t.contains("5x") => DEFAULT_CAPS_MAX_5X,
        _ => DEFAULT_CAPS_PRO,
    };

    match settings.and_then(|s| s.caps) {
        Some(c) => Caps {
            block_5h: c.block_5h,
            weekly: c.weekly,
            weekly_fable: c.weekly_fable,
        },
        None => defaults,
    }
}

/// Résout un plan lisible depuis `billing_type`/`organization_type` : si
/// `billing_type` contient "subscription" et `organization_type` contient
/// "max" -> "Max", "pro" -> "Pro", sinon la valeur brute de `billing_type`.
/// `"?"` si `billing_type` est absent.
fn resolve_plan(billing_type: &Option<String>, organization_type: &Option<String>) -> String {
    let Some(bt) = billing_type else {
        return "?".to_string();
    };

    if !bt.to_lowercase().contains("subscription") {
        return bt.clone();
    }

    let ot = organization_type
        .as_deref()
        .unwrap_or_default()
        .to_lowercase();

    if ot.contains("max") {
        "Max".to_string()
    } else if ot.contains("pro") {
        "Pro".to_string()
    } else {
        bt.clone()
    }
}

/// Forme courte du tier utilisateur : retire le préfixe `default_` s'il est
/// présent, garde la valeur brute sinon. `"?"` si absent.
fn resolve_tier_display(tier: &Option<String>) -> String {
    match tier {
        Some(t) => t.strip_prefix("default_").unwrap_or(t).to_string(),
        None => "?".to_string(),
    }
}

/// `value.clone()` ou `"?"` si `None` — utilisé pour tous les champs de
/// compte optionnels qui deviennent des `String` non optionnelles au niveau
/// du snapshot.
fn or_unknown(value: &Option<String>) -> String {
    value.clone().unwrap_or_else(|| "?".to_string())
}

fn build_account(config_data: &ConfigData, today_messages: u64, today_tokens: u64) -> AccountSnapshot {
    AccountSnapshot {
        plan: resolve_plan(&config_data.account.billing_type, &config_data.account.organization_type),
        tier: resolve_tier_display(&config_data.account.user_rate_limit_tier),
        email: or_unknown(&config_data.account.email_address),
        org: or_unknown(&config_data.account.organization_name),
        default_model: or_unknown(&config_data.default_model),
        cli_version: or_unknown(&config_data.cli_version),
        today_messages,
        today_tokens,
    }
}

/// Minuit local (machine) le plus proche de `now`, converti en UTC. Wrapper
/// non testé unitairement (dépend du fuseau horaire système au moment du
/// test) : la logique pure testée est [`today_stats`], qui prend cette borne
/// en paramètre.
fn local_midnight_utc_for(now: DateTime<Utc>) -> DateTime<Utc> {
    let local_date = now.with_timezone(&Local).date_naive();
    let local_midnight = local_date
        .and_hms_opt(0, 0, 0)
        .expect("00:00:00 est toujours une heure valide pour une date donnée");

    match Local.from_local_datetime(&local_midnight) {
        chrono::LocalResult::Single(dt) => dt.with_timezone(&Utc),
        chrono::LocalResult::Ambiguous(dt, _) => dt.with_timezone(&Utc),
        // Repli défensif : ne devrait jamais se produire pour un minuit, mais
        // le collecteur ne doit jamais paniquer sur une conversion de date.
        chrono::LocalResult::None => now,
    }
}

/// Nombre de messages et de tokens pondérés (mêmes constantes que
/// `windows::weighted_tokens`) depuis `local_midnight_utc` (borne incluse).
/// Logique pure, testée directement avec une borne injectée pour rester
/// déterministe indépendamment du fuseau horaire de la machine qui exécute
/// les tests.
fn today_stats(events: &[UsageEvent], local_midnight_utc: DateTime<Utc>) -> (u64, u64) {
    let mut messages: u64 = 0;
    let mut weighted_sum: f64 = 0.0;

    for event in events {
        if event.ts >= local_midnight_utc {
            messages += 1;
            weighted_sum += windows::weighted_tokens(event);
        }
    }

    (messages, weighted_sum.round().max(0.0) as u64)
}

/// Estime la référence de reset hebdomadaire depuis l'historique local :
/// fenêtres de 7 jours chaînées, chacune démarrant au **minuit local** du
/// premier événement suivant l'expiration de la précédente (comportement
/// observé de `/usage`, granularité au jour). Approximation : l'historique
/// local est souvent tronqué, la phase réelle peut différer d'un ou deux
/// jours — le réglage `weekly_reset_reference` recopié depuis `/usage`
/// est toujours prioritaire.
fn estimate_weekly_reference(
    events: &[super::transcripts::UsageEvent],
    now: DateTime<Utc>,
) -> Option<DateTime<Utc>> {
    let first = events.first()?;
    let mut start = local_midnight_utc_for(first.ts);
    loop {
        let end = start + Duration::days(7);
        if now < end {
            return Some(start);
        }
        match events.iter().find(|e| e.ts >= end) {
            Some(e) => start = local_midnight_utc_for(e.ts),
            // Fenêtre expirée sans usage ultérieur : la grille continue
            // depuis la dernière fenêtre connue.
            None => return Some(start),
        }
    }
}

/// Assemble le [`Snapshot`] unique envoyé au front à partir des trois
/// collecteurs. `now` et `caps` sont toujours fournis par l'appelant (jamais
/// d'horloge lue ni de plafond résolu ici) : voir [`resolve_caps`] pour les
/// plafonds. `weekly_reference` vient du réglage `weekly_reset_reference`
/// (calibré sur `/usage`) ; absent → estimation locale, voir
/// [`estimate_weekly_reference`].
pub fn build_snapshot(
    home: &Path,
    now: DateTime<Utc>,
    caps: &Caps,
    weekly_reference: Option<DateTime<Utc>>,
) -> Snapshot {
    let config_data = config::collect_config(home);

    let since = now - Duration::days(SNAPSHOT_LOOKBACK_DAYS);
    let scan = transcripts::collect_events(home, since);

    let weekly_anchor = weekly_reference.or_else(|| estimate_weekly_reference(&scan.events, now));
    let gauges = windows::compute_gauges(&scan.events, now, caps, weekly_anchor);

    let local_midnight_utc = local_midnight_utc_for(now);
    let (today_messages, today_tokens) = today_stats(&scan.events, local_midnight_utc);

    let mut degraded = config_data.degraded.clone();
    if scan.parse_errors > 0 {
        degraded.push(format!("transcripts_parse_errors:{}", scan.parse_errors));
    }

    Snapshot {
        gauges,
        mcps: config_data.mcps.clone(),
        account: build_account(&config_data, today_messages, today_tokens),
        meta: Meta {
            generated_at: now,
            degraded,
            estimated: true,
        },
    }
}

/// Chemin de `junimo-settings.json` dans le dossier de config de l'app, ou
/// `None` si `app_config_dir` échoue (plateforme exotique, permissions).
pub fn settings_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("junimo-settings.json"))
}

/// Charge les réglages depuis `junimo-settings.json`. Lecture défensive :
/// fichier absent -> `(None, [])` (réglages jamais configurés, état normal,
/// pas de dégradation) ; fichier présent mais invalide -> `(None,
/// ["settings_invalid"])`. N'échoue jamais autrement (défauts appliqués par
/// l'appelant via [`resolve_caps`]).
pub fn load_settings(app: &tauri::AppHandle) -> (Option<AppSettings>, Vec<String>) {
    let Some(path) = settings_path(app) else {
        return (None, Vec::new());
    };

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<AppSettings>(&content) {
            Ok(parsed) => (Some(parsed), Vec::new()),
            Err(_) => (None, vec!["settings_invalid".to_string()]),
        },
        Err(_) => (None, Vec::new()),
    }
}

/// Écrit les réglages dans `junimo-settings.json`, en créant le dossier de
/// config de l'app si nécessaire.
pub fn write_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app).ok_or_else(|| "app_config_dir indisponible".to_string())?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collector::transcripts::TokenCounts;
    use std::collections::BTreeSet;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    fn ts(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn ev(ts_str: &str, model: &str, input: u64) -> UsageEvent {
        UsageEvent {
            ts: ts(ts_str),
            model: model.to_string(),
            tokens: TokenCounts {
                input,
                output: 0,
                cache_creation: 0,
                cache_read: 0,
            },
        }
    }

    // --- resolve_caps : mapping tier -> plafonds, surcharge par réglages ---

    #[test]
    fn resolve_caps_defaults_to_pro_without_tier() {
        assert_eq!(resolve_caps(None, None), DEFAULT_CAPS_PRO);
    }

    #[test]
    fn resolve_caps_maps_20x_tier() {
        assert_eq!(
            resolve_caps(Some("default_claude_max_20x"), None),
            DEFAULT_CAPS_MAX_20X
        );
    }

    #[test]
    fn resolve_caps_maps_5x_tier() {
        assert_eq!(
            resolve_caps(Some("default_claude_max_5x"), None),
            DEFAULT_CAPS_MAX_5X
        );
    }

    #[test]
    fn resolve_caps_falls_back_to_pro_for_unknown_tier() {
        assert_eq!(resolve_caps(Some("default_pro"), None), DEFAULT_CAPS_PRO);
    }

    #[test]
    fn resolve_caps_settings_override_wins_over_tier_default() {
        let settings = AppSettings {
            caps: Some(CapsSettings {
                block_5h: 1,
                weekly: 2,
                weekly_fable: 3,
            }),
            ..AppSettings::default()
        };

        let caps = resolve_caps(Some("default_claude_max_20x"), Some(&settings));

        assert_eq!(
            caps,
            Caps {
                block_5h: 1,
                weekly: 2,
                weekly_fable: 3,
            }
        );
    }

    #[test]
    fn resolve_caps_settings_without_caps_falls_back_to_tier_default() {
        let settings = AppSettings::default();

        assert_eq!(
            resolve_caps(Some("default_claude_max_5x"), Some(&settings)),
            DEFAULT_CAPS_MAX_5X
        );
    }

    // --- mapping compte : plan, tier lisible ---

    #[test]
    fn resolve_plan_subscription_with_max_org_yields_max() {
        assert_eq!(
            resolve_plan(&Some("stripe_subscription".to_string()), &Some("claude_max".to_string())),
            "Max"
        );
    }

    #[test]
    fn resolve_plan_subscription_with_pro_org_yields_pro() {
        assert_eq!(
            resolve_plan(&Some("stripe_subscription".to_string()), &Some("claude_pro".to_string())),
            "Pro"
        );
    }

    #[test]
    fn resolve_plan_subscription_with_other_org_yields_raw_billing_type() {
        assert_eq!(
            resolve_plan(&Some("stripe_subscription".to_string()), &Some("claude_team".to_string())),
            "stripe_subscription"
        );
    }

    #[test]
    fn resolve_plan_non_subscription_billing_yields_raw_value() {
        assert_eq!(
            resolve_plan(&Some("invoice".to_string()), &None),
            "invoice"
        );
    }

    #[test]
    fn resolve_plan_missing_billing_type_yields_unknown() {
        assert_eq!(resolve_plan(&None, &None), "?");
    }

    #[test]
    fn resolve_tier_display_strips_default_prefix() {
        assert_eq!(
            resolve_tier_display(&Some("default_claude_max_20x".to_string())),
            "claude_max_20x"
        );
    }

    #[test]
    fn resolve_tier_display_keeps_value_without_prefix() {
        assert_eq!(
            resolve_tier_display(&Some("claude_max_20x".to_string())),
            "claude_max_20x"
        );
    }

    #[test]
    fn resolve_tier_display_missing_yields_unknown() {
        assert_eq!(resolve_tier_display(&None), "?");
    }

    // --- today_stats : logique pure, borne de minuit injectée ---

    #[test]
    fn today_stats_excludes_events_strictly_before_midnight() {
        let midnight = ts("2026-07-08T00:00:00Z");
        let events = vec![ev("2026-07-07T23:59:59Z", "claude-sonnet-5", 100)];

        let (messages, tokens) = today_stats(&events, midnight);

        assert_eq!(messages, 0);
        assert_eq!(tokens, 0);
    }

    #[test]
    fn today_stats_includes_event_exactly_at_midnight() {
        let midnight = ts("2026-07-08T00:00:00Z");
        let events = vec![ev("2026-07-08T00:00:00Z", "claude-sonnet-5", 100)];

        let (messages, tokens) = today_stats(&events, midnight);

        assert_eq!(messages, 1);
        assert_eq!(tokens, 100);
    }

    #[test]
    fn today_stats_sums_weighted_tokens_across_multiple_events() {
        let midnight = ts("2026-07-08T00:00:00Z");
        let events = vec![
            ev("2026-07-08T01:00:00Z", "claude-fable-5", 100),
            ev("2026-07-08T02:00:00Z", "claude-sonnet-5", 50),
            ev("2026-07-07T23:00:00Z", "claude-sonnet-5", 999), // avant minuit, exclu
        ];

        let (messages, tokens) = today_stats(&events, midnight);

        assert_eq!(messages, 2);
        assert_eq!(tokens, 150);
    }

    // --- build_snapshot : contrat JSON exact attendu par le front ---

    #[test]
    fn build_snapshot_json_matches_ts_contract_on_complete_fixture() {
        let now = ts("2026-07-08T10:00:00Z");
        let caps = resolve_caps(Some("default_claude_max_5x"), None);

        let snapshot = build_snapshot(&fixture("snapshot_complete"), now, &caps, None);
        let value = serde_json::to_value(&snapshot).expect("Snapshot doit se sérialiser");

        let top_level: BTreeSet<&str> = value
            .as_object()
            .expect("le snapshot est un objet JSON")
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            top_level,
            BTreeSet::from(["gauges", "mcps", "account", "meta"])
        );

        // --- gauges ---
        let gauge_keys: BTreeSet<&str> =
            BTreeSet::from(["used_tokens", "cap", "percent", "reset_at"]);
        for name in ["block_5h", "weekly", "weekly_fable"] {
            let gauge = &value["gauges"][name];
            let keys: BTreeSet<&str> = gauge
                .as_object()
                .unwrap_or_else(|| panic!("gauges.{name} doit être un objet"))
                .keys()
                .map(String::as_str)
                .collect();
            assert_eq!(keys, gauge_keys, "clés inattendues pour gauges.{name}");
            assert!(
                gauge["reset_at"].is_string(),
                "gauges.{name}.reset_at doit être une chaîne ISO 8601 (événements présents)"
            );
        }

        assert_eq!(value["gauges"]["block_5h"]["used_tokens"], 1800);
        assert_eq!(value["gauges"]["weekly"]["used_tokens"], 1800);
        assert_eq!(value["gauges"]["weekly_fable"]["used_tokens"], 1500);

        // --- mcps ---
        assert_eq!(
            value["mcps"],
            serde_json::json!([
                { "name": "figma-console", "scope": "global", "transport": "stdio" }
            ])
        );

        // --- account ---
        let account_keys: BTreeSet<&str> = BTreeSet::from([
            "plan",
            "tier",
            "email",
            "org",
            "default_model",
            "cli_version",
            "today_messages",
            "today_tokens",
        ]);
        let keys: BTreeSet<&str> = value["account"]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(keys, account_keys);

        assert_eq!(value["account"]["plan"], "Max");
        assert_eq!(value["account"]["tier"], "claude_max_5x");
        assert_eq!(value["account"]["email"], "ada@example.com");
        assert_eq!(value["account"]["org"], "Acme Corp");
        assert_eq!(value["account"]["default_model"], "claude-fable-5[1m]");
        // cli_version dépend du `claude` CLI de la machine qui exécute les
        // tests (voir config.rs) : on vérifie seulement le type, jamais la
        // valeur exacte.
        assert!(value["account"]["cli_version"].is_string());
        // today_messages/today_tokens dépendent du fuseau horaire local de la
        // machine (minuit local) : seul le type est garanti déterministe ici,
        // voir les tests dédiés de `today_stats` ci-dessus pour les valeurs
        // exactes avec une borne injectée.
        assert!(value["account"]["today_messages"].is_u64());
        assert!(value["account"]["today_tokens"].is_u64());

        // --- meta ---
        let meta_keys: BTreeSet<&str> = BTreeSet::from(["generated_at", "degraded", "estimated"]);
        let keys: BTreeSet<&str> = value["meta"].as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, meta_keys);

        assert_eq!(value["meta"]["estimated"], true);
        assert_eq!(value["meta"]["generated_at"], "2026-07-08T10:00:00Z");
        assert_eq!(
            value["meta"]["degraded"],
            serde_json::json!(["transcripts_parse_errors:1"])
        );
    }

    #[test]
    fn build_snapshot_on_absent_home_degrades_gracefully_with_null_resets() {
        let now = ts("2026-07-08T10:00:00Z");

        let snapshot = build_snapshot(&fixture("absent"), now, &DEFAULT_CAPS_PRO, None);
        let value = serde_json::to_value(&snapshot).expect("Snapshot doit se sérialiser");

        assert!(value["gauges"]["block_5h"]["reset_at"].is_null());
        assert!(value["gauges"]["weekly"]["reset_at"].is_null());
        assert!(value["gauges"]["weekly_fable"]["reset_at"].is_null());

        assert_eq!(value["mcps"], serde_json::json!([]));

        assert_eq!(value["account"]["plan"], "?");
        assert_eq!(value["account"]["tier"], "?");
        assert_eq!(value["account"]["email"], "?");
        assert_eq!(value["account"]["org"], "?");
        assert_eq!(value["account"]["default_model"], "?");
        assert_eq!(value["account"]["today_messages"], 0);
        assert_eq!(value["account"]["today_tokens"], 0);

        assert_eq!(value["meta"]["estimated"], true);

        let degraded: Vec<String> = snapshot.meta.degraded.clone();
        assert!(degraded.contains(&"claude_json_missing".to_string()));
        assert!(degraded.contains(&"settings_json_missing".to_string()));
        // Pas de transcripts : aucune erreur de parsing à signaler.
        assert!(!degraded.iter().any(|d| d.starts_with("transcripts_parse_errors")));
    }

    /// Smoke test manuel sur les vraies données de la machine : lecture
    /// seule, jamais exécuté par la CI (`#[ignore]`). Lancer avec
    /// `cargo test -- --ignored build_snapshot_smoke_test_on_real_home`.
    #[test]
    #[ignore]
    fn build_snapshot_smoke_test_on_real_home() {
        let home = resolve_home();
        let config_data = config::collect_config(&home);
        let caps = resolve_caps(config_data.account.user_rate_limit_tier.as_deref(), None);

        let start = std::time::Instant::now();
        let snapshot = build_snapshot(&home, Utc::now(), &caps, None);
        let elapsed = start.elapsed();

        println!(
            "smoke test réel : elapsed={:?}\n{}",
            elapsed,
            serde_json::to_string_pretty(&snapshot).unwrap()
        );
    }
}
