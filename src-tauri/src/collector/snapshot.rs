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
use chrono::{DateTime, Duration, Local, NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Fenêtre de scan des transcripts en amont des jauges : 15 jours, pour
/// couvrir l'historique 14 jours (voir [`HISTORY_DAYS`]) avec une marge (même
/// ordre de grandeur que `MTIME_CUTOFF_DAYS` dans `transcripts.rs`). Les
/// jauges/projets/today ne changent pas : ils filtrent déjà sur leurs propres
/// fenêtres (7 jours, minuit local, etc.).
const SNAPSHOT_LOOKBACK_DAYS: i64 = 15;

/// Nombre de jours d'historique quotidien exposés dans la section
/// « Historique » de l'overlay (voir [`daily_history`] / [`DayUsage`]).
/// Compromis 7-30 pour tenir le budget de scan (< 500 ms).
pub const HISTORY_DAYS: i64 = 14;

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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppSettings {
    pub caps: Option<CapsSettings>,
    /// Référence de reset de la fenêtre hebdomadaire (RFC3339), à recopier
    /// une fois depuis `/usage` (ex. `"2026-07-15T00:00:00+02:00"`). La
    /// grille 7 jours se projette dessus dans les deux sens ; sans elle, la
    /// référence est estimée depuis l'historique local (moins fiable).
    pub weekly_reset_reference: Option<String>,
    /// Raccourci clavier global (tâche #12) pour basculer l'overlay,
    /// au format accelerator Tauri (ex. `"Alt+Cmd+J"`, voir la doc de
    /// `tauri-plugin-global-shortcut`). `None` ou chaîne vide -> défaut
    /// `shortcut::DEFAULT_SHORTCUT`. Uniquement rechargé au démarrage de
    /// l'app (pas de ré-enregistrement à chaud si modifié en cours de
    /// session, voir la future section réglages, tâche #13).
    pub global_shortcut: Option<String>,
    /// Personnalisation du junimo (tâche #33) : forme, couleur, accessoire,
    /// nom affiché dans le header. `#[serde(default)]` : les fichiers
    /// `junimo-settings.json` écrits avant cette tâche n'ont pas cette clé et
    /// doivent continuer à se désérialiser (valeurs par défaut appliquées),
    /// jamais d'erreur/panic sur un JSON ancien.
    #[serde(default)]
    pub junimo: JunimoSettings,
    /// Apparence de l'overlay (tâche #40) : `"light"` (défaut, prioritaire)
    /// ou `"dark"`. Le thème ne suit plus automatiquement le système
    /// (`prefers-color-scheme`) : l'utilisateur choisit explicitement dans
    /// les réglages. `String` brute (même choix que `JunimoSettings`) pour
    /// que la désérialisation ne puisse jamais échouer sur une valeur
    /// inconnue ou obsolète — la validation se fait via
    /// [`sanitize_appearance`]. `#[serde(default = ...)]` : les fichiers
    /// écrits avant cette tâche n'ont pas cette clé, défaut `"light"`.
    #[serde(default = "default_appearance")]
    pub appearance: String,
}

/// Implémentation manuelle (plutôt que `#[derive(Default)]`) : `appearance`
/// doit défaut sur `"light"`, pas sur `String::default()` (chaîne vide).
impl Default for AppSettings {
    fn default() -> Self {
        Self {
            caps: None,
            weekly_reset_reference: None,
            global_shortcut: None,
            junimo: JunimoSettings::default(),
            appearance: default_appearance(),
        }
    }
}

/// Valeur par défaut du champ `appearance` (tâche #40) : light-first, on ne
/// suit plus le thème système.
fn default_appearance() -> String {
    "light".to_string()
}

/// Valeurs valides pour `AppSettings::appearance` (tâche #40).
const VALID_APPEARANCES: [&str; 2] = ["light", "dark"];

/// Valide/nettoie une apparence lue depuis le disque : toute valeur absente
/// de la liste connue retombe sur `"light"` plutôt que d'être propagée telle
/// quelle au front. Fonction pure, appelée par [`load_settings`] à chaque
/// lecture — jamais de panic, quel que soit le contenu du fichier (même
/// logique défensive que [`sanitize_junimo`]).
pub fn sanitize_appearance(appearance: String) -> String {
    if VALID_APPEARANCES.contains(&appearance.as_str()) {
        appearance
    } else {
        default_appearance()
    }
}

/// Identifiants de forme/couleur/accessoire valides, dupliqués depuis
/// `src/junimo/model.ts` (`JUNIMO_SHAPES`/`JUNIMO_COLORS`/`JUNIMO_ACCESSORIES`)
/// côté Rust : ce module ne dépend pas du front, la validation se fait donc
/// contre ces listes littérales plutôt qu'un import partagé. À tenir à jour
/// si le module de composition gagne une forme/couleur/accessoire.
const JUNIMO_VALID_SHAPES: [&str; 6] = ["classic", "round", "star", "square", "drop", "ghost"];
const JUNIMO_VALID_COLORS: [&str; 10] = [
    "green", "blue", "purple", "pink", "coral", "amber", "teal", "orange", "slate", "mint",
];
const JUNIMO_VALID_ACCESSORIES: [&str; 9] = [
    "none", "hat", "bow", "glasses", "flower", "antenna", "crown", "scarf", "cap",
];

/// Longueur maximale acceptée pour le nom personnalisé du junimo (défensif :
/// évite un header qui déborde indéfiniment sur un nom aberrant).
const JUNIMO_NAME_MAX_LEN: usize = 40;

/// Personnalisation du junimo (tâche #33), persistée dans
/// `junimo-settings.json` aux côtés du reste de [`AppSettings`]. Les champs
/// `shape`/`color`/`accessory` restent de simples `String` (pas d'enum serde)
/// pour que la désérialisation ne puisse jamais échouer sur une valeur
/// inconnue ou obsolète (retrait futur d'une variante, fichier corrompu à la
/// main) : la validation sémantique se fait après coup via
/// [`sanitize_junimo`], qui retombe sur les défauts plutôt que de paniquer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct JunimoSettings {
    pub shape: String,
    pub color: String,
    pub accessory: String,
    pub name: String,
}

impl Default for JunimoSettings {
    fn default() -> Self {
        Self {
            shape: "classic".to_string(),
            color: "green".to_string(),
            accessory: "none".to_string(),
            name: "Junimo".to_string(),
        }
    }
}

