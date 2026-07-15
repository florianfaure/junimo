//! Fenêtres glissantes de consommation : bloc 5h courant et fenêtre 7 jours
//! (globale et par famille de modèle "fable_opus"), voir
//! `docs/specs/2026-07-09-junimo.md`, section « Calcul des jauges ».
//!
//! Logique **pure** : aucune I/O, aucune lecture d'horloge — `now` est
//! toujours passé en paramètre par l'appelant (jamais `Utc::now()` ici).
//!
//! ## Précondition sur `events`
//!
//! `events` doit être trié par `ts` croissant. C'est garanti par
//! [`super::transcripts::collect_events`] (voir son commentaire de fonction :
//! `events.sort_by_key(|e| e.ts)` avant retour). Décision : on **n'ajoute
//! pas de tri défensif silencieux** ici — un tri masquerait une régression
//! amont sans jamais la signaler, et le coût d'un tri redondant à chaque
//! appel n'est pas justifié pour un module qui n'a qu'un seul appelant
//! interne. À la place, [`compute_gauges`] pose un `debug_assert!` qui panique
//! en build debug (dev + `cargo test`) si la précondition est violée ; en
//! release, on fait confiance au contrat documenté plutôt que de payer le
//! coût d'une vérification silencieuse qui masquerait le même bug.

use super::transcripts::UsageEvent;
use chrono::{DateTime, Duration, Timelike, Utc};

/// Poids relatif de chaque catégorie de tokens dans le total pondéré d'un
/// événement. Ce ne sont **pas** des poids officiels Anthropic (aucun n'est
/// publié) : ils sont réunis ici pour être ajustables en un seul endroit.
/// `WEIGHT_CACHE_READ = 0.01` a été **résolu par calibration deux points**
/// (2026-07-10) : deux lectures de `/usage` (7 % puis 12 % du compteur
/// session) croisées avec les composantes locales donnent un poids de
/// ~0,0102 pour le cache read et vérifient les deux points à 0,1 % près.
pub const WEIGHT_INPUT: f64 = 1.0;
pub const WEIGHT_OUTPUT: f64 = 1.0;
pub const WEIGHT_CACHE_CREATION: f64 = 1.0;
pub const WEIGHT_CACHE_READ: f64 = 0.01;

/// Durée d'un bloc de facturation "5 heures" côté Anthropic.
const BLOCK_DURATION_HOURS: i64 = 5;
/// Largeur de la fenêtre glissante hebdomadaire.
const WEEKLY_WINDOW_DAYS: i64 = 7;

/// Plafonds, en tokens pondérés, utilisés pour calculer les pourcentages des
/// jauges. Valeurs par défaut selon le plan détecté — résolues ailleurs
/// (config), ce module ne fait que consommer les plafonds fournis.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Caps {
    pub block_5h: u64,
    pub weekly: u64,
    pub weekly_fable: u64,
}

/// Origine des valeurs d'une [`Gauge`] : estimation locale (calcul à partir
/// des transcripts) ou donnée officielle (endpoint `/usage`, voir la tâche
/// #23). En mode officiel, `used_tokens`/`cap` sont `None` (seul `/usage`
/// expose le pourcentage et le reset, pas le détail en tokens).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GaugeSource {
    Official,
    Estimated,
}

/// Une jauge unique : consommation, plafond, pourcentage clampé, heure de
/// reset le cas échéant, et origine de la donnée.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Gauge {
    pub used_tokens: Option<u64>,
    pub cap: Option<u64>,
    pub percent: f64,
    pub reset_at: Option<DateTime<Utc>>,
    pub source: GaugeSource,
    /// Origine de `used_tokens`/`cap` spécifiquement (tâche #31), indépendante
    /// de `source` (qui gouverne `percent`/`reset_at`). `Some(Estimated)` tant
    /// que des tokens sont présents (ils ne sont **jamais** officiels,
    /// `/usage` n'expose aucun détail en tokens) ; `None` si aucun tokens
    /// n'est disponible (ex. jauge officielle sans estimation locale
    /// fusionnée, ou estimation locale elle-même indisponible). Permet au
    /// front de distinguer « jauge officielle enrichie de tokens estimés »
    /// sans dépendre implicitement de la présence de `used_tokens`.
    pub tokens_source: Option<GaugeSource>,
}

