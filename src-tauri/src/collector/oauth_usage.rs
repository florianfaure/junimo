//! Lecture défensive des credentials OAuth de Claude Code, en vue d'appeler
//! l'endpoint usage d'Anthropic (voir `docs/specs/2026-07-09-junimo.md`).
//!
//! **SÉCURITÉ CRITIQUE** : cette lecture est strictement read-only. Jamais de
//! refresh du token — une rotation du `refreshToken` casserait Claude Code,
//! qui est le seul propriétaire légitime de ces credentials. Le contenu du
//! token (`access_token`) ne doit **jamais** apparaître dans un log, un
//! message d'erreur, ou une sortie `Debug` dérivée : `OauthCredentials`
//! implémente `Debug` à la main pour le masquer.
//!
//! Deux sources sont tentées dans l'ordre, la seconde en repli de la
//! première :
//! 1. Trousseau macOS (`security find-generic-password`), le stockage
//!    "officiel" utilisé par Claude Code sur macOS.
//! 2. Fichier `<home>/.claude/.credentials.json`, utilisé sur les plateformes
//!    sans trousseau ou en repli si l'accès trousseau échoue/est refusé.

use super::snapshot::Snapshot;
use super::windows::{Gauge, GaugeSource, Gauges};
use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{mpsc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration as StdDuration;

/// Nom du service trousseau macOS sous lequel Claude Code range ses
/// credentials OAuth.
const KEYCHAIN_SERVICE: &str = "Claude Code-credentials";

/// Timeout d'attente de `security find-generic-password`. Un prompt trousseau
/// macOS peut bloquer indéfiniment en attente d'une validation utilisateur
/// (Touch ID, mot de passe) ; un refus fait sortir `security` en erreur mais
/// pas nécessairement tout de suite. On borne donc l'attente et on bascule
/// sur le repli fichier au-delà.
const KEYCHAIN_TIMEOUT: StdDuration = StdDuration::from_secs(5);

/// Marge de sécurité appliquée avant l'expiration déclarée du token : un
/// token qui expire dans moins de 60 s est considéré comme expiré, pour
/// laisser le temps à un appel HTTP en cours de s'exécuter sans essuyer un
/// 401 en toute fin de fenêtre.
const EXPIRY_MARGIN: Duration = Duration::seconds(60);

/// Credentials Claude Code, lues en LECTURE SEULE.
/// Jamais de refresh : une rotation du refresh token casserait Claude Code.
pub struct OauthCredentials {
    pub access_token: String,
    pub expires_at_ms: Option<i64>, // epoch millis
}

impl std::fmt::Debug for OauthCredentials {
    /// Masque `access_token` : ce champ ne doit jamais fuiter dans un log ou
    /// un message d'erreur, y compris via un `{:?}` négligent en amont.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OauthCredentials")
            .field("access_token", &"***")
            .field("expires_at_ms", &self.expires_at_ms)
            .finish()
    }
}

/// Extrait les credentials depuis le JSON brut (trousseau ou fichier), sans
/// aucune I/O. Défensif : JSON invalide, clé racine `claudeAiOauth` absente,
/// ou `accessToken` absent/vide/non-string renvoient `None` plutôt que de
/// paniquer.
pub fn parse_credentials_json(raw: &str) -> Option<OauthCredentials> {
    let value: Value = serde_json::from_str(raw).ok()?;
    let oauth = value.get("claudeAiOauth")?;

    let access_token = oauth.get("accessToken")?.as_str()?;
    if access_token.is_empty() {
        return None;
    }

    let expires_at_ms = oauth.get("expiresAt").and_then(Value::as_i64);

    Some(OauthCredentials {
        access_token: access_token.to_string(),
        expires_at_ms,
    })
}

/// Détermine si les credentials sont expirées, avec une marge de 60 s.
/// `expires_at_ms` absent (format inconnu ou champ non fourni) est traité
/// comme "non expiré" : c'est l'API `/usage` qui tranchera avec un 401 le cas
/// échéant, on ne veut pas bloquer localement sur une hypothèse.
pub fn credentials_expired(creds: &OauthCredentials, now: DateTime<Utc>) -> bool {
    match creds.expires_at_ms {
        Some(ms) => match DateTime::from_timestamp_millis(ms) {
            Some(expires_at) => now + EXPIRY_MARGIN >= expires_at,
            // Timestamp hors bornes représentables : on ne peut rien
            // affirmer, on ne bloque pas dessus.
            None => false,
        },
        None => false,
    }
}

/// Lance `security find-generic-password -s "Claude Code-credentials" -w`
/// avec un timeout, best-effort. Isolée volontairement : jamais couverte par
/// un test unitaire (dépend du trousseau macOS de la machine), jamais
/// bloquante au-delà du timeout, jamais de panic si `security` est absent ou
/// si l'accès est refusé. Le stdout (qui contient le token) n'est jamais
/// loggé, y compris en cas d'échec de parsing.
fn read_from_keychain() -> Option<OauthCredentials> {
    let child = Command::new("security")
        .arg("find-generic-password")
        .arg("-s")
        .arg(KEYCHAIN_SERVICE)
        .arg("-w")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();

    let child = match child {
        Ok(child) => child,
        Err(_) => return None,
    };

    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let result = child.wait_with_output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(KEYCHAIN_TIMEOUT) {
        Ok(Ok(output)) if output.status.success() => {
            let raw = String::from_utf8(output.stdout).ok()?;
            parse_credentials_json(raw.trim())
        }
        _ => None,
    }
}

/// Lit `<home>/.claude/.credentials.json`, repli du trousseau. Best-effort :
/// fichier absent ou JSON invalide renvoient `None` sans jamais paniquer ni
/// logger le contenu du fichier.
fn read_from_file(home: &Path) -> Option<OauthCredentials> {
    let path = home.join(".claude").join(".credentials.json");
    let raw = std::fs::read_to_string(path).ok()?;
    parse_credentials_json(&raw)
}