/// Valide/nettoie une [`JunimoSettings`] lue depuis le disque : toute valeur
/// de forme/couleur/accessoire absente de la liste connue retombe sur le
/// défaut correspondant plutôt que d'être propagée telle quelle au front (le
/// module de composition `compose.ts` ne sait dessiner que les valeurs
/// connues). Le nom est trimmé ; vide ou trop long -> défaut `"Junimo"`
/// (troncature plutôt que rejet total pour un nom simplement trop long).
/// Fonction pure, appelée par [`load_settings`] à chaque lecture — jamais de
/// panic, quel que soit le contenu du fichier.
pub fn sanitize_junimo(junimo: JunimoSettings) -> JunimoSettings {
    let default = JunimoSettings::default();
    let shape = if JUNIMO_VALID_SHAPES.contains(&junimo.shape.as_str()) {
        junimo.shape
    } else {
        default.shape.clone()
    };
    let color = if JUNIMO_VALID_COLORS.contains(&junimo.color.as_str()) {
        junimo.color
    } else {
        default.color.clone()
    };
    let accessory = if JUNIMO_VALID_ACCESSORIES.contains(&junimo.accessory.as_str()) {
        junimo.accessory
    } else {
        default.accessory.clone()
    };
    let trimmed_name = junimo.name.trim();
    let name = if trimmed_name.is_empty() || trimmed_name.chars().count() > JUNIMO_NAME_MAX_LEN {
        default.name.clone()
    } else {
        trimmed_name.to_string()
    };
    JunimoSettings {
        shape,
        color,
        accessory,
        name,
    }
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
/// agrégées, et indicateur global d'estimation des jauges. `build_snapshot`
/// (chemin local) le met toujours à `true` : le calcul local est par
/// définition une estimation. Un câblage futur dans `lib.rs` (tâche #23,
/// jauges officielles via `/usage`) le passera à `false` quand les jauges
/// estimées sont remplacées par les jauges officielles.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Meta {
    pub generated_at: DateTime<Utc>,
    pub degraded: Vec<String>,
    pub estimated: bool,
}

/// Nombre maximum de projets exposés dans la section « Projets » de
/// l'overlay (top N par tokens pondérés sur 7 jours).
pub const MAX_PROJECT_STATS: usize = 5;

/// Statistiques d'un projet (dossier de premier niveau sous
/// `.claude/projects/`) sur la fenêtre 7 jours : tokens pondérés, dernier
/// usage et modèle dominant. Sérialisé tel quel pour le front.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProjectStat {
    /// Nom lisible du projet (dernier segment du dossier encodé, `"?"` si
    /// projet indéterminable).
    pub name: String,
    /// Somme pondérée des tokens sur la fenêtre (mêmes poids que les jauges).
    pub tokens_7d: u64,
    /// Horodatage du dernier événement d'usage du projet dans la fenêtre.
    pub last_used: Option<DateTime<Utc>>,
    /// Modèle le plus fréquent (par nombre d'événements), préfixe `claude-`
    /// retiré.
    pub top_model: String,
    /// Chemin absolu du dossier projet, résolu depuis `~/.claude.json` (voir
    /// `config::read_project_paths`, tâche #43). `None` si aucune
    /// correspondance (projet renommé/déplacé depuis, ou config
    /// absente/dégradée) — jamais reconstruit en décodant le nom de dossier
    /// (une conversion `-` -> `/` serait ambiguë sur un chemin contenant des
    /// tirets littéraux).
    pub path: Option<String>,
    /// Présence d'un dépôt git à la racine de `path` (simple test
    /// d'existence de `.git`, coût négligeable — voir
    /// [`enrich_project_fs_info`]). `false` si `path` est `None`.
    pub has_git: bool,
    /// Date de première activité connue localement : date de création du
    /// dossier projet sur le disque (métadonnées filesystem), en repli d'une
    /// vraie date de création de projet qui n'existe nulle part côté Claude
    /// Code. `None` si `path` est `None` ou si les métadonnées sont
    /// illisibles (voir [`enrich_project_fs_info`]).
    pub first_seen: Option<DateTime<Utc>>,
}

/// Consommation pondérée d'un jour de calendrier local, alimentant la section
/// « Historique » (voir [`daily_history`]). Sérialisé tel quel pour le front.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DayUsage {
    /// Jour local (machine) au format `YYYY-MM-DD`.
    pub date: String,
    /// Somme pondérée des tokens de ce jour (mêmes poids que les jauges).
    pub tokens: u64,
}

/// Snapshot unique envoyé au front. Le contrat JSON exact (contrat
/// TypeScript déjà implémenté côté front) est : `{ gauges, mcps, projects,
/// account, meta, history, chats }`, voir le commentaire de module.
#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub gauges: Gauges,
    pub mcps: Vec<McpServer>,
    pub projects: Vec<ProjectStat>,
    pub account: AccountSnapshot,
    pub meta: Meta,
    pub history: Vec<DayUsage>,
    /// Conversations récentes (tâche #43), voir [`chat_stats`].
    pub chats: Vec<ChatStat>,
}

/// Nom d'affichage d'un projet à partir du dossier encodé : dernier segment
/// non vide après séparation sur `-` (ex. `-Users-you-junimo` →
/// `junimo`), sinon le nom brut. Projet vide (indéterminable) → `"?"`.
fn project_display_name(project: &str) -> String {
    if project.is_empty() {
        return "?".to_string();
    }
    match project.split('-').filter(|s| !s.is_empty()).next_back() {
        Some(segment) => segment.to_string(),
        None => project.to_string(),
    }
}

/// Forme courte d'un identifiant de modèle : retire le préfixe `claude-`
/// (ex. `claude-fable-5` → `fable-5`), garde la valeur brute sinon.
fn short_model(model: &str) -> String {
    model.strip_prefix("claude-").unwrap_or(model).to_string()
}

/// Accumulateur interne par projet (avant conversion en [`ProjectStat`]).
#[derive(Default)]
struct ProjectAccumulator {
    weighted_sum: f64,
    last_used: Option<DateTime<Utc>>,
    model_counts: HashMap<String, u64>,
}

/// Agrège les événements `ts >= since` par projet (voir [`ProjectStat`]) :
/// somme pondérée des tokens, dernier `ts`, et modèle le plus fréquent (par
/// nombre d'événements ; égalité tranchée par ordre alphabétique). Les
/// événements au projet vide sont regroupés sous `"?"`. `project_paths`
/// (voir `config::read_project_paths`, tâche #43) résout le chemin absolu
/// réel par une simple recherche dans une map déjà chargée : la fonction
/// reste pure et testable (aucune I/O ici, contrairement à `has_git`/
/// `first_seen` qui nécessitent un accès disque, voir
/// [`enrich_project_fs_info`]). Résultat trié par `tokens_7d` décroissant
/// (départage par nom pour rester déterministe), tronqué à
/// [`MAX_PROJECT_STATS`]. Fonction pure, testée directement.
pub fn project_stats(
    events: &[UsageEvent],
    since: DateTime<Utc>,
    project_paths: &HashMap<String, String>,
) -> Vec<ProjectStat> {
    let mut by_project: HashMap<String, ProjectAccumulator> = HashMap::new();

    for event in events {
        if event.ts < since {
            continue;
        }
        let acc = by_project.entry(event.project.clone()).or_default();
        acc.weighted_sum += windows::weighted_tokens(event);
        acc.last_used = Some(match acc.last_used {
            Some(prev) if prev >= event.ts => prev,
            _ => event.ts,
        });
        *acc.model_counts.entry(event.model.clone()).or_insert(0) += 1;
    }

    let mut stats: Vec<ProjectStat> = by_project
        .into_iter()
        .map(|(project, acc)| {
            // Modèle dominant : plus grand compte, égalité tranchée par le
            // nom de modèle le plus petit (ordre alphabétique déterministe).
            let top_model = acc
                .model_counts
                .iter()
                .max_by(|(a_model, a_count), (b_model, b_count)| {
                    a_count.cmp(b_count).then_with(|| b_model.cmp(a_model))
                })
                .map(|(model, _)| short_model(model))
                .unwrap_or_default();

            ProjectStat {
                name: project_display_name(&project),
                tokens_7d: acc.weighted_sum.round().max(0.0) as u64,
                last_used: acc.last_used,
                top_model,
                path: project_paths.get(&project).cloned(),
                // Renseignés après coup par `enrich_project_fs_info` (I/O),
                // jamais dans cette fonction pure.
                has_git: false,
                first_seen: None,
            }
        })
        .collect();

    stats.sort_by(|a, b| {
        b.tokens_7d
            .cmp(&a.tokens_7d)
            .then_with(|| a.name.cmp(&b.name))
    });
    stats.truncate(MAX_PROJECT_STATS);
    stats
}