/// Les trois jauges exposées au front : bloc 5h courant, 7 jours global, 7
/// jours famille Fable/Opus.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Gauges {
    pub block_5h: Gauge,
    pub weekly: Gauge,
    pub weekly_fable: Gauge,
}

/// Calcule les trois jauges à partir des événements d'usage.
///
/// # Précondition
/// `events` doit être trié par `ts` croissant (voir le commentaire de
/// module). Violée en build debug → panic via `debug_assert!`.
///
/// # Fenêtre hebdomadaire
/// Si `weekly_anchor` est fourni (référence de reset : idéalement recopiée
/// une fois depuis `/usage` via le réglage `weekly_reset_reference`, sinon
/// estimée), la fenêtre 7 jours est **fixe sur la grille**
/// `[anchor + k·7j, anchor + (k+1)·7j)` contenant `now` — la référence peut
/// être passée ou future. Sans ancre : repli glissant `[now - 7j, now]`.
pub fn compute_gauges(
    events: &[UsageEvent],
    now: DateTime<Utc>,
    caps: &Caps,
    weekly_anchor: Option<DateTime<Utc>>,
) -> Gauges {
    debug_assert!(
        events.windows(2).all(|pair| pair[0].ts <= pair[1].ts),
        "compute_gauges requiert des événements triés par ts croissant \
         (précondition garantie par collect_events)"
    );

    let block_5h = compute_block_5h(events, now, caps.block_5h);
    let (weekly, weekly_fable) = compute_weekly(events, now, caps, weekly_anchor);

    Gauges {
        block_5h,
        weekly,
        weekly_fable,
    }
}

/// Total pondéré des tokens d'un événement (voir les constantes `WEIGHT_*`
/// en tête de module). `pub` : réutilisée par `collector::snapshot` pour le
/// calcul de l'activité du jour (`today_messages`/`today_tokens`), avec les
/// mêmes constantes de pondération que les jauges.
pub fn weighted_tokens(ev: &UsageEvent) -> f64 {
    let t = &ev.tokens;
    t.input as f64 * WEIGHT_INPUT
        + t.output as f64 * WEIGHT_OUTPUT
        + t.cache_creation as f64 * WEIGHT_CACHE_CREATION
        + t.cache_read as f64 * WEIGHT_CACHE_READ
}

/// Arrondit `ts` à la demi-heure inférieure (:00 ou :30), point de départ
/// d'un bloc 5h. Calibré sur `/usage` (2026-07-10) : un bloc démarré vers
/// 8h3x affiche « Resets 1:30pm », donc une granularité à la demi-heure —
/// l'arrondi à l'heure pleine donnait 13:00.
fn floor_half_hour(ts: DateTime<Utc>) -> DateTime<Utc> {
    let half = if ts.minute() >= 30 { 30 } else { 0 };
    ts.with_minute(half)
        .and_then(|d| d.with_second(0))
        .and_then(|d| d.with_nanosecond(0))
        .expect("with_minute/with_second/with_nanosecond ne peuvent échouer")
}

/// Construit une [`Gauge`] à partir d'une somme pondérée (arrondie une seule
/// fois, au niveau de la jauge, pour éviter l'accumulation d'erreurs
/// d'arrondi événement par événement) et d'un plafond.
fn make_gauge(weighted_sum: f64, cap: u64, reset_at: Option<DateTime<Utc>>) -> Gauge {
    let used_tokens = weighted_sum.round().max(0.0) as u64;
    let percent = if cap == 0 {
        0.0
    } else {
        (used_tokens as f64 / cap as f64 * 100.0).clamp(0.0, 100.0)
    };

    Gauge {
        used_tokens: Some(used_tokens),
        cap: Some(cap),
        percent,
        reset_at,
        source: GaugeSource::Estimated,
        tokens_source: Some(GaugeSource::Estimated),
    }
}