/// Point d'entrée : lit les credentials Claude Code en lecture seule, en
/// essayant d'abord le trousseau macOS puis, en repli, le fichier
/// `~/.claude/.credentials.json`. `None` si aucune des deux sources n'aboutit.
pub fn read_credentials(home: &Path) -> Option<OauthCredentials> {
    read_from_keychain().or_else(|| read_from_file(home))
}

// ---------------------------------------------------------------------------
// Endpoint usage officiel : fetch HTTP + parsing défensif + cache anti-flicker.
// ---------------------------------------------------------------------------

/// URL de l'endpoint usage (non documenté, sondé le 2026-07-15). Renvoie les
/// pourcentages officiels des fenêtres de rate limit du compte.
const USAGE_ENDPOINT: &str = "https://api.anthropic.com/api/oauth/usage";

/// Valeur du header `anthropic-beta` requis par l'endpoint OAuth.
const OAUTH_BETA: &str = "oauth-2025-04-20";

/// Timeout de l'appel HTTP à `/usage`.
const FETCH_TIMEOUT: StdDuration = StdDuration::from_secs(10);

/// Durée de vie maximale d'un cache *périmé* servi en repli après un échec
/// réseau/HTTP : au-delà, on préfère `None` (bascule fallback local) plutôt
/// que d'afficher des chiffres officiels trop vieux. Anti-flicker : évite de
/// perdre les jauges officielles sur un simple hoquet réseau.
const STALE_TTL_SECS: i64 = 600; // 10 min

/// Une fenêtre officielle : pourcentage 0-100 et reset optionnel. `resets_at`
/// à `None` = pas de fenêtre active (ex. bloc 5h sans session en cours).
#[derive(Debug, Clone, PartialEq)]
pub struct OfficialWindow {
    pub percent: f64,
    pub resets_at: Option<DateTime<Utc>>,
}

/// Usage officiel tel que renvoyé par `/usage`, réduit aux trois fenêtres qui
/// nous intéressent. `seven_day_scoped` (limite hebdo par famille de modèle,
/// Fable/Opus) est absente sur certains comptes.
#[derive(Debug, Clone, PartialEq)]
pub struct OfficialUsage {
    pub five_hour: OfficialWindow,
    pub seven_day: OfficialWindow,
    pub seven_day_scoped: Option<OfficialWindow>,
}

/// Cache interne du state : dernier succès (usage + instant de fetch) et
/// dernières credentials lues (cache mémoire, relues du disque/trousseau si
/// absentes ou expirées).
#[derive(Default)]
struct OfficialUsageCache {
    last: Option<(OfficialUsage, DateTime<Utc>)>,
    credentials: Option<OauthCredentials>,
}

/// État partagé de l'usage officiel, managé par Tauri (`app.manage(...)`),
/// accessible depuis la commande snapshot et le thread de polling. Même
/// pattern `Mutex` que `AlertsState` de `lib.rs`.
#[derive(Default)]
pub struct OfficialUsageState {
    inner: Mutex<OfficialUsageCache>,
}

impl OfficialUsageState {
    /// Verrou tolérant à l'empoisonnement : ce module ne panique jamais, un
    /// verrou empoisonné (panic d'un autre thread) est récupéré tel quel.
    fn lock(&self) -> MutexGuard<'_, OfficialUsageCache> {
        self.inner.lock().unwrap_or_else(|poison| poison.into_inner())
    }
}

/// Échec de `fetch_usage`. **SÉCURITÉ** : aucune variante ne transporte le
/// token ni le corps complet de la réponse — seulement des libellés neutres.
#[derive(Debug)]
pub enum FetchError {
    /// 401 : token invalide/expiré. Le caller retente une fois après relecture.
    Unauthorized,
    /// Autre code non-2xx (hors 401).
    Http(u16),
    /// Erreur de transport (réseau, DNS, TLS, timeout, lecture du corps).
    Network(String),
    /// Réponse 200 mais schéma inexploitable (voir [`parse_usage_response`]).
    Shape(String),
}