/// Complète en place les champs `has_git`/`first_seen` de chaque
/// [`ProjectStat`] déjà résolu à un `path` (tâche #43). Seule fonction du
/// module à faire de l'I/O disque pour les projets : appelée uniquement
/// après troncature à [`MAX_PROJECT_STATS`], donc bornée à quelques `stat()`
/// (jamais un nouveau scan des transcripts, cf. tâche #22). `has_git` est un
/// simple test d'existence de `<path>/.git` ; `first_seen` est la date de
/// création du dossier projet (métadonnées filesystem), repli honnête faute
/// de vraie date de création de projet côté Claude Code. Best-effort : tout
/// échec I/O (dossier déplacé/permissions/plateforme sans date de création)
/// laisse les valeurs par défaut (`false`/`None`), jamais de panic.
fn enrich_project_fs_info(stats: &mut [ProjectStat]) {
    for stat in stats.iter_mut() {
        let Some(path) = stat.path.as_deref() else {
            continue;
        };
        let path = Path::new(path);
        stat.has_git = path.join(".git").exists();
        stat.first_seen = fs::metadata(path)
            .and_then(|meta| meta.created())
            .ok()
            .map(DateTime::<Utc>::from);
    }
}

/// Nombre maximum de conversations exposées dans la section « Chats » de
/// l'overlay (tâche #43), top N par dernière activité.
pub const MAX_CHAT_STATS: usize = 8;

/// Seuil d'inactivité au-delà duquel une conversation est considérée
/// terminée plutôt qu'en cours (tâche #43). Claude Code n'expose aucun
/// évènement natif de fin de conversation (même constat que
/// `chat_end.rs`) : on approxime par un délai de silence, avec une marge
/// confortable au-dessus du cycle de refresh du front (60 s,
/// `useOverlayData::REFRESH_INTERVAL_MS`).
const CHAT_ACTIVE_THRESHOLD_MINUTES: i64 = 5;

/// Statut d'une conversation (tâche #43), voir [`chat_stats`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatStatus {
    InProgress,
    Done,
}

/// Statistiques d'une conversation (regroupement par `session_id`, tâche
/// #43) sur la fenêtre de scan : projet, statut, bornes temporelles, tokens
/// et modèle dominant. Sérialisé tel quel pour le front.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ChatStat {
    /// Identifiant de conversation (`session_id` brut des transcripts).
    pub id: String,
    /// Nom lisible du projet (même résolution que [`ProjectStat::name`]).
    pub project: String,
    pub status: ChatStatus,
    /// Horodatage du premier événement d'usage de la conversation.
    pub started_at: DateTime<Utc>,
    /// Horodatage du dernier événement d'usage de la conversation.
    pub last_used: DateTime<Utc>,
    /// Somme pondérée des tokens de la conversation (mêmes poids que les
    /// jauges). La durée n'est pas calculée ici : c'est de la pure mise en
    /// forme (`started_at`/`last_used`), laissée au front (voir
    /// `src/ui/format.ts`).
    pub tokens: u64,
    /// Modèle le plus fréquent (par nombre d'événements), préfixe `claude-`
    /// retiré.
    pub model: String,
}

/// Accumulateur interne par conversation (avant conversion en [`ChatStat`]).
#[derive(Default)]
struct ChatAccumulator {
    project: String,
    weighted_sum: f64,
    started_at: Option<DateTime<Utc>>,
    last_used: Option<DateTime<Utc>>,
    model_counts: HashMap<String, u64>,
}

/// Agrège les événements `ts >= since` par `session_id` (voir [`ChatStat`]).
/// Les événements sans `session_id` (chaîne vide, transcript trop ancien ou
/// champ absent) sont exclus : contrairement aux projets, il n'existe pas de
/// regroupement `"?"` pertinent pour des conversations distinctes non
/// identifiables. Le statut compare `last_used` à `now` (voir
/// [`CHAT_ACTIVE_THRESHOLD_MINUTES`]) ; `now` est toujours injecté par
/// l'appelant, jamais lu ici (fonction pure, testée directement). Résultat
/// trié par `last_used` décroissant, tronqué à [`MAX_CHAT_STATS`].
pub fn chat_stats(events: &[UsageEvent], since: DateTime<Utc>, now: DateTime<Utc>) -> Vec<ChatStat> {
    let mut by_session: HashMap<String, ChatAccumulator> = HashMap::new();

    for event in events {
        if event.ts < since || event.session_id.is_empty() {
            continue;
        }
        let acc = by_session.entry(event.session_id.clone()).or_default();
        if acc.project.is_empty() {
            acc.project = event.project.clone();
        }
        acc.weighted_sum += windows::weighted_tokens(event);
        acc.started_at = Some(match acc.started_at {
            Some(prev) if prev <= event.ts => prev,
            _ => event.ts,
        });
        acc.last_used = Some(match acc.last_used {
            Some(prev) if prev >= event.ts => prev,
            _ => event.ts,
        });
        *acc.model_counts.entry(event.model.clone()).or_insert(0) += 1;
    }

    let mut stats: Vec<ChatStat> = by_session
        .into_iter()
        .map(|(session_id, acc)| {
            let top_model = acc
                .model_counts
                .iter()
                .max_by(|(a_model, a_count), (b_model, b_count)| {
                    a_count.cmp(b_count).then_with(|| b_model.cmp(a_model))
                })
                .map(|(model, _)| short_model(model))
                .unwrap_or_default();

            // `started_at`/`last_used` sont toujours `Some` ici : au moins un
            // événement a peuplé l'accumulateur (clé insérée seulement dans
            // la boucle ci-dessus).
            let last_used = acc.last_used.expect("accumulateur peuplé par au moins un événement");
            let started_at = acc.started_at.unwrap_or(last_used);
            let status = if now.signed_duration_since(last_used) <= Duration::minutes(CHAT_ACTIVE_THRESHOLD_MINUTES) {
                ChatStatus::InProgress
            } else {
                ChatStatus::Done
            };

            ChatStat {
                id: session_id,
                project: project_display_name(&acc.project),
                status,
                started_at,
                last_used,
                tokens: acc.weighted_sum.round().max(0.0) as u64,
                model: top_model,
            }
        })
        .collect();

    stats.sort_by(|a, b| b.last_used.cmp(&a.last_used).then_with(|| a.id.cmp(&b.id)));
    stats.truncate(MAX_CHAT_STATS);
    stats
}