/// Regroupe les événements en blocs 5h non chevauchants (voir l'algorithme
/// décrit dans le commentaire de module et le brief de la tâche) et retourne
/// la jauge du bloc qui contient `now`, ou une jauge à zéro sans reset si
/// aucun bloc ne le contient (dernier bloc déjà expiré, ou aucun événement).
fn compute_block_5h(events: &[UsageEvent], now: DateTime<Utc>, cap: u64) -> Gauge {
    let mut current_start: Option<DateTime<Utc>> = None;
    let mut current_end: Option<DateTime<Utc>> = None;
    let mut current_sum: f64 = 0.0;
    let mut found: Option<(f64, DateTime<Utc>)> = None;

    for e in events {
        let opens_new_block = match current_end {
            Some(end) => e.ts >= end,
            None => true,
        };

        if opens_new_block {
            // Le bloc qu'on referme peut être celui qui contient `now` :
            // on le vérifie avant de l'écraser.
            if let (Some(start), Some(end)) = (current_start, current_end) {
                if now >= start && now < end {
                    found = Some((current_sum, end));
                }
            }

            let start = floor_half_hour(e.ts);
            let end = start + Duration::hours(BLOCK_DURATION_HOURS);
            current_start = Some(start);
            current_end = Some(end);
            current_sum = 0.0;
        }

        current_sum += weighted_tokens(e);
    }

    // Le dernier bloc ouvert n'a pas été vérifié dans la boucle.
    if let (Some(start), Some(end)) = (current_start, current_end) {
        if now >= start && now < end {
            found = Some((current_sum, end));
        }
    }

    match found {
        Some((sum, end)) => make_gauge(sum, cap, Some(end)),
        None => make_gauge(0.0, cap, None),
    }
}

/// `true` si `model` appartient à la famille "fable_opus" (insensible à la
/// casse), `false` sinon (famille standard : sonnet, haiku, etc.).
fn is_fable_opus(model: &str) -> bool {
    let m = model.to_lowercase();
    m.contains("fable") || m.contains("opus")
}