/// Parse une chaîne ISO 8601 en `DateTime<Utc>`. `None` si le nœud est absent,
/// `null`, non-string, ou illisible (jamais de panic).
fn parse_resets_at(node: Option<&Value>) -> Option<DateTime<Utc>> {
    let raw = node?.as_str()?;
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

/// Construit une fenêtre depuis une entrée de `limits[]` : `percent` numérique
/// clampé 0-100 (0 par défaut si absent), `resets_at` optionnel.
fn window_from_limit(entry: &Value) -> OfficialWindow {
    let percent = entry
        .get("percent")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        .clamp(0.0, 100.0);
    OfficialWindow {
        percent,
        resets_at: parse_resets_at(entry.get("resets_at")),
    }
}

/// Construit une fenêtre depuis un champ top-level legacy (`five_hour`,
/// `seven_day`, `seven_day_opus`) : `utilization` clampé 0-100. `None` si le
/// nœud est absent, `null`, ou dépourvu d'`utilization` numérique (pas de
/// fenêtre exploitable — ex. `seven_day_opus: null`).
fn window_from_top_level(node: Option<&Value>) -> Option<OfficialWindow> {
    let node = node?;
    if node.is_null() {
        return None;
    }
    let percent = node
        .get("utilization")
        .and_then(Value::as_f64)?
        .clamp(0.0, 100.0);
    Some(OfficialWindow {
        percent,
        resets_at: parse_resets_at(node.get("resets_at")),
    })
}

/// Parse la réponse `/usage`. **Pure** et défensive (via `serde_json::Value`) :
///
/// - Priorité au tableau `limits[]` (source canonique) : `session` → 5h,
///   `weekly_all` → 7 jours, `weekly_scoped` → 7 jours scoped modèle.
/// - Repli, champ par champ manquant, sur les champs top-level legacy
///   (`five_hour`/`seven_day`/`seven_day_opus`).
/// - `session` **et** `weekly_all` sont obligatoires (par l'une ou l'autre
///   voie) : si l'une manque, `Err` (shape mismatch → le caller fera un
///   fallback local complet, jamais de panachage officiel/estimé).
///   `seven_day_scoped` reste optionnel (`None` si absent).
/// - Tout champ inconnu/futur est ignoré silencieusement.
pub fn parse_usage_response(raw: &str) -> Result<OfficialUsage, String> {
    let value: Value = serde_json::from_str(raw).map_err(|_| "JSON illisible".to_string())?;

    // Voie 1 : tableau limits[], canonique.
    let mut five_hour: Option<OfficialWindow> = None;
    let mut seven_day: Option<OfficialWindow> = None;
    let mut seven_day_scoped: Option<OfficialWindow> = None;

    if let Some(limits) = value.get("limits").and_then(Value::as_array) {
        for entry in limits {
            match entry.get("kind").and_then(Value::as_str) {
                Some("session") => five_hour = Some(window_from_limit(entry)),
                Some("weekly_all") => seven_day = Some(window_from_limit(entry)),
                Some("weekly_scoped") => seven_day_scoped = Some(window_from_limit(entry)),
                _ => {} // kind inconnu/futur : ignoré.
            }
        }
    }

    // Voie 2 : repli top-level, uniquement pour ce qui manque encore.
    if five_hour.is_none() {
        five_hour = window_from_top_level(value.get("five_hour"));
    }
    if seven_day.is_none() {
        seven_day = window_from_top_level(value.get("seven_day"));
    }
    if seven_day_scoped.is_none() {
        seven_day_scoped = window_from_top_level(value.get("seven_day_opus"));
    }

    match (five_hour, seven_day) {
        (Some(five_hour), Some(seven_day)) => Ok(OfficialUsage {
            five_hour,
            seven_day,
            seven_day_scoped,
        }),
        // Fenêtre(s) obligatoire(s) introuvable(s) : shape mismatch.
        _ => Err("session/weekly_all introuvable".to_string()),
    }
}

/// Appelle `/usage` avec le token en `Authorization: Bearer` et le header
/// `anthropic-beta`. **SÉCURITÉ** : le token n'apparaît que dans le header de
/// la requête, jamais dans une valeur retournée ni un message d'erreur.
fn fetch_usage(token: &str) -> Result<OfficialUsage, FetchError> {
    let response = ureq::get(USAGE_ENDPOINT)
        .timeout(FETCH_TIMEOUT)
        .set("Authorization", &format!("Bearer {token}"))
        .set("anthropic-beta", OAUTH_BETA)
        .call();

    match response {
        Ok(resp) => {
            // Corps jamais loggé ni renvoyé : seul un libellé neutre remonte.
            let body = resp
                .into_string()
                .map_err(|_| FetchError::Network("lecture du corps".to_string()))?;
            parse_usage_response(&body).map_err(FetchError::Shape)
        }
        Err(ureq::Error::Status(401, _)) => Err(FetchError::Unauthorized),
        Err(ureq::Error::Status(code, _)) => Err(FetchError::Http(code)),
        Err(ureq::Error::Transport(_)) => Err(FetchError::Network("transport".to_string())),
    }
}

/// `true` si un cache daté de `fetched_at` est encore valable à `now` vis-à-vis
/// d'un âge maximum `max_age`. **Pure**, testée. Une date de fetch dans le
/// futur (dérive d'horloge) est traitée comme fraîche.
fn cache_is_fresh(fetched_at: DateTime<Utc>, now: DateTime<Utc>, max_age: Duration) -> bool {
    now.signed_duration_since(fetched_at) < max_age
}

/// Renvoie le cache s'il a moins de `STALE_TTL_SECS`, `None` sinon. Repli
/// anti-flicker après un échec réseau/HTTP.
fn stale_cache(state: &OfficialUsageState, now: DateTime<Utc>) -> Option<OfficialUsage> {
    let inner = state.lock();
    let (usage, fetched_at) = inner.last.as_ref()?;
    if cache_is_fresh(*fetched_at, now, Duration::seconds(STALE_TTL_SECS)) {
        Some(usage.clone())
    } else {
        None
    }
}

/// Extrait le token courant du cache, en relisant les credentials du
/// disque/trousseau si elles sont absentes ou expirées. Renvoie `None` si,
/// même après relecture, aucune credential valide n'est disponible.
fn token_from_state(
    state: &OfficialUsageState,
    home: &Path,
    now: DateTime<Utc>,
    force_reload: bool,
) -> Option<String> {
    let mut inner = state.lock();

    let need_reload = force_reload
        || match inner.credentials.as_ref() {
            Some(creds) => credentials_expired(creds, now),
            None => true,
        };
    if need_reload {
        inner.credentials = read_credentials(home);
    }

    match inner.credentials.as_ref() {
        Some(creds) if !credentials_expired(creds, now) => Some(creds.access_token.clone()),
        _ => None,
    }
}

/// Résout l'usage officiel, avec cache et repli anti-flicker. Étapes :
///
/// 1. `JUNIMO_NO_OFFICIAL=1` → `None` direct (test manuel du fallback local).
/// 2. Cache plus récent que `max_age` → renvoyé sans réseau.
/// 3. Credentials : cache mémoire, relues du disque/trousseau si absentes ou
///    expirées. Toujours expirées → pas d'appel, repli cache périmé.
/// 4. `fetch_usage`. Sur `Unauthorized`, relire les credentials **une** fois
///    (Claude Code a pu rafraîchir le token) et retenter **une** fois.
/// 5. Succès → met à jour le cache et renvoie.
/// 6. Échec → cache périmé s'il a moins de [`STALE_TTL_SECS`], sinon `None`.
pub fn resolve(
    state: &OfficialUsageState,
    home: &Path,
    now: DateTime<Utc>,
    max_age: Duration,
) -> Option<OfficialUsage> {
    // 1. Court-circuit manuel pour tester le fallback local.
    if std::env::var("JUNIMO_NO_OFFICIAL").ok().as_deref() == Some("1") {
        return None;
    }

    // 2. Cache frais : pas de réseau.
    {
        let inner = state.lock();
        if let Some((usage, fetched_at)) = inner.last.as_ref() {
            if cache_is_fresh(*fetched_at, now, max_age) {
                return Some(usage.clone());
            }
        }
    }

    // 3. Credentials (cache mémoire, relecture si absent/expiré).
    let Some(token) = token_from_state(state, home, now, false) else {
        // Aucune credential valide : pas d'appel, repli cache périmé.
        return stale_cache(state, now);
    };

    // 4. Fetch, avec un retry unique sur 401 après relecture des credentials.
    let usage = match fetch_usage(&token) {
        Ok(usage) => Some(usage),
        Err(FetchError::Unauthorized) => {
            token_from_state(state, home, now, true).and_then(|t| fetch_usage(&t).ok())
        }
        Err(_) => None,
    };

    match usage {
        // 5. Succès : mise à jour du cache.
        Some(usage) => {
            let mut inner = state.lock();
            inner.last = Some((usage.clone(), now));
            Some(usage)
        }
        // 6. Échec : repli cache périmé (< STALE_TTL) sinon None.
        None => stale_cache(state, now),
    }
}

/// Convertit une fenêtre officielle en [`Gauge`] : `used_tokens`/`cap` à `None`
/// (l'endpoint n'expose que le pourcentage et le reset), `source` officielle.
fn window_to_gauge(window: &OfficialWindow) -> Gauge {
    Gauge {
        used_tokens: None,
        cap: None,
        percent: window.percent,
        reset_at: window.resets_at,
        source: GaugeSource::Official,
        tokens_source: None,
    }
}

/// Traduit un [`OfficialUsage`] en [`Gauges`]. **Pure** : 5h → `block_5h`,
/// 7 jours → `weekly`, 7 jours scoped → `weekly_fable`. Scoped absent →
/// jauge officielle à 0 % sans reset (le compte n'a pas cette limite).
pub fn official_gauges(usage: &OfficialUsage) -> Gauges {
    Gauges {
        block_5h: window_to_gauge(&usage.five_hour),
        weekly: window_to_gauge(&usage.seven_day),
        weekly_fable: match &usage.seven_day_scoped {
            Some(window) => window_to_gauge(window),
            None => Gauge {
                used_tokens: None,
                cap: None,
                percent: 0.0,
                reset_at: None,
                source: GaugeSource::Official,
                tokens_source: None,
            },
        },
    }
}

/// Fusionne les tokens estimés localement dans une jauge officielle (tâche
/// #31) : si l'estimation est réellement DISPONIBLE (`tokens_source:
/// Some(Estimated)`, posé par le pipeline local, ET `used_tokens` présent),
/// `official` récupère `used_tokens`/`cap` de l'estimation et `tokens_source:
/// Some(Estimated)` — `percent`/`reset_at`/`source` restent STRICTEMENT ceux
/// de `official` (jamais de panachage sur ces trois champs).
///
/// La disponibilité est jugée sur `tokens_source`, PAS sur `used_tokens` :
/// le pipeline local (`windows::make_gauge`) produit toujours `Some(n)`, y
/// compris `Some(0)` sur un scan vide — c'est `build_snapshot` qui pose
/// `tokens_source: None` quand le scan transcripts n'a rien pu lire (dossier
/// absent, permissions, machine neuve). Dans ce cas, `official` est renvoyée
/// inchangée : la jauge officielle reste valide, simplement sans tokens —
/// jamais de « ≈ 0 tok (est.) » trompeur à côté d'un pourcentage fiable. Un
/// vrai « 0 usage dans la fenêtre » (historique présent) garde son
/// `tokens_source: Some(Estimated)` et s'affiche honnêtement.
/// **Pure**, testée directement.
fn merge_estimated_tokens(official: &Gauge, estimated: &Gauge) -> Gauge {
    match (estimated.tokens_source, estimated.used_tokens) {
        (Some(GaugeSource::Estimated), Some(used_tokens)) => Gauge {
            used_tokens: Some(used_tokens),
            cap: estimated.cap,
            tokens_source: Some(GaugeSource::Estimated),
            ..*official
        },
        _ => *official,
    }
}

/// Remplace les jauges du snapshot par les jauges officielles et marque
/// `meta.estimated = false`. Ne touche à rien d'autre : projets, historique,
/// activité du jour et compte restent calculés localement.
///
/// Tâche #31 : avant d'écraser `snapshot.gauges`, ses valeurs (l'estimation
/// locale déjà calculée par `build_snapshot` via le pipeline
/// transcripts/windows, systématiquement exécuté en amont dans
/// `assemble_snapshot`) sont conservées et fusionnées dans les jauges
/// officielles via [`merge_estimated_tokens`] : chaque jauge officielle
/// récupère ainsi `used_tokens`/`cap` estimés (marqués `tokens_source:
/// estimated`) tout en gardant `percent`/`reset_at` strictement officiels.
pub fn apply_official(snapshot: &mut Snapshot, usage: &OfficialUsage) {
    let estimated = snapshot.gauges.clone();
    let official = official_gauges(usage);

    snapshot.gauges = Gauges {
        block_5h: merge_estimated_tokens(&official.block_5h, &estimated.block_5h),
        weekly: merge_estimated_tokens(&official.weekly, &estimated.weekly),
        weekly_fable: merge_estimated_tokens(&official.weekly_fable, &estimated.weekly_fable),
    };
    snapshot.meta.estimated = false;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_credentials_json_full_valid() {
        let raw = r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat01-abc","refreshToken":"rt-xyz","expiresAt":1752571234567,"scopes":["user:inference"],"subscriptionType":"max"}}"#;
        let creds = parse_credentials_json(raw).expect("devrait parser");
        assert_eq!(creds.access_token, "sk-ant-oat01-abc");
        assert_eq!(creds.expires_at_ms, Some(1752571234567));
    }

    #[test]
    fn parse_credentials_json_without_expires_at() {
        let raw = r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat01-abc"}}"#;
        let creds = parse_credentials_json(raw).expect("devrait parser");
        assert_eq!(creds.access_token, "sk-ant-oat01-abc");
        assert_eq!(creds.expires_at_ms, None);
    }

    #[test]
    fn parse_credentials_json_empty_access_token_is_none() {
        let raw = r#"{"claudeAiOauth":{"accessToken":""}}"#;
        assert!(parse_credentials_json(raw).is_none());
    }

    #[test]
    fn parse_credentials_json_invalid_json_is_none() {
        let raw = "not json at all";
        assert!(parse_credentials_json(raw).is_none());
    }

    #[test]
    fn parse_credentials_json_missing_root_key_is_none() {
        let raw = r#"{"somethingElse":{"accessToken":"sk-ant-oat01-abc"}}"#;
        assert!(parse_credentials_json(raw).is_none());
    }

    #[test]
    fn credentials_expired_true_when_past() {
        let now = Utc::now();
        let creds = OauthCredentials {
            access_token: "tok".to_string(),
            expires_at_ms: Some((now - Duration::hours(1)).timestamp_millis()),
        };
        assert!(credentials_expired(&creds, now));
    }

    #[test]
    fn credentials_expired_false_when_far_future() {
        let now = Utc::now();
        let creds = OauthCredentials {
            access_token: "tok".to_string(),
            expires_at_ms: Some((now + Duration::hours(1)).timestamp_millis()),
        };
        assert!(!credentials_expired(&creds, now));
    }

    #[test]
    fn credentials_expired_true_within_margin() {
        let now = Utc::now();
        let creds = OauthCredentials {
            access_token: "tok".to_string(),
            expires_at_ms: Some((now + Duration::seconds(30)).timestamp_millis()),
        };
        assert!(credentials_expired(&creds, now));
    }

    #[test]
    fn credentials_expired_false_when_expires_at_none() {
        let now = Utc::now();
        let creds = OauthCredentials {
            access_token: "tok".to_string(),
            expires_at_ms: None,
        };
        assert!(!credentials_expired(&creds, now));
    }

    // -----------------------------------------------------------------------
    // parse_usage_response : parsing défensif du schéma réel de /usage.
    // -----------------------------------------------------------------------

    fn dt(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s)
            .unwrap()
            .with_timezone(&Utc)
    }

    /// Réponse 200 réelle (anonymisée) sondée le 2026-07-15 : `limits[]`
    /// canonique (session 12 / weekly_all 2 / weekly_scoped 3), `seven_day_opus`
    /// null (la limite scoped n'existe que dans `limits[]`), plus quantité de
    /// champs inconnus/futurs à ignorer.
    const FIXTURE: &str = r#"{
  "five_hour": {
    "utilization": 12.0,
    "resets_at": "2026-07-15T12:39:59.820720+00:00",
    "limit_dollars": null,
    "used_dollars": null,
    "remaining_dollars": null
  },
  "seven_day": {
    "utilization": 2.0,
    "resets_at": "2026-07-21T21:59:59.820744+00:00",
    "limit_dollars": null,
    "used_dollars": null,
    "remaining_dollars": null
  },
  "seven_day_oauth_apps": null,
  "seven_day_opus": null,
  "seven_day_sonnet": null,
  "limits": [
    {
      "kind": "session",
      "group": "session",
      "percent": 12,
      "severity": "normal",
      "resets_at": "2026-07-15T12:39:59.820720+00:00",
      "scope": null,
      "is_active": true
    },
    {
      "kind": "weekly_all",
      "group": "weekly",
      "percent": 2,
      "severity": "normal",
      "resets_at": "2026-07-21T21:59:59.820744+00:00",
      "scope": null,
      "is_active": false
    },
    {
      "kind": "weekly_scoped",
      "group": "weekly",
      "percent": 3,
      "severity": "normal",
      "resets_at": "2026-07-21T21:59:59.821115+00:00",
      "scope": {
        "model": { "id": null, "display_name": "Fable" },
        "surface": null
      },
      "is_active": false
    }
  ]
}"#;

    #[test]
    fn parse_usage_response_real_fixture_uses_limits_array() {
        let usage = parse_usage_response(FIXTURE).expect("la fixture réelle doit parser");

        assert_eq!(usage.five_hour.percent, 12.0);
        assert_eq!(
            usage.five_hour.resets_at,
            Some(dt("2026-07-15T12:39:59.820720+00:00"))
        );

        assert_eq!(usage.seven_day.percent, 2.0);
        assert_eq!(
            usage.seven_day.resets_at,
            Some(dt("2026-07-21T21:59:59.820744+00:00"))
        );

        // scoped présent via limits[] alors que seven_day_opus est null.
        let scoped = usage.seven_day_scoped.expect("scoped présent via limits");
        assert_eq!(scoped.percent, 3.0);
        assert_eq!(
            scoped.resets_at,
            Some(dt("2026-07-21T21:59:59.821115+00:00"))
        );
    }

    #[test]
    fn parse_usage_response_null_session_reset_is_none() {
        // Aucune session en cours : resets_at null sur la fenêtre 5h.
        let raw = r#"{
            "limits": [
                { "kind": "session", "percent": 0, "resets_at": null },
                { "kind": "weekly_all", "percent": 5, "resets_at": "2026-07-21T00:00:00+00:00" }
            ]
        }"#;
        let usage = parse_usage_response(raw).expect("doit parser");
        assert_eq!(usage.five_hour.percent, 0.0);
        assert_eq!(usage.five_hour.resets_at, None);
        assert_eq!(usage.seven_day.percent, 5.0);
        assert!(usage.seven_day_scoped.is_none());
    }

    #[test]
    fn parse_usage_response_falls_back_to_top_level_when_limits_absent() {
        let raw = r#"{
            "five_hour": { "utilization": 12.0, "resets_at": "2026-07-15T12:00:00+00:00" },
            "seven_day": { "utilization": 2.0, "resets_at": "2026-07-21T00:00:00+00:00" },
            "seven_day_opus": null
        }"#;
        let usage = parse_usage_response(raw).expect("repli top-level doit parser");
        assert_eq!(usage.five_hour.percent, 12.0);
        assert_eq!(
            usage.five_hour.resets_at,
            Some(dt("2026-07-15T12:00:00+00:00"))
        );
        assert_eq!(usage.seven_day.percent, 2.0);
        // seven_day_opus null → pas de fenêtre scoped.
        assert!(usage.seven_day_scoped.is_none());
    }

    #[test]
    fn parse_usage_response_clamps_percent_into_zero_hundred() {
        let raw = r#"{
            "limits": [
                { "kind": "session", "percent": 150 },
                { "kind": "weekly_all", "percent": -5 }
            ]
        }"#;
        let usage = parse_usage_response(raw).expect("doit parser");
        assert_eq!(usage.five_hour.percent, 100.0);
        assert_eq!(usage.seven_day.percent, 0.0);
    }

    #[test]
    fn parse_usage_response_invalid_json_is_err() {
        assert!(parse_usage_response("pas du json {{{").is_err());
    }

    #[test]
    fn parse_usage_response_missing_session_and_weekly_is_err() {
        // Ni limits exploitables, ni champs top-level : shape mismatch.
        assert!(parse_usage_response("{}").is_err());
        assert!(parse_usage_response(r#"{"limits":[]}"#).is_err());
    }

    #[test]
    fn parse_usage_response_ignores_unknown_fields() {
        let raw = r#"{
            "future_field": { "nested": [1, 2, 3] },
            "limits": [
                { "kind": "session", "percent": 7, "totally_new": true },
                { "kind": "weekly_all", "percent": 8 },
                { "kind": "some_future_kind", "percent": 99 }
            ]
        }"#;
        let usage = parse_usage_response(raw).expect("les champs inconnus sont ignorés");
        assert_eq!(usage.five_hour.percent, 7.0);
        assert_eq!(usage.seven_day.percent, 8.0);
        assert!(usage.seven_day_scoped.is_none());
    }

    // -----------------------------------------------------------------------
    // official_gauges : mapping fenêtres -> jauges.
    // -----------------------------------------------------------------------

    #[test]
    fn official_gauges_maps_all_three_windows() {
        let usage = OfficialUsage {
            five_hour: OfficialWindow {
                percent: 12.0,
                resets_at: Some(dt("2026-07-15T12:00:00+00:00")),
            },
            seven_day: OfficialWindow {
                percent: 2.0,
                resets_at: Some(dt("2026-07-21T00:00:00+00:00")),
            },
            seven_day_scoped: Some(OfficialWindow {
                percent: 3.0,
                resets_at: Some(dt("2026-07-21T00:00:01+00:00")),
            }),
        };

        let gauges = official_gauges(&usage);

        for gauge in [&gauges.block_5h, &gauges.weekly, &gauges.weekly_fable] {
            assert_eq!(gauge.source, GaugeSource::Official);
            assert_eq!(gauge.used_tokens, None);
            assert_eq!(gauge.cap, None);
        }
        assert_eq!(gauges.block_5h.percent, 12.0);
        assert_eq!(gauges.block_5h.reset_at, Some(dt("2026-07-15T12:00:00+00:00")));
        assert_eq!(gauges.weekly.percent, 2.0);
        assert_eq!(gauges.weekly_fable.percent, 3.0);
        assert_eq!(
            gauges.weekly_fable.reset_at,
            Some(dt("2026-07-21T00:00:01+00:00"))
        );
    }

    #[test]
    fn official_gauges_scoped_none_yields_zero_official_weekly_fable() {
        let usage = OfficialUsage {
            five_hour: OfficialWindow {
                percent: 12.0,
                resets_at: None,
            },
            seven_day: OfficialWindow {
                percent: 2.0,
                resets_at: None,
            },
            seven_day_scoped: None,
        };

        let gauges = official_gauges(&usage);

        assert_eq!(gauges.weekly_fable.percent, 0.0);
        assert_eq!(gauges.weekly_fable.reset_at, None);
        assert_eq!(gauges.weekly_fable.used_tokens, None);
        assert_eq!(gauges.weekly_fable.cap, None);
        assert_eq!(gauges.weekly_fable.source, GaugeSource::Official);
    }

    // -----------------------------------------------------------------------
    // apply_official : remplacement des jauges + estimated=false, reste intact.
    // -----------------------------------------------------------------------

    /// Snapshot minimal pour tester `apply_official` (les helpers de test de
    /// snapshot.rs ne sont pas accessibles hors de son module). `estimated_gauge`
    /// est recopiée sur les 3 jauges, comme le ferait `build_snapshot` avant
    /// que `apply_official` ne les remplace/fusionne (tâche #31).
    fn minimal_snapshot_with_gauge(estimated_gauge: Gauge) -> Snapshot {
        use crate::collector::snapshot::{AccountSnapshot, Meta};

        Snapshot {
            gauges: Gauges {
                block_5h: estimated_gauge,
                weekly: estimated_gauge,
                weekly_fable: estimated_gauge,
            },
            mcps: vec![],
            projects: vec![],
            account: AccountSnapshot {
                plan: "Max".to_string(),
                tier: "claude_max_5x".to_string(),
                email: "keep@example.com".to_string(),
                org: "Acme".to_string(),
                default_model: "claude-fable-5".to_string(),
                cli_version: "2.1.4".to_string(),
                today_messages: 7,
                today_tokens: 1234,
            },
            meta: Meta {
                generated_at: dt("2026-07-15T10:00:00+00:00"),
                degraded: vec!["some_flag".to_string()],
                estimated: true,
            },
            history: vec![],
            chats: vec![],
        }
    }

    fn minimal_snapshot() -> Snapshot {
        minimal_snapshot_with_gauge(Gauge {
            used_tokens: Some(42),
            cap: Some(100),
            percent: 42.0,
            reset_at: Some(dt("2026-07-08T15:00:00+00:00")),
            source: GaugeSource::Estimated,
            tokens_source: Some(GaugeSource::Estimated),
        })
    }

    // -----------------------------------------------------------------------
    // merge_estimated_tokens : fusion pure tokens estimés -> jauge officielle
    // (tâche #31). percent/reset_at/source restent ceux de `official` dans
    // tous les cas ; seuls used_tokens/cap/tokens_source varient. La fusion
    // est gouvernée par `tokens_source` de l'estimation : `None` = estimation
    // locale indisponible (scan vide, signal posé par `build_snapshot`), à ne
    // JAMAIS confondre avec un vrai « 0 token consommé » (`Some(0)` +
    // tokens_source `Some(Estimated)`).
    // -----------------------------------------------------------------------

    fn official_gauge(percent: f64, reset_at: Option<DateTime<Utc>>) -> Gauge {
        Gauge {
            used_tokens: None,
            cap: None,
            percent,
            reset_at,
            source: GaugeSource::Official,
            tokens_source: None,
        }
    }

    fn estimated_gauge_with(
        used_tokens: Option<u64>,
        cap: Option<u64>,
        tokens_source: Option<GaugeSource>,
    ) -> Gauge {
        Gauge {
            used_tokens,
            cap,
            percent: 12.0,
            reset_at: Some(dt("2026-07-08T00:00:00+00:00")),
            source: GaugeSource::Estimated,
            tokens_source,
        }
    }

    #[test]
    fn merge_estimated_tokens_copies_tokens_cap_and_marks_estimated() {
        let official = official_gauge(55.0, Some(dt("2026-07-15T12:00:00+00:00")));
        let estimated = estimated_gauge_with(Some(42), Some(100), Some(GaugeSource::Estimated));

        let merged = merge_estimated_tokens(&official, &estimated);

        // Tokens/cap viennent de l'estimation, marqués "estimated".
        assert_eq!(merged.used_tokens, Some(42));
        assert_eq!(merged.cap, Some(100));
        assert_eq!(merged.tokens_source, Some(GaugeSource::Estimated));
        // percent/reset_at/source restent STRICTEMENT ceux de l'officiel.
        assert_eq!(merged.percent, 55.0);
        assert_eq!(merged.reset_at, Some(dt("2026-07-15T12:00:00+00:00")));
        assert_eq!(merged.source, GaugeSource::Official);
    }

    #[test]
    fn merge_estimated_tokens_copies_honest_zero_when_estimation_available() {
        // Historique local présent mais vraiment 0 usage dans la fenêtre :
        // le zéro est honnête (tokens_source Some), il peut s'afficher.
        let official = official_gauge(55.0, None);
        let estimated = estimated_gauge_with(Some(0), Some(100), Some(GaugeSource::Estimated));

        let merged = merge_estimated_tokens(&official, &estimated);

        assert_eq!(merged.used_tokens, Some(0));
        assert_eq!(merged.cap, Some(100));
        assert_eq!(merged.tokens_source, Some(GaugeSource::Estimated));
    }

    #[test]
    fn merge_estimated_tokens_noop_when_estimation_unavailable() {
        // État RÉEL du pipeline quand le scan transcripts est indisponible
        // (dossier absent, permissions, machine neuve) : make_gauge produit
        // toujours used_tokens Some(0), et c'est build_snapshot qui signale
        // l'indisponibilité via tokens_source: None. La jauge officielle doit
        // rester valide SANS tokens — jamais de « ≈ 0 tok (est.) » trompeur.
        let official = official_gauge(55.0, Some(dt("2026-07-15T12:00:00+00:00")));
        let estimated = estimated_gauge_with(Some(0), Some(100), None);

        let merged = merge_estimated_tokens(&official, &estimated);

        assert_eq!(merged.used_tokens, None);
        assert_eq!(merged.cap, None);
        assert_eq!(merged.tokens_source, None);
        assert_eq!(merged.percent, 55.0);
        assert_eq!(merged.source, GaugeSource::Official);
    }

    #[test]
    fn merge_estimated_tokens_noop_when_estimation_has_no_tokens_at_all() {
        // Défensif : used_tokens None (état que le pipeline actuel ne produit
        // pas — make_gauge pose toujours Some) ; le merge ne doit ni paniquer
        // ni inventer de tokens.
        let official = official_gauge(55.0, None);
        let estimated = estimated_gauge_with(None, None, None);

        let merged = merge_estimated_tokens(&official, &estimated);

        assert_eq!(merged, official);
    }

    // -----------------------------------------------------------------------
    // apply_official : merge des deux sources sur les 3 jauges (tâche #31).
    // -----------------------------------------------------------------------

    #[test]
    fn apply_official_replaces_gauges_and_clears_estimated_flag() {
        let mut snapshot = minimal_snapshot();
        let usage = OfficialUsage {
            five_hour: OfficialWindow {
                percent: 55.0,
                resets_at: Some(dt("2026-07-15T12:00:00+00:00")),
            },
            seven_day: OfficialWindow {
                percent: 66.0,
                resets_at: None,
            },
            seven_day_scoped: None,
        };

        apply_official(&mut snapshot, &usage);

        // Jauges remplacées par les officielles.
        assert_eq!(snapshot.gauges.block_5h.percent, 55.0);
        assert_eq!(snapshot.gauges.block_5h.source, GaugeSource::Official);
        assert_eq!(snapshot.gauges.weekly.percent, 66.0);
        assert_eq!(snapshot.gauges.weekly_fable.percent, 0.0);
        // Flag d'estimation levé.
        assert!(!snapshot.meta.estimated);

        // Tâche #31 : tokens estimés (42/100) fusionnés dans les 3 jauges
        // officielles, marqués "estimated", sans toucher percent/reset_at/source.
        for gauge in [
            &snapshot.gauges.block_5h,
            &snapshot.gauges.weekly,
            &snapshot.gauges.weekly_fable,
        ] {
            assert_eq!(gauge.used_tokens, Some(42));
            assert_eq!(gauge.cap, Some(100));
            assert_eq!(gauge.tokens_source, Some(GaugeSource::Estimated));
            assert_eq!(gauge.source, GaugeSource::Official);
        }

        // Le reste du snapshot est intact.
        assert_eq!(snapshot.account.email, "keep@example.com");
        assert_eq!(snapshot.account.today_tokens, 1234);
        assert_eq!(snapshot.meta.degraded, vec!["some_flag".to_string()]);
        assert_eq!(
            snapshot.meta.generated_at,
            dt("2026-07-15T10:00:00+00:00")
        );
    }

    fn fixture(name: &str) -> std::path::PathBuf {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    fn usage_12_2() -> OfficialUsage {
        OfficialUsage {
            five_hour: OfficialWindow {
                percent: 12.0,
                resets_at: Some(dt("2026-07-15T12:00:00+00:00")),
            },
            seven_day: OfficialWindow {
                percent: 2.0,
                resets_at: Some(dt("2026-07-21T00:00:00+00:00")),
            },
            seven_day_scoped: None,
        }
    }

    #[test]
    fn apply_official_on_unavailable_local_scan_keeps_official_gauges_without_tokens() {
        // Bout-en-bout sur le pipeline RÉEL : home dégradé (machine neuve,
        // dossier ~/.claude/projects absent, permissions — fixture "absent").
        // build_snapshot produit alors des jauges à used_tokens Some(0) MAIS
        // tokens_source: None (scan vide, files_scanned == 0). apply_official
        // ne doit fusionner AUCUN tokens : afficher « ≈ 0 tok (est.) » à côté
        // d'un pourcentage officiel fiable serait un zéro trompeur.
        use crate::collector::snapshot::{build_snapshot, DEFAULT_CAPS_PRO};

        let now = dt("2026-07-08T10:00:00+00:00");
        let mut snapshot = build_snapshot(&fixture("absent"), now, &DEFAULT_CAPS_PRO, None);

        // Précondition du bug corrigé : le pipeline réel produit bien Some(0),
        // jamais None — c'est tokens_source qui porte l'indisponibilité.
        assert_eq!(snapshot.gauges.block_5h.used_tokens, Some(0));
        assert_eq!(snapshot.gauges.block_5h.tokens_source, None);

        apply_official(&mut snapshot, &usage_12_2());

        for gauge in [
            &snapshot.gauges.block_5h,
            &snapshot.gauges.weekly,
            &snapshot.gauges.weekly_fable,
        ] {
            assert_eq!(gauge.used_tokens, None);
            assert_eq!(gauge.cap, None);
            assert_eq!(gauge.tokens_source, None);
            assert_eq!(gauge.source, GaugeSource::Official);
        }
        assert_eq!(snapshot.gauges.block_5h.percent, 12.0);
        assert_eq!(
            snapshot.gauges.block_5h.reset_at,
            Some(dt("2026-07-15T12:00:00+00:00"))
        );
        assert_eq!(snapshot.gauges.weekly.percent, 2.0);
    }

    #[test]
    fn apply_official_merges_honest_zero_from_real_history_without_window_usage() {
        // Bout-en-bout, cas légitime à distinguer du précédent : historique
        // local PRÉSENT (fixture snapshot_complete, événements à 09:00/09:30)
        // mais bloc 5h expiré à now=20:00 -> le pipeline produit block_5h à
        // used_tokens Some(0) AVEC tokens_source Some(Estimated) : ce zéro-là
        // est honnête (vraiment 0 usage dans la fenêtre) et PEUT s'afficher.
        use crate::collector::snapshot::{build_snapshot, DEFAULT_CAPS_MAX_5X};

        let now = dt("2026-07-08T20:00:00+00:00");
        let mut snapshot =
            build_snapshot(&fixture("snapshot_complete"), now, &DEFAULT_CAPS_MAX_5X, None);

        assert_eq!(snapshot.gauges.block_5h.used_tokens, Some(0));
        assert_eq!(
            snapshot.gauges.block_5h.tokens_source,
            Some(GaugeSource::Estimated)
        );

        apply_official(&mut snapshot, &usage_12_2());

        // Zéro honnête fusionné sur le bloc 5h, % officiel conservé.
        assert_eq!(snapshot.gauges.block_5h.used_tokens, Some(0));
        assert_eq!(
            snapshot.gauges.block_5h.tokens_source,
            Some(GaugeSource::Estimated)
        );
        assert_eq!(snapshot.gauges.block_5h.percent, 12.0);
        assert_eq!(snapshot.gauges.block_5h.source, GaugeSource::Official);
        // La weekly récupère les vrais tokens estimés de la fixture (1800
        // pondérés, cf. le test de contrat de snapshot.rs).
        assert_eq!(snapshot.gauges.weekly.used_tokens, Some(1800));
        assert_eq!(
            snapshot.gauges.weekly.tokens_source,
            Some(GaugeSource::Estimated)
        );
        assert_eq!(snapshot.gauges.weekly.percent, 2.0);
    }

    // -----------------------------------------------------------------------
    // cache_is_fresh : décision de cache pure.
    // -----------------------------------------------------------------------

    #[test]
    fn cache_is_fresh_within_max_age() {
        let fetched = dt("2026-07-15T10:00:00+00:00");
        let now = dt("2026-07-15T10:00:30+00:00");
        assert!(cache_is_fresh(fetched, now, Duration::seconds(60)));
    }

    #[test]
    fn cache_is_fresh_false_when_older_than_max_age() {
        let fetched = dt("2026-07-15T10:00:00+00:00");
        let now = dt("2026-07-15T10:05:00+00:00");
        assert!(!cache_is_fresh(fetched, now, Duration::seconds(60)));
    }

    /// Smoke test manuel sur les vraies credentials de la machine : lecture
    /// seule (Keychain/`.credentials.json` → appel réel de l'endpoint usage),
    /// jamais exécuté par la CI (`#[ignore]`). Lancer avec
    /// `cargo test -- --ignored resolve_smoke_test_on_real_home`.
    #[test]
    #[ignore]
    fn resolve_smoke_test_on_real_home() {
        let home = crate::collector::snapshot::resolve_home();
        let state = OfficialUsageState::default();
        let usage = resolve(&state, &home, Utc::now(), Duration::seconds(0));
        match usage {
            Some(u) => {
                println!(
                    "smoke test réel : five_hour={}% (reset {:?}) seven_day={}% (reset {:?}) scoped={:?}",
                    u.five_hour.percent,
                    u.five_hour.resets_at,
                    u.seven_day.percent,
                    u.seven_day.resets_at,
                    u.seven_day_scoped
                        .as_ref()
                        .map(|w| (w.percent, w.resets_at)),
                );
                let gauges = official_gauges(&u);
                assert!((0.0..=100.0).contains(&gauges.block_5h.percent));
                assert!(gauges.block_5h.used_tokens.is_none());
            }
            None => println!(
                "smoke test réel : indisponible (pas de credentials, token expiré ou réseau) — repli estimé attendu dans l'app"
            ),
        }
    }
}