/// Consommation quotidienne pondérée sur les `days` derniers jours de
/// calendrier local, du plus ancien au plus récent, la dernière entrée étant
/// `today_local`. Retourne **exactement** `days` entrées consécutives (jours
/// sans usage → `tokens: 0`), somme pondérée `weighted_tokens` arrondie une
/// fois par jour (comme ailleurs).
///
/// Fonction **pure** : le fuseau/l'horloge ne sont jamais lus ici. La date
/// « aujourd'hui » et la conversion `UTC → date locale` sont injectées par
/// l'appelant (`to_local_date`) pour rester déterministe indépendamment de la
/// machine qui exécute les tests (voir [`build_snapshot`]).
pub fn daily_history(
    events: &[UsageEvent],
    today_local: NaiveDate,
    days: i64,
    to_local_date: impl Fn(DateTime<Utc>) -> NaiveDate,
) -> Vec<DayUsage> {
    // Borne défensive : au moins un jour d'historique.
    let days = days.max(1);
    let start = today_local - Duration::days(days - 1);

    // Accumulation pondérée par date locale (seuls les jours de la fenêtre).
    let mut sums: HashMap<NaiveDate, f64> = HashMap::new();
    for event in events {
        let date = to_local_date(event.ts);
        if date < start || date > today_local {
            continue;
        }
        *sums.entry(date).or_insert(0.0) += windows::weighted_tokens(event);
    }

    // Exactement `days` entrées consécutives, ordre chronologique.
    (0..days)
        .map(|offset| {
            let date = start + Duration::days(offset);
            let tokens = sums.get(&date).copied().unwrap_or(0.0).round().max(0.0) as u64;
            DayUsage {
                date: date.format("%Y-%m-%d").to_string(),
                tokens,
            }
        })
        .collect()
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
    let mut gauges = windows::compute_gauges(&scan.events, now, caps, weekly_anchor);

    // Estimation locale indisponible vs « vraiment 0 usage » (tâche #31) :
    // `compute_gauges` produit toujours `used_tokens: Some(n)`, y compris
    // `Some(0)` sur un scan vide. Quand AUCUN fichier de transcript n'a pu
    // être scanné (dossier `~/.claude/projects` absent, permissions, machine
    // neuve, aucun fichier récent), ce zéro ne reflète aucune donnée : on
    // efface `tokens_source` pour le signaler. Les compteurs eux-mêmes
    // restent `Some(0)` (affichage du mode repli estimé inchangé), mais
    // `oauth_usage::merge_estimated_tokens` ne fusionnera pas ces tokens
    // dans les jauges officielles — jamais de « ≈ 0 tok (est.) » trompeur.
    // Un historique présent avec réellement 0 usage dans la fenêtre garde
    // `files_scanned > 0` et donc son `tokens_source: estimated` honnête.
    if scan.files_scanned == 0 {
        gauges.block_5h.tokens_source = None;
        gauges.weekly.tokens_source = None;
        gauges.weekly_fable.tokens_source = None;
    }

    let local_midnight_utc = local_midnight_utc_for(now);
    let (today_messages, today_tokens) = today_stats(&scan.events, local_midnight_utc);

    // Stats par projet sur 7 jours glissants (indépendant de la fenêtre
    // ancrée des jauges : ici toujours `now - 7 jours`). Chemin absolu
    // résolu depuis `~/.claude.json` (tâche #43) ; `has_git`/`first_seen`
    // sont complétés après coup par `enrich_project_fs_info` (seule étape
    // faisant de l'I/O disque, bornée aux projets déjà tronqués à
    // `MAX_PROJECT_STATS`).
    let project_paths = config::read_project_paths(home);
    let mut projects = project_stats(&scan.events, now - Duration::days(7), &project_paths);
    enrich_project_fs_info(&mut projects);

    // Historique quotidien sur 14 jours (jour local machine). La conversion
    // UTC → date locale est injectée ici, jamais lue dans la fonction pure.
    let today_local = now.with_timezone(&Local).date_naive();
    let history = daily_history(&scan.events, today_local, HISTORY_DAYS, |ts| {
        ts.with_timezone(&Local).date_naive()
    });

    // Conversations récentes (tâche #43), sur la même fenêtre de scan que
    // les jauges (`since`) : aucun nouveau scan de transcripts, on regroupe
    // les événements déjà collectés par `session_id`.
    let chats = chat_stats(&scan.events, since, now);

    let mut degraded = config_data.degraded.clone();
    if scan.parse_errors > 0 {
        degraded.push(format!("transcripts_parse_errors:{}", scan.parse_errors));
    }

    Snapshot {
        gauges,
        mcps: config_data.mcps.clone(),
        projects,
        account: build_account(&config_data, today_messages, today_tokens),
        meta: Meta {
            generated_at: now,
            degraded,
            estimated: true,
        },
        history,
        chats,
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
            Ok(mut parsed) => {
                // Nettoyage du bloc junimo (tâche #33) : un fichier corrompu à
                // la main ou une variante de forme/couleur/accessoire retirée
                // dans une version future ne doit jamais remonter telle
                // quelle jusqu'au front (voir `sanitize_junimo`).
                parsed.junimo = sanitize_junimo(parsed.junimo);
                // Nettoyage de l'apparence (tâche #40) : même logique
                // défensive, une valeur inconnue retombe sur "light".
                parsed.appearance = sanitize_appearance(parsed.appearance);
                (Some(parsed), Vec::new())
            }
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

/// Fichier d'état interne de l'app (`junimo-state.json`, même dossier que
/// `junimo-settings.json`). Distinct des réglages : jamais édité par
/// l'utilisateur, il mémorise la dernière version du CLI Claude Code vue.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AppState {
    pub last_cli_version: Option<String>,
}

/// Entrée `degraded` à émettre quand la version du CLI change (fonction
/// pure, testée). Les formats de fichiers de Claude Code (~/.claude.json,
/// transcripts JSONL) ne sont pas documentés : une montée de version est le
/// signal de re-vérifier les schémas (voir
/// docs/reference/claude-code-file-formats.md). `current == "?"` (CLI
/// indisponible) ne déclenche jamais rien.
pub fn cli_version_change_entry(last: Option<&str>, current: &str) -> Option<String> {
    if current == "?" {
        return None;
    }
    match last {
        Some(previous) if previous != current => {
            Some(format!("cli_version_changed:{previous}->{current}"))
        }
        _ => None,
    }
}

/// Compare la version CLI courante à celle mémorisée dans
/// `junimo-state.json` ; retourne l'entrée `degraded` en cas de changement
/// et met à jour l'état. Best-effort : toute erreur d'E/S est silencieuse
/// (pas de state = premier lancement, on écrit et on ne signale rien).
pub fn track_cli_version(app: &tauri::AppHandle, current: &str) -> Option<String> {
    use tauri::Manager;
    let path = app
        .path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("junimo-state.json"))?;

    let state: AppState = fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default();

    let entry = cli_version_change_entry(state.last_cli_version.as_deref(), current);

    // On ne réécrit le fichier que si la version vue change (ou premier run).
    if current != "?" && state.last_cli_version.as_deref() != Some(current) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let next = AppState {
            last_cli_version: Some(current.to_string()),
        };
        if let Ok(json) = serde_json::to_string_pretty(&next) {
            let _ = fs::write(&path, json);
        }
    }

    entry
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collector::transcripts::TokenCounts;
    use std::collections::BTreeSet;
    use std::time::{SystemTime, UNIX_EPOCH};

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
            project: String::new(),
            session_id: String::new(),
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

    // --- project_stats : agrégation pure par projet ---

    fn evp(ts_str: &str, model: &str, input: u64, project: &str) -> UsageEvent {
        UsageEvent {
            ts: ts(ts_str),
            model: model.to_string(),
            tokens: TokenCounts {
                input,
                output: 0,
                cache_creation: 0,
                cache_read: 0,
            },
            project: project.to_string(),
            session_id: String::new(),
        }
    }

    /// Événement avec `session_id` explicite, pour les tests de
    /// [`chat_stats`] (tâche #43).
    fn evs(ts_str: &str, model: &str, input: u64, project: &str, session_id: &str) -> UsageEvent {
        UsageEvent {
            session_id: session_id.to_string(),
            ..evp(ts_str, model, input, project)
        }
    }

    /// Aucun projet connu de `~/.claude.json` : la plupart des tests de
    /// `project_stats` ne portent pas sur la résolution de chemin.
    fn no_paths() -> HashMap<String, String> {
        HashMap::new()
    }

    #[test]
    fn project_stats_aggregates_tokens_and_last_used_per_project() {
        let since = ts("2026-07-01T00:00:00Z");
        let events = vec![
            evp("2026-07-02T10:00:00Z", "claude-fable-5", 100, "-Users-x-alpha"),
            evp("2026-07-03T12:00:00Z", "claude-fable-5", 50, "-Users-x-alpha"),
            evp("2026-07-02T09:00:00Z", "claude-sonnet-5", 30, "-Users-x-beta"),
        ];

        let stats = project_stats(&events, since, &no_paths());

        assert_eq!(stats.len(), 2);
        // alpha : 100 + 50 = 150 tokens, dernier usage le 03/07.
        let alpha = stats.iter().find(|s| s.name == "alpha").unwrap();
        assert_eq!(alpha.tokens_7d, 150);
        assert_eq!(alpha.last_used, Some(ts("2026-07-03T12:00:00Z")));
        assert_eq!(alpha.top_model, "fable-5");
        // beta : 30 tokens.
        let beta = stats.iter().find(|s| s.name == "beta").unwrap();
        assert_eq!(beta.tokens_7d, 30);
    }

    #[test]
    fn project_stats_excludes_events_before_since() {
        let since = ts("2026-07-05T00:00:00Z");
        let events = vec![
            evp("2026-07-04T23:59:59Z", "claude-fable-5", 1000, "-a"),
            evp("2026-07-05T00:00:00Z", "claude-fable-5", 10, "-a"),
        ];

        let stats = project_stats(&events, since, &no_paths());

        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].tokens_7d, 10);
    }

    #[test]
    fn project_stats_sorts_by_tokens_descending() {
        let since = ts("2026-07-01T00:00:00Z");
        let events = vec![
            evp("2026-07-02T10:00:00Z", "claude-fable-5", 10, "-small"),
            evp("2026-07-02T10:00:00Z", "claude-fable-5", 500, "-big"),
            evp("2026-07-02T10:00:00Z", "claude-fable-5", 100, "-mid"),
        ];

        let stats = project_stats(&events, since, &no_paths());

        assert_eq!(stats.len(), 3);
        assert_eq!(stats[0].name, "big");
        assert_eq!(stats[1].name, "mid");
        assert_eq!(stats[2].name, "small");
    }

    #[test]
    fn project_stats_truncates_to_max_five() {
        let since = ts("2026-07-01T00:00:00Z");
        let events: Vec<UsageEvent> = (0..8)
            .map(|i| {
                evp(
                    "2026-07-02T10:00:00Z",
                    "claude-fable-5",
                    (i as u64 + 1) * 100,
                    &format!("-proj{i}"),
                )
            })
            .collect();

        let stats = project_stats(&events, since, &no_paths());

        assert_eq!(stats.len(), MAX_PROJECT_STATS);
        // Les 5 plus gros : proj7 (800) .. proj3 (400).
        assert_eq!(stats[0].name, "proj7");
        assert_eq!(stats[4].name, "proj3");
    }

    #[test]
    fn project_stats_top_model_is_most_frequent_with_alphabetical_tiebreak() {
        let since = ts("2026-07-01T00:00:00Z");
        // sonnet 2 fois, fable 1 fois → sonnet gagne par fréquence.
        let freq_events = vec![
            evp("2026-07-02T10:00:00Z", "claude-fable-5", 10, "-p"),
            evp("2026-07-02T11:00:00Z", "claude-sonnet-5", 10, "-p"),
            evp("2026-07-02T12:00:00Z", "claude-sonnet-5", 10, "-p"),
        ];
        assert_eq!(
            project_stats(&freq_events, since, &no_paths())[0].top_model,
            "sonnet-5"
        );

        // Égalité 1-1 → ordre alphabétique : fable < sonnet.
        let tie_events = vec![
            evp("2026-07-02T10:00:00Z", "claude-sonnet-5", 10, "-p"),
            evp("2026-07-02T11:00:00Z", "claude-fable-5", 10, "-p"),
        ];
        assert_eq!(
            project_stats(&tie_events, since, &no_paths())[0].top_model,
            "fable-5"
        );
    }

    #[test]
    fn project_stats_empty_project_is_grouped_under_question_mark() {
        let since = ts("2026-07-01T00:00:00Z");
        let events = vec![evp("2026-07-02T10:00:00Z", "claude-fable-5", 42, "")];

        let stats = project_stats(&events, since, &no_paths());

        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].name, "?");
        assert_eq!(stats[0].tokens_7d, 42);
    }

    #[test]
    fn project_stats_resolves_path_from_project_paths_map() {
        let since = ts("2026-07-01T00:00:00Z");
        let events = vec![evp("2026-07-02T10:00:00Z", "claude-fable-5", 10, "-Users-x-alpha")];
        let mut paths = HashMap::new();
        paths.insert(
            "-Users-x-alpha".to_string(),
            "/Users/x/alpha".to_string(),
        );

        let stats = project_stats(&events, since, &paths);

        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].path, Some("/Users/x/alpha".to_string()));
        // has_git/first_seen sont laissés à leurs valeurs par défaut : c'est
        // `enrich_project_fs_info` (I/O) qui les renseigne, pas cette
        // fonction pure.
        assert!(!stats[0].has_git);
        assert_eq!(stats[0].first_seen, None);
    }

    #[test]
    fn project_stats_path_is_none_without_a_matching_entry() {
        let since = ts("2026-07-01T00:00:00Z");
        let events = vec![evp("2026-07-02T10:00:00Z", "claude-fable-5", 10, "-Users-x-alpha")];

        let stats = project_stats(&events, since, &no_paths());

        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].path, None);
    }

    // --- enrich_project_fs_info : seule étape I/O, testée à part avec un
    // vrai dossier temporaire ---

    #[test]
    fn enrich_project_fs_info_detects_git_and_creation_date() {
        let dir = std::env::temp_dir().join(format!(
            "junimo-project-fs-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(dir.join(".git")).unwrap();

        let mut stats = vec![ProjectStat {
            name: "alpha".to_string(),
            tokens_7d: 0,
            last_used: None,
            top_model: String::new(),
            path: Some(dir.to_string_lossy().to_string()),
            has_git: false,
            first_seen: None,
        }];

        enrich_project_fs_info(&mut stats);

        fs::remove_dir_all(&dir).unwrap();

        assert!(stats[0].has_git);
        assert!(stats[0].first_seen.is_some());
    }

    #[test]
    fn enrich_project_fs_info_leaves_defaults_when_path_is_none() {
        let mut stats = vec![ProjectStat {
            name: "alpha".to_string(),
            tokens_7d: 0,
            last_used: None,
            top_model: String::new(),
            path: None,
            has_git: false,
            first_seen: None,
        }];

        enrich_project_fs_info(&mut stats);

        assert!(!stats[0].has_git);
        assert_eq!(stats[0].first_seen, None);
    }

    #[test]
    fn enrich_project_fs_info_no_git_when_dot_git_absent() {
        let dir = std::env::temp_dir().join(format!(
            "junimo-project-fs-nogit-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();

        let mut stats = vec![ProjectStat {
            name: "alpha".to_string(),
            tokens_7d: 0,
            last_used: None,
            top_model: String::new(),
            path: Some(dir.to_string_lossy().to_string()),
            has_git: false,
            first_seen: None,
        }];

        enrich_project_fs_info(&mut stats);

        fs::remove_dir_all(&dir).unwrap();

        assert!(!stats[0].has_git);
        assert!(stats[0].first_seen.is_some());
    }

    // --- chat_stats : agrégation pure par conversation (tâche #43) ---

    #[test]
    fn chat_stats_groups_by_session_and_sums_tokens() {
        let since = ts("2026-07-01T00:00:00Z");
        let now = ts("2026-07-08T10:00:00Z");
        let events = vec![
            evs("2026-07-08T09:00:00Z", "claude-fable-5", 100, "-a", "sess-1"),
            evs("2026-07-08T09:05:00Z", "claude-fable-5", 50, "-a", "sess-1"),
        ];

        let stats = chat_stats(&events, since, now);

        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].id, "sess-1");
        assert_eq!(stats[0].project, "a");
        assert_eq!(stats[0].tokens, 150);
        assert_eq!(stats[0].started_at, ts("2026-07-08T09:00:00Z"));
        assert_eq!(stats[0].last_used, ts("2026-07-08T09:05:00Z"));
        assert_eq!(stats[0].model, "fable-5");
    }

    #[test]
    fn chat_stats_events_without_session_id_are_excluded() {
        let since = ts("2026-07-01T00:00:00Z");
        let now = ts("2026-07-08T10:00:00Z");
        let events = vec![
            evp("2026-07-08T09:00:00Z", "claude-fable-5", 100, "-a"), // session_id = ""
            evs("2026-07-08T09:05:00Z", "claude-fable-5", 50, "-a", "sess-1"),
        ];

        let stats = chat_stats(&events, since, now);

        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].id, "sess-1");
    }

    #[test]
    fn chat_stats_status_is_in_progress_within_active_threshold() {
        let since = ts("2026-07-01T00:00:00Z");
        let now = ts("2026-07-08T10:00:00Z");
        // Dernier événement il y a 2 minutes -> en cours.
        let events = vec![evs("2026-07-08T09:58:00Z", "claude-fable-5", 10, "-a", "sess-1")];

        let stats = chat_stats(&events, since, now);

        assert_eq!(stats[0].status, ChatStatus::InProgress);
    }

    #[test]
    fn chat_stats_status_is_done_beyond_active_threshold() {
        let since = ts("2026-07-01T00:00:00Z");
        let now = ts("2026-07-08T10:00:00Z");
        // Dernier événement il y a 30 minutes -> terminée.
        let events = vec![evs("2026-07-08T09:30:00Z", "claude-fable-5", 10, "-a", "sess-1")];

        let stats = chat_stats(&events, since, now);

        assert_eq!(stats[0].status, ChatStatus::Done);
    }

    #[test]
    fn chat_stats_excludes_events_before_since() {
        let since = ts("2026-07-05T00:00:00Z");
        let now = ts("2026-07-08T10:00:00Z");
        let events = vec![evs("2026-07-04T23:59:59Z", "claude-fable-5", 10, "-a", "sess-1")];

        assert!(chat_stats(&events, since, now).is_empty());
    }

    #[test]
    fn chat_stats_sorts_by_last_used_descending_and_truncates() {
        let since = ts("2026-07-01T00:00:00Z");
        let now = ts("2026-07-08T10:00:00Z");
        let events: Vec<UsageEvent> = (0..10)
            .map(|i| {
                evs(
                    "2026-07-08T09:00:00Z",
                    "claude-fable-5",
                    10,
                    "-a",
                    &format!("sess-{i}"),
                )
            })
            .collect();
        // Décale chaque session d'une minute pour un ordre déterministe.
        let mut events = events;
        for (i, e) in events.iter_mut().enumerate() {
            e.ts = ts("2026-07-08T09:00:00Z") + Duration::minutes(i as i64);
        }

        let stats = chat_stats(&events, since, now);

        assert_eq!(stats.len(), MAX_CHAT_STATS);
        // La plus récente (sess-9, +9min) en tête.
        assert_eq!(stats[0].id, "sess-9");
    }

    // --- daily_history : agrégation quotidienne pure, bornes injectées ---

    #[test]
    fn daily_history_empty_yields_days_entries_all_zero_ending_today() {
        let today = NaiveDate::from_ymd_opt(2026, 7, 14).unwrap();

        let history = daily_history(&[], today, 14, |t| t.date_naive());

        assert_eq!(history.len(), 14);
        assert!(history.iter().all(|d| d.tokens == 0));
        assert_eq!(history.first().unwrap().date, "2026-07-01");
        assert_eq!(history.last().unwrap().date, "2026-07-14");
    }

    #[test]
    fn daily_history_entries_are_consecutive_and_chronological() {
        let today = NaiveDate::from_ymd_opt(2026, 7, 14).unwrap();

        let history = daily_history(&[], today, 5, |t| t.date_naive());

        let dates: Vec<&str> = history.iter().map(|d| d.date.as_str()).collect();
        assert_eq!(
            dates,
            ["2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14"]
        );
    }

    #[test]
    fn daily_history_sums_multiple_events_on_same_local_day() {
        let today = NaiveDate::from_ymd_opt(2026, 7, 14).unwrap();
        let events = vec![
            ev("2026-07-12T01:00:00Z", "claude-sonnet-5", 100),
            ev("2026-07-12T20:00:00Z", "claude-fable-5", 50),
        ];

        let history = daily_history(&events, today, 14, |t| t.date_naive());

        let day = history.iter().find(|d| d.date == "2026-07-12").unwrap();
        assert_eq!(day.tokens, 150);
    }

    #[test]
    fn daily_history_excludes_events_outside_window() {
        let today = NaiveDate::from_ymd_opt(2026, 7, 14).unwrap();
        // Fenêtre = [2026-07-01, 2026-07-14].
        let events = vec![
            ev("2026-06-30T23:00:00Z", "claude-sonnet-5", 999), // avant start -> exclu
            ev("2026-07-15T00:00:00Z", "claude-sonnet-5", 999), // après today -> exclu
            ev("2026-07-01T00:00:00Z", "claude-sonnet-5", 10),  // borne basse incluse
            ev("2026-07-14T23:00:00Z", "claude-sonnet-5", 20),  // today inclus
        ];

        let history = daily_history(&events, today, 14, |t| t.date_naive());

        let total: u64 = history.iter().map(|d| d.tokens).sum();
        assert_eq!(total, 30);
        assert_eq!(history.first().unwrap().tokens, 10);
        assert_eq!(history.last().unwrap().tokens, 20);
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
            BTreeSet::from([
                "gauges", "mcps", "projects", "account", "meta", "history", "chats"
            ])
        );

        // --- gauges ---
        let gauge_keys: BTreeSet<&str> = BTreeSet::from([
            "used_tokens",
            "cap",
            "percent",
            "reset_at",
            "source",
            "tokens_source",
        ]);
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
            assert_eq!(
                gauge["source"], "estimated",
                "gauges.{name}.source doit être \"estimated\" sur le chemin local"
            );
            assert_eq!(
                gauge["tokens_source"], "estimated",
                "gauges.{name}.tokens_source doit être \"estimated\" sur le chemin local (tâche #31)"
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

        // --- projects ---
        // La fixture n'a qu'un projet (`proj-a`) : deux événements
        // (fable-5 1000+500, sonnet-5 200+100) = 1800 tokens pondérés.
        let projects = value["projects"].as_array().expect("projects est un tableau");
        assert_eq!(projects.len(), 1);
        let project_keys: BTreeSet<&str> = projects[0]
            .as_object()
            .expect("un projet est un objet")
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            project_keys,
            BTreeSet::from([
                "name",
                "tokens_7d",
                "last_used",
                "top_model",
                "path",
                "has_git",
                "first_seen"
            ])
        );
        assert_eq!(value["projects"][0]["name"], "a");
        assert_eq!(value["projects"][0]["tokens_7d"], 1800);
        assert_eq!(value["projects"][0]["top_model"], "fable-5");
        assert_eq!(value["projects"][0]["last_used"], "2026-07-08T09:30:00Z");
        // La fixture `.claude.json` n'a pas d'entrée `projects` pour ce
        // dossier encodé : aucune correspondance, path/has_git/first_seen
        // retombent sur leurs défauts (voir `project_stats`/
        // `enrich_project_fs_info`).
        assert!(value["projects"][0]["path"].is_null());
        assert_eq!(value["projects"][0]["has_git"], false);
        assert!(value["projects"][0]["first_seen"].is_null());

        // --- chats ---
        // La fixture a une seule conversation (`sess-1`) : mêmes 2
        // événements que le projet `a` (1800 tokens pondérés). `now` est à
        // 10:00, dernier événement à 09:30 (30 min > seuil de 5 min) ->
        // statut "done".
        let chats = value["chats"].as_array().expect("chats est un tableau");
        assert_eq!(chats.len(), 1);
        let chat_keys: BTreeSet<&str> = chats[0]
            .as_object()
            .expect("une conversation est un objet")
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            chat_keys,
            BTreeSet::from([
                "id",
                "project",
                "status",
                "started_at",
                "last_used",
                "tokens",
                "model"
            ])
        );
        assert_eq!(value["chats"][0]["id"], "sess-1");
        assert_eq!(value["chats"][0]["project"], "a");
        assert_eq!(value["chats"][0]["status"], "done");
        assert_eq!(value["chats"][0]["started_at"], "2026-07-08T09:00:00Z");
        assert_eq!(value["chats"][0]["last_used"], "2026-07-08T09:30:00Z");
        assert_eq!(value["chats"][0]["tokens"], 1800);
        assert_eq!(value["chats"][0]["model"], "fable-5");

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

        // --- history ---
        // 14 jours consécutifs, chacun de forme {date, tokens}. Les valeurs
        // exactes par jour dépendent du fuseau local de la machine (date
        // locale des événements) : seule la forme est garantie déterministe
        // ici, voir les tests dédiés de `daily_history` pour les valeurs.
        let history = value["history"].as_array().expect("history est un tableau");
        assert_eq!(history.len(), HISTORY_DAYS as usize);
        let day_keys: BTreeSet<&str> = BTreeSet::from(["date", "tokens"]);
        for day in history {
            let keys: BTreeSet<&str> = day
                .as_object()
                .expect("un jour d'historique est un objet")
                .keys()
                .map(String::as_str)
                .collect();
            assert_eq!(keys, day_keys);
            assert!(day["date"].is_string());
            assert!(day["tokens"].is_u64());
        }
    }

    // --- Gauge "mode officiel" : used_tokens/cap absents, source dédiée ---

    #[test]
    fn official_gauge_serializes_null_used_tokens_and_cap() {
        let gauge = windows::Gauge {
            used_tokens: None,
            cap: None,
            percent: 42.0,
            reset_at: None,
            source: windows::GaugeSource::Official,
            tokens_source: None,
        };

        let value = serde_json::to_value(&gauge).expect("Gauge doit se sérialiser");

        assert!(value["used_tokens"].is_null());
        assert!(value["cap"].is_null());
        assert!(value["tokens_source"].is_null());
        assert_eq!(value["source"], "official");
        assert_eq!(value["percent"], 42.0);
    }

    #[test]
    fn build_snapshot_on_absent_home_degrades_gracefully_with_null_resets() {
        let now = ts("2026-07-08T10:00:00Z");

        let snapshot = build_snapshot(&fixture("absent"), now, &DEFAULT_CAPS_PRO, None);
        let value = serde_json::to_value(&snapshot).expect("Snapshot doit se sérialiser");

        assert!(value["gauges"]["block_5h"]["reset_at"].is_null());
        assert!(value["gauges"]["weekly"]["reset_at"].is_null());
        assert!(value["gauges"]["weekly_fable"]["reset_at"].is_null());

        // Scan transcripts indisponible (aucun fichier scanné) : les jauges
        // gardent used_tokens Some(0) (affichage du mode repli inchangé) mais
        // tokens_source passe à null — signal « estimation locale
        // indisponible », distinct d'un vrai 0 usage dans la fenêtre,
        // consommé par oauth_usage::merge_estimated_tokens (tâche #31).
        for name in ["block_5h", "weekly", "weekly_fable"] {
            assert_eq!(value["gauges"][name]["used_tokens"], 0);
            assert!(
                value["gauges"][name]["tokens_source"].is_null(),
                "gauges.{name}.tokens_source doit être null quand le scan est vide"
            );
        }

        assert_eq!(value["mcps"], serde_json::json!([]));
        assert_eq!(value["projects"], serde_json::json!([]));
        assert_eq!(value["chats"], serde_json::json!([]));

        // Home absent : 14 jours d'historique, tous à zéro.
        let history = value["history"].as_array().expect("history est un tableau");
        assert_eq!(history.len(), HISTORY_DAYS as usize);
        assert!(history.iter().all(|day| day["tokens"] == 0));

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

        let history_total: u64 = snapshot.history.iter().map(|d| d.tokens).sum();
        println!(
            "smoke test réel : elapsed={:?} history_len={} history_total_tokens={}",
            elapsed,
            snapshot.history.len(),
            history_total
        );
        println!("history: {:?}", snapshot.history);
        println!("{}", serde_json::to_string_pretty(&snapshot).unwrap());
    }

    // --- cli_version_change_entry : détection de montée de version CLI ---

    #[test]
    fn cli_version_change_first_run_signals_nothing() {
        assert_eq!(cli_version_change_entry(None, "2.1.4"), None);
    }

    #[test]
    fn cli_version_change_same_version_signals_nothing() {
        assert_eq!(cli_version_change_entry(Some("2.1.4"), "2.1.4"), None);
    }

    #[test]
    fn cli_version_change_new_version_emits_degraded_entry() {
        assert_eq!(
            cli_version_change_entry(Some("2.1.4"), "2.2.0"),
            Some("cli_version_changed:2.1.4->2.2.0".to_string())
        );
    }

    #[test]
    fn cli_version_change_unavailable_cli_signals_nothing() {
        assert_eq!(cli_version_change_entry(Some("2.1.4"), "?"), None);
    }

    // --- JunimoSettings : (dé)sérialisation, rétrocompat, sanitize ---

    #[test]
    fn junimo_settings_default_matches_spec_defaults() {
        assert_eq!(
            JunimoSettings::default(),
            JunimoSettings {
                shape: "classic".to_string(),
                color: "green".to_string(),
                accessory: "none".to_string(),
                name: "Junimo".to_string(),
            }
        );
    }

    #[test]
    fn app_settings_round_trips_junimo_block_through_json() {
        let settings = AppSettings {
            junimo: JunimoSettings {
                shape: "star".to_string(),
                color: "coral".to_string(),
                accessory: "hat".to_string(),
                name: "Pixel".to_string(),
            },
            ..AppSettings::default()
        };

        let json = serde_json::to_string(&settings).unwrap();
        let parsed: AppSettings = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed, settings);
    }

    #[test]
    fn app_settings_deserializes_legacy_file_without_junimo_block() {
        // Fichier `junimo-settings.json` tel qu'écrit avant la tâche #33 :
        // aucune clé `junimo`. Ne doit jamais échouer ni paniquer ; les
        // défauts spec (classic/green/none/"Junimo") s'appliquent.
        let legacy_json = r#"{
            "caps": null,
            "weekly_reset_reference": "2026-07-15T00:00:00+02:00",
            "global_shortcut": "Alt+Cmd+J"
        }"#;

        let parsed: AppSettings = serde_json::from_str(legacy_json).unwrap();

        assert_eq!(parsed.junimo, JunimoSettings::default());
        assert_eq!(
            parsed.weekly_reset_reference,
            Some("2026-07-15T00:00:00+02:00".to_string())
        );
    }

    #[test]
    fn app_settings_deserializes_legacy_file_with_partial_junimo_block() {
        // Bloc `junimo` présent mais incomplet (un champ manquant) : les
        // champs absents retombent sur leur défaut individuel grâce à
        // `#[serde(default)]` sur `JunimoSettings`, pas d'erreur globale.
        let json = r#"{
            "caps": null,
            "weekly_reset_reference": null,
            "global_shortcut": null,
            "junimo": { "shape": "round" }
        }"#;

        let parsed: AppSettings = serde_json::from_str(json).unwrap();

        assert_eq!(parsed.junimo.shape, "round");
        assert_eq!(parsed.junimo.color, "green");
        assert_eq!(parsed.junimo.accessory, "none");
        assert_eq!(parsed.junimo.name, "Junimo");
    }

    #[test]
    fn app_settings_deserializes_legacy_file_without_appearance_field() {
        // Fichier `junimo-settings.json` tel qu'écrit avant la tâche #40 :
        // aucune clé `appearance`. Défaut light-first, jamais d'erreur.
        let legacy_json = r#"{
            "caps": null,
            "weekly_reset_reference": null,
            "global_shortcut": null
        }"#;

        let parsed: AppSettings = serde_json::from_str(legacy_json).unwrap();

        assert_eq!(parsed.appearance, "light");
    }

    #[test]
    fn app_settings_default_appearance_is_light() {
        assert_eq!(AppSettings::default().appearance, "light");
    }

    #[test]
    fn sanitize_appearance_keeps_known_values_unchanged() {
        assert_eq!(sanitize_appearance("light".to_string()), "light");
        assert_eq!(sanitize_appearance("dark".to_string()), "dark");
    }

    #[test]
    fn sanitize_appearance_falls_back_to_light_on_unknown_value() {
        // Valeur obsolète ou fichier corrompu à la main : jamais de panic,
        // repli silencieux sur "light".
        assert_eq!(sanitize_appearance("system".to_string()), "light");
        assert_eq!(sanitize_appearance("".to_string()), "light");
    }

    #[test]
    fn sanitize_junimo_keeps_known_values_unchanged() {
        let junimo = JunimoSettings {
            shape: "round".to_string(),
            color: "purple".to_string(),
            accessory: "glasses".to_string(),
            name: "Pixel".to_string(),
        };

        assert_eq!(sanitize_junimo(junimo.clone()), junimo);
    }

    #[test]
    fn sanitize_junimo_falls_back_to_defaults_on_unknown_values() {
        // Simule une valeur obsolète (variante retirée dans une version
        // future) ou un fichier corrompu à la main : jamais de panic, repli
        // silencieux sur les défauts.
        let junimo = JunimoSettings {
            shape: "hexagon".to_string(),
            color: "chartreuse".to_string(),
            accessory: "monocle".to_string(),
            name: "Pixel".to_string(),
        };

        let cleaned = sanitize_junimo(junimo);

        assert_eq!(cleaned.shape, "classic");
        assert_eq!(cleaned.color, "green");
        assert_eq!(cleaned.accessory, "none");
        assert_eq!(cleaned.name, "Pixel"); // le nom, lui, reste valide
    }

    #[test]
    fn sanitize_junimo_trims_and_defaults_empty_name() {
        let junimo = JunimoSettings {
            name: "   ".to_string(),
            ..JunimoSettings::default()
        };

        assert_eq!(sanitize_junimo(junimo).name, "Junimo");

        let padded = JunimoSettings {
            name: "  Pixel  ".to_string(),
            ..JunimoSettings::default()
        };
        assert_eq!(sanitize_junimo(padded).name, "Pixel");
    }

    #[test]
    fn sanitize_junimo_defaults_name_over_max_length() {
        let junimo = JunimoSettings {
            name: "x".repeat(JUNIMO_NAME_MAX_LEN + 1),
            ..JunimoSettings::default()
        };

        assert_eq!(sanitize_junimo(junimo).name, "Junimo");
    }
}