/// Calcule la jauge 7 jours globale et sa déclinaison famille "fable_opus"
/// en un seul passage sur `events` (trié croissant, donc le premier
/// événement de la fenêtre rencontré est le plus ancien).
///
/// Deux modes (voir [`compute_gauges`]) : fenêtre **fixe ancrée** quand
/// `anchor` est fourni et précède `now` (reset connu = fin de fenêtre, même
/// sans événement), fenêtre **glissante** sinon (reset = plus ancien
/// événement + 7j).
fn compute_weekly(
    events: &[UsageEvent],
    now: DateTime<Utc>,
    caps: &Caps,
    anchor: Option<DateTime<Utc>>,
) -> (Gauge, Gauge) {
    // La référence peut être passée OU future (l'utilisateur recopie le
    // prochain reset affiché par /usage) : div_euclid ramène toujours à la
    // fenêtre de la grille qui contient `now`.
    let anchored_window = anchor.map(|a| {
        let elapsed = (now - a).num_seconds();
        let period = WEEKLY_WINDOW_DAYS * 86_400;
        let k = elapsed.div_euclid(period);
        let start = a + Duration::seconds(k * period);
        (start, start + Duration::days(WEEKLY_WINDOW_DAYS))
    });

    if let Some((window_start, window_end)) = anchored_window {
        let mut sum_all: f64 = 0.0;
        let mut sum_fable: f64 = 0.0;

        for e in events {
            if e.ts < window_start || e.ts > now {
                continue;
            }
            let w = weighted_tokens(e);
            sum_all += w;
            if is_fable_opus(&e.model) {
                sum_fable += w;
            }
        }

        // Fenêtre ancrée : le reset est structurel (fin de fenêtre), il est
        // connu même sans aucun événement dans la fenêtre.
        return (
            make_gauge(sum_all, caps.weekly, Some(window_end)),
            make_gauge(sum_fable, caps.weekly_fable, Some(window_end)),
        );
    }

    let window_start = now - Duration::days(WEEKLY_WINDOW_DAYS);

    let mut sum_all: f64 = 0.0;
    let mut sum_fable: f64 = 0.0;
    let mut oldest_all: Option<DateTime<Utc>> = None;
    let mut oldest_fable: Option<DateTime<Utc>> = None;

    for e in events {
        if e.ts < window_start || e.ts > now {
            continue;
        }

        let w = weighted_tokens(e);
        sum_all += w;
        if oldest_all.is_none() {
            oldest_all = Some(e.ts);
        }

        if is_fable_opus(&e.model) {
            sum_fable += w;
            if oldest_fable.is_none() {
                oldest_fable = Some(e.ts);
            }
        }
    }

    let reset_all = oldest_all.map(|ts| ts + Duration::days(WEEKLY_WINDOW_DAYS));
    let reset_fable = oldest_fable.map(|ts| ts + Duration::days(WEEKLY_WINDOW_DAYS));

    (
        make_gauge(sum_all, caps.weekly, reset_all),
        make_gauge(sum_fable, caps.weekly_fable, reset_fable),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collector::transcripts::TokenCounts;

    fn ts(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn ev(ts_str: &str, model: &str, tokens: TokenCounts) -> UsageEvent {
        UsageEvent {
            ts: ts(ts_str),
            model: model.to_string(),
            tokens,
            project: String::new(),
        }
    }

    fn simple(ts_str: &str, input: u64) -> UsageEvent {
        ev(
            ts_str,
            "claude-sonnet-5",
            TokenCounts {
                input,
                output: 0,
                cache_creation: 0,
                cache_read: 0,
            },
        )
    }

    fn caps() -> Caps {
        Caps {
            block_5h: 1000,
            weekly: 10_000,
            weekly_fable: 5_000,
        }
    }

    // --- Bornes exactes du bloc 5h ---

    #[test]
    fn event_exactly_at_floor_hour_opens_block_from_that_hour() {
        let events = vec![simple("2026-07-08T10:00:00Z", 100)];
        let now = ts("2026-07-08T10:00:00Z");
        let g = compute_gauges(&events, now, &caps(), None);

        assert_eq!(g.block_5h.used_tokens, Some(100));
        assert_eq!(g.block_5h.reset_at, Some(ts("2026-07-08T15:00:00Z")));
    }

    #[test]
    fn event_just_before_block_end_stays_in_current_block() {
        // bloc ouvert par un event à 10:00 -> [10:00, 15:00)
        let events = vec![
            simple("2026-07-08T10:00:00Z", 100),
            simple("2026-07-08T14:59:59Z", 50),
        ];
        let now = ts("2026-07-08T14:59:59Z");
        let g = compute_gauges(&events, now, &caps(), None);

        assert_eq!(g.block_5h.used_tokens, Some(150));
        assert_eq!(g.block_5h.reset_at, Some(ts("2026-07-08T15:00:00Z")));
    }

    #[test]
    fn event_exactly_at_block_end_opens_a_new_block_exclusive_bound() {
        let events = vec![
            simple("2026-07-08T10:00:00Z", 100),
            simple("2026-07-08T15:00:00Z", 50),
        ];
        let now = ts("2026-07-08T15:00:00Z");
        let g = compute_gauges(&events, now, &caps(), None);

        // now tombe dans le NOUVEAU bloc [15:00, 20:00), qui ne contient que
        // le deuxième événement.
        assert_eq!(g.block_5h.used_tokens, Some(50));
        assert_eq!(g.block_5h.reset_at, Some(ts("2026-07-08T20:00:00Z")));
    }

    // --- Chaîne de blocs avec trou ---

    #[test]
    fn chain_of_blocks_with_gap_only_current_block_counts() {
        // events à 08:10, 09:00, 15:30 ; now=16:00
        // bloc 1 (08:10 -> floor ½h 08:00) : [08:00,13:00) contient 08:10 et 09:00
        // bloc 2 (15:30 -> floor ½h 15:30) : [15:30,20:30) contient seulement 15:30
        let events = vec![
            simple("2026-07-08T08:10:00Z", 10),
            simple("2026-07-08T09:00:00Z", 20),
            simple("2026-07-08T15:30:00Z", 30),
        ];
        let now = ts("2026-07-08T16:00:00Z");
        let g = compute_gauges(&events, now, &caps(), None);

        assert_eq!(g.block_5h.used_tokens, Some(30));
        assert_eq!(g.block_5h.reset_at, Some(ts("2026-07-08T20:30:00Z")));
    }

    #[test]
    fn now_outside_any_block_yields_zero_gauge_and_no_reset() {
        // dernier événement il y a 6h : le bloc [floor(ts), +5h) est déjà
        // terminé, `now` ne tombe dans aucun bloc.
        let events = vec![simple("2026-07-08T04:00:00Z", 100)];
        let now = ts("2026-07-08T10:00:00Z");
        let g = compute_gauges(&events, now, &caps(), None);

        assert_eq!(g.block_5h.used_tokens, Some(0));
        assert_eq!(g.block_5h.reset_at, None);
    }

    // --- Familles de modèle ---

    #[test]
    fn model_families_split_fable_opus_from_standard() {
        let now = ts("2026-07-08T12:00:00Z");
        let events = vec![
            ev(
                "2026-07-05T00:00:00Z",
                "claude-fable-5",
                TokenCounts {
                    input: 10,
                    output: 0,
                    cache_creation: 0,
                    cache_read: 0,
                },
            ),
            ev(
                "2026-07-05T01:00:00Z",
                "claude-opus-4-8",
                TokenCounts {
                    input: 20,
                    output: 0,
                    cache_creation: 0,
                    cache_read: 0,
                },
            ),
            ev(
                "2026-07-05T02:00:00Z",
                "claude-sonnet-5",
                TokenCounts {
                    input: 40,
                    output: 0,
                    cache_creation: 0,
                    cache_read: 0,
                },
            ),
            ev(
                "2026-07-05T03:00:00Z",
                "claude-haiku-4-5",
                TokenCounts {
                    input: 80,
                    output: 0,
                    cache_creation: 0,
                    cache_read: 0,
                },
            ),
        ];

        let g = compute_gauges(&events, now, &caps(), None);

        assert_eq!(g.weekly.used_tokens, Some(10 + 20 + 40 + 80));
        assert_eq!(g.weekly_fable.used_tokens, Some(10 + 20));
    }

    // --- Fenêtre 7 jours : bornes ---

    #[test]
    fn weekly_window_excludes_event_one_second_before_seven_days_ago() {
        let now = ts("2026-07-08T00:00:00Z");
        let events = vec![simple("2026-07-01T00:00:00Z", 999)]; // now - 7j - 1s... voir test suivant pour la borne incluse
        // ici l'événement est à now - 7j exactement -> inclus ; on vérifie
        // l'exclusion dans le test dédié ci-dessous avec -1s.
        let g = compute_gauges(&events, now, &caps(), None);
        assert_eq!(g.weekly.used_tokens, Some(999));
    }

    #[test]
    fn weekly_window_excludes_before_and_includes_at_seven_days_boundary() {
        let now = ts("2026-07-08T00:00:00Z");
        let excluded = simple("2026-06-30T23:59:59Z", 111); // now - 7j - 1s
        let included = simple("2026-07-01T00:00:00Z", 222); // now - 7j exactement
        let events = vec![excluded, included];

        let g = compute_gauges(&events, now, &caps(), None);

        assert_eq!(g.weekly.used_tokens, Some(222));
        assert_eq!(g.weekly.reset_at, Some(ts("2026-07-08T00:00:00Z")));
    }

    // --- Pondération cache_read ---

    #[test]
    fn cache_read_is_weighted_at_one_percent() {
        let now = ts("2026-07-08T10:00:00Z");
        let events = vec![ev(
            "2026-07-08T10:00:00Z",
            "claude-sonnet-5",
            TokenCounts {
                input: 0,
                output: 0,
                cache_creation: 0,
                cache_read: 100,
            },
        )];

        let g = compute_gauges(&events, now, &caps(), None);

        // 100 cache_read * 0.01 = 1 token pondéré.
        assert_eq!(g.block_5h.used_tokens, Some(1));
        assert_eq!(g.weekly.used_tokens, Some(1));
    }

    #[test]
    fn all_four_weights_combine_additively() {
        let now = ts("2026-07-08T10:00:00Z");
        let events = vec![ev(
            "2026-07-08T10:00:00Z",
            "claude-sonnet-5",
            TokenCounts {
                input: 10,
                output: 20,
                cache_creation: 30,
                cache_read: 100,
            },
        )];

        let g = compute_gauges(&events, now, &caps(), None);

        // 10*1 + 20*1 + 30*1 + 100*0.01 = 61
        assert_eq!(g.block_5h.used_tokens, Some(61));
    }

    // --- Cas limites ---

    // --- tokens_source (tâche #31) : toujours "estimated" en mode local ---

    #[test]
    fn make_gauge_marks_tokens_source_estimated_when_tokens_present() {
        let events = vec![simple("2026-07-08T10:00:00Z", 100)];
        let now = ts("2026-07-08T10:00:00Z");
        let g = compute_gauges(&events, now, &caps(), None);

        assert_eq!(g.block_5h.tokens_source, Some(GaugeSource::Estimated));
        assert_eq!(g.weekly.tokens_source, Some(GaugeSource::Estimated));
        assert_eq!(g.weekly_fable.tokens_source, Some(GaugeSource::Estimated));
    }

    #[test]
    fn empty_events_yield_zeroed_gauges_with_no_reset() {
        let now = ts("2026-07-08T10:00:00Z");
        let g = compute_gauges(&[], now, &caps(), None);

        assert_eq!(g.block_5h.used_tokens, Some(0));
        assert_eq!(g.block_5h.reset_at, None);
        assert_eq!(g.weekly.used_tokens, Some(0));
        assert_eq!(g.weekly.reset_at, None);
        assert_eq!(g.weekly_fable.used_tokens, Some(0));
        assert_eq!(g.weekly_fable.reset_at, None);
        assert_eq!(g.block_5h.percent, 0.0);
        assert_eq!(g.weekly.percent, 0.0);
        assert_eq!(g.weekly_fable.percent, 0.0);
    }

    #[test]
    fn percent_is_clamped_at_one_hundred_when_used_exceeds_cap() {
        let now = ts("2026-07-08T10:00:00Z");
        let events = vec![simple("2026-07-08T10:00:00Z", 5_000)];
        let small_caps = Caps {
            block_5h: 100,
            weekly: 100,
            weekly_fable: 100,
        };

        let g = compute_gauges(&events, now, &small_caps, None);

        assert_eq!(g.block_5h.used_tokens, Some(5_000));
        assert_eq!(g.block_5h.percent, 100.0);
    }

    #[test]
    fn percent_is_zero_when_cap_is_zero_even_with_usage() {
        let now = ts("2026-07-08T10:00:00Z");
        let events = vec![simple("2026-07-08T10:00:00Z", 5_000)];
        let zero_caps = Caps {
            block_5h: 0,
            weekly: 0,
            weekly_fable: 0,
        };

        let g = compute_gauges(&events, now, &zero_caps, None);

        assert_eq!(g.block_5h.percent, 0.0);
        assert_eq!(g.weekly.percent, 0.0);
    }

    // --- Fenêtre hebdomadaire ancrée ---

    #[test]
    fn anchored_weekly_counts_only_events_in_current_fixed_window() {
        // ancre 01/07 12:00 ; now 09/07 00:00 -> fenêtre courante [08/07 12:00, 15/07 12:00)
        let anchor = ts("2026-07-01T12:00:00Z");
        let now = ts("2026-07-09T00:00:00Z");
        let events = vec![
            simple("2026-07-08T11:00:00Z", 100), // avant la fenêtre courante -> exclu
            simple("2026-07-08T13:00:00Z", 200), // dans la fenêtre -> inclus
        ];

        let g = compute_gauges(&events, now, &caps(), Some(anchor));

        assert_eq!(g.weekly.used_tokens, Some(200));
        assert_eq!(g.weekly.reset_at, Some(ts("2026-07-15T12:00:00Z")));
    }

    #[test]
    fn anchored_weekly_reset_is_window_end_even_without_events() {
        let anchor = ts("2026-07-01T12:00:00Z");
        let now = ts("2026-07-09T00:00:00Z");

        let g = compute_gauges(&[], now, &caps(), Some(anchor));

        assert_eq!(g.weekly.used_tokens, Some(0));
        assert_eq!(g.weekly.reset_at, Some(ts("2026-07-15T12:00:00Z")));
        assert_eq!(g.weekly_fable.reset_at, Some(ts("2026-07-15T12:00:00Z")));
    }

    #[test]
    fn anchored_weekly_splits_model_families() {
        let anchor = ts("2026-07-01T12:00:00Z");
        let now = ts("2026-07-09T00:00:00Z");
        let events = vec![
            ev(
                "2026-07-08T13:00:00Z",
                "claude-fable-5",
                TokenCounts {
                    input: 30,
                    output: 0,
                    cache_creation: 0,
                    cache_read: 0,
                },
            ),
            ev(
                "2026-07-08T14:00:00Z",
                "claude-sonnet-5",
                TokenCounts {
                    input: 50,
                    output: 0,
                    cache_creation: 0,
                    cache_read: 0,
                },
            ),
        ];

        let g = compute_gauges(&events, now, &caps(), Some(anchor));

        assert_eq!(g.weekly.used_tokens, Some(80));
        assert_eq!(g.weekly_fable.used_tokens, Some(30));
    }

    #[test]
    fn future_reference_projects_grid_backwards_onto_current_window() {
        // Référence future (l'utilisateur recopie le prochain reset /usage) :
        // la grille se projette en arrière. 01/08 - 4·7j = 04/07 ->
        // fenêtre courante [04/07, 11/07) pour now=08/07.
        let reference = ts("2026-08-01T00:00:00Z");
        let now = ts("2026-07-08T00:00:00Z");
        let events = vec![simple("2026-07-05T00:00:00Z", 100)];

        let g = compute_gauges(&events, now, &caps(), Some(reference));

        assert_eq!(g.weekly.used_tokens, Some(100));
        assert_eq!(g.weekly.reset_at, Some(ts("2026-07-11T00:00:00Z")));
    }

    #[test]
    fn block_starting_after_half_hour_resets_on_half_hour() {
        // Calibration /usage : granularité à la demi-heure, pas à l'heure.
        let events = vec![simple("2026-07-08T10:31:00Z", 100)];
        let now = ts("2026-07-08T10:31:00Z");

        let g = compute_gauges(&events, now, &caps(), None);

        assert_eq!(g.block_5h.reset_at, Some(ts("2026-07-08T15:30:00Z")));
    }

    // --- Précondition de tri ---

    #[test]
    #[should_panic(expected = "triés par ts croissant")]
    fn unsorted_events_trigger_debug_assert_panic() {
        let now = ts("2026-07-08T10:00:00Z");
        let events = vec![
            simple("2026-07-08T10:00:00Z", 1),
            simple("2026-07-08T09:00:00Z", 1),
        ];
        let _ = compute_gauges(&events, now, &caps(), None);
    }
}
