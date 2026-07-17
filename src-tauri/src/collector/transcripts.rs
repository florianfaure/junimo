//! Scan et parse en flux des transcripts JSONL de Claude Code
//! (`~/.claude/projects/**/*.jsonl`, voir `docs/specs/2026-07-09-junimo.md`,
//! section « Calcul des jauges »).
//!
//! Le format des transcripts n'est pas documenté par Anthropic : ce module
//! est défensif de bout en bout. Une ligne malformée (JSON invalide, champ
//! requis absent) est comptée dans `parse_errors` et ignorée. Une ligne bien
//! formée mais sans `message.usage` (événement non-assistant : résumé de
//! session, message utilisateur, etc.) est ignorée silencieusement — ce
//! n'est pas une erreur de parsing, c'est un événement normal du flux.
//!
//! Seuls les fichiers dont le `mtime` est plus récent que
//! [`MTIME_CUTOFF_DAYS`] jours sont scannés : les fenêtres consommées en aval
//! (bloc 5h, 7 jours, historique 14 jours) ne remontent jamais aussi loin, la
//! marge de 16 jours est une garde de sécurité au-dessus des 15 jours de
//! lookback du snapshot. Le paramètre `since` filtre ensuite les événements
//! eux-mêmes (`ts >= since`).

use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Fenêtre de rétention des fichiers scannés : un fichier dont le `mtime`
/// est plus vieux que cette limite n'est pas ouvert. Justifiée par les
/// fenêtres glissantes en aval (5h courante, 7 jours, historique 14 jours)
/// qui ne remontent jamais aussi loin ; marge de sécurité au-dessus des 15
/// jours de lookback du snapshot. `since` reste la source de vérité pour le
/// filtrage des événements.
const MTIME_CUTOFF_DAYS: u64 = 16;

/// Décompte de tokens d'un événement d'usage, dans les quatre catégories
/// exposées par l'API Claude. Tous les champs valent 0 par défaut si absents
/// du JSON source.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
pub struct TokenCounts {
    pub input: u64,
    pub output: u64,
    pub cache_creation: u64,
    pub cache_read: u64,
}

/// Un événement d'usage assistant, résultat de la déduplication et du
/// filtrage par `since`.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct UsageEvent {
    pub ts: DateTime<Utc>,
    pub model: String,
    pub tokens: TokenCounts,
    /// Nom du dossier de premier niveau sous `.claude/projects/` d'où vient
    /// le fichier (ex. `-Users-you-junimo`), chaîne vide si non
    /// déterminable. Alimente la vue « par projet » (voir
    /// `collector::snapshot::project_stats`).
    pub project: String,
    /// Identifiant de conversation (`sessionId`, champ racine présent sur
    /// tout événement du transcript — pas seulement les événements d'usage),
    /// chaîne vide si absent. Alimente le regroupement par conversation
    /// (tâche #43, voir `collector::snapshot::chat_stats`) ; extrait au fil
    /// du même parcours de scan, aucune passe supplémentaire sur les
    /// fichiers.
    pub session_id: String,
}

/// Résultat agrégé d'un scan complet : événements triés par `ts` croissant,
/// et deux compteurs de santé du parsing (jamais de panic, toujours un
/// résultat).
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct TranscriptScan {
    pub events: Vec<UsageEvent>,
    pub parse_errors: u64,
    pub files_scanned: u64,
}

// --- Structures brutes de désérialisation (partielles, défensives) ---

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawEvent {
    timestamp: Option<String>,
    message: Option<RawMessage>,
    #[serde(rename = "requestId")]
    request_id: Option<String>,
    /// Identifiant de conversation, présent à la racine de tout événement du
    /// transcript (voir `UsageEvent::session_id`).
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawMessage {
    id: Option<String>,
    model: Option<String>,
    usage: Option<RawUsage>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawUsage {
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_input_tokens: u64,
    cache_read_input_tokens: u64,
}

/// Parcourt récursivement `dir` et pousse dans `out` les fichiers `*.jsonl`
/// dont le `mtime` est plus récent que `cutoff`. Silencieux sur toute erreur
/// d'E/S (répertoire absent, permissions) : un scan dégradé retourne
/// simplement moins de fichiers, jamais de panic.
fn collect_jsonl_paths(dir: &Path, cutoff: SystemTime, out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };

        if file_type.is_dir() {
            collect_jsonl_paths(&path, cutoff, out);
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }

        let is_recent = match entry.metadata().and_then(|meta| meta.modified()) {
            Ok(modified) => match modified.duration_since(cutoff) {
                Ok(_) => true,
                // `modified` est antérieur à `cutoff` : recent seulement si
                // `cutoff` lui-même est dans le futur par rapport à
                // `modified`, ce qui ne peut arriver ici — donc pas recent.
                Err(_) => false,
            },
            // Métadonnées illisibles ou plateforme sans mtime : on garde le
            // fichier par prudence plutôt que de perdre silencieusement des
            // données.
            Err(_) => true,
        };

        if is_recent {
            out.push(path);
        }
    }
}

/// Nom du projet d'un fichier de transcript : le premier composant de chemin
/// sous la racine `projects/` (ex. `-Users-you-junimo`). Chaîne vide
/// si `path` n'est pas sous `root` ou si aucun composant n'est extractible.
fn project_from_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .ok()
        .and_then(|rel| rel.components().next())
        .and_then(|comp| comp.as_os_str().to_str())
        .unwrap_or_default()
        .to_string()
}

/// Parse une ligne JSONL. Retourne :
/// - `Ok(Some(event))` si la ligne porte un `message.usage` valide avec un
///   timestamp RFC3339 parsable ;
/// - `Ok(None)` si la ligne est bien formée mais n'est pas un événement
///   d'usage assistant (pas de `message`, ou pas de `message.usage`) — ce
///   n'est pas une erreur ;
/// - `Err(())` si la ligne est malformée : JSON invalide, ou usage présent
///   mais timestamp absent/invalide.
fn parse_line(line: &str) -> Result<Option<(RawEvent, DateTime<Utc>)>, ()> {
    let raw: RawEvent = serde_json::from_str(line).map_err(|_| ())?;

    let has_usage = raw
        .message
        .as_ref()
        .map(|m| m.usage.is_some())
        .unwrap_or(false);

    if !has_usage {
        return Ok(None);
    }

    let ts = raw
        .timestamp
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .ok_or(())?;

    Ok(Some((raw, ts)))
}

/// Scanne `<home>/.claude/projects/**/*.jsonl` (fichiers récents seulement,
/// voir [`MTIME_CUTOFF_DAYS`]), parse chaque fichier en flux (jamais chargé
/// entièrement en mémoire), déduplique par `(message.id, requestId)` et
/// retourne les événements dont `ts >= since`, triés par `ts` croissant.
///
/// Ne panique jamais : toute source dégradée (répertoire absent, fichier
/// illisible, ligne malformée) est absorbée et reflétée dans
/// `parse_errors`/`files_scanned`.
pub fn collect_events(home: &Path, since: DateTime<Utc>) -> TranscriptScan {
    let root = home.join(".claude").join("projects");
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(MTIME_CUTOFF_DAYS * 24 * 3600))
        .unwrap_or(SystemTime::UNIX_EPOCH);

    let mut paths = Vec::new();
    collect_jsonl_paths(&root, cutoff, &mut paths);

    let mut events = Vec::new();
    let mut parse_errors: u64 = 0;
    let mut files_scanned: u64 = 0;
    let mut seen: HashSet<(String, String)> = HashSet::new();

    for path in &paths {
        let file = match File::open(path) {
            Ok(file) => file,
            Err(_) => continue,
        };
        files_scanned += 1;
        let project = project_from_path(&root, path);

        for line in BufReader::new(file).lines() {
            let line = match line {
                Ok(line) => line,
                Err(_) => {
                    parse_errors += 1;
                    continue;
                }
            };

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            match parse_line(trimmed) {
                Ok(None) => continue,
                Err(()) => {
                    parse_errors += 1;
                    continue;
                }
                Ok(Some((raw, ts))) => {
                    if ts < since {
                        continue;
                    }

                    let message = raw.message.expect("has_usage implique message présent");
                    let usage = message.usage.expect("has_usage implique usage présent");

                    if let Some(id) = &message.id {
                        let key = (id.clone(), raw.request_id.clone().unwrap_or_default());
                        if !seen.insert(key) {
                            continue;
                        }
                    }

                    events.push(UsageEvent {
                        ts,
                        model: message.model.unwrap_or_default(),
                        tokens: TokenCounts {
                            input: usage.input_tokens,
                            output: usage.output_tokens,
                            cache_creation: usage.cache_creation_input_tokens,
                            cache_read: usage.cache_read_input_tokens,
                        },
                        project: project.clone(),
                        session_id: raw.session_id.clone().unwrap_or_default(),
                    });
                }
            }
        }
    }

    events.sort_by_key(|e| e.ts);

    TranscriptScan {
        events,
        parse_errors,
        files_scanned,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::io::Write;
    use std::time::UNIX_EPOCH;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/transcripts")
            .join(name)
    }

    fn far_past() -> DateTime<Utc> {
        DateTime::<Utc>::from_timestamp(0, 0).unwrap()
    }

    fn ts(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn absent_projects_dir_yields_empty_scan_without_panic() {
        let scan = collect_events(&fixture("absent"), far_past());

        assert!(scan.events.is_empty());
        assert_eq!(scan.parse_errors, 0);
        assert_eq!(scan.files_scanned, 0);
    }

    #[test]
    fn empty_file_is_scanned_with_no_events_and_no_errors() {
        let scan = collect_events(&fixture("empty"), far_past());

        assert!(scan.events.is_empty());
        assert_eq!(scan.parse_errors, 0);
        assert_eq!(scan.files_scanned, 1);
    }

    #[test]
    fn multi_model_events_are_parsed_and_non_usage_lines_are_skipped() {
        let scan = collect_events(&fixture("multi_model"), far_past());

        assert_eq!(scan.parse_errors, 0);
        assert_eq!(scan.files_scanned, 1);
        assert_eq!(scan.events.len(), 2);

        assert_eq!(scan.events[0].model, "claude-fable-5");
        assert_eq!(
            scan.events[0].tokens,
            TokenCounts {
                input: 100,
                output: 50,
                cache_creation: 10,
                cache_read: 5,
            }
        );

        assert_eq!(scan.events[1].model, "claude-haiku-4");
        assert_eq!(
            scan.events[1].tokens,
            TokenCounts {
                input: 20,
                output: 8,
                cache_creation: 0,
                cache_read: 0,
            }
        );
    }

    #[test]
    fn session_id_is_extracted_from_root_level_field_and_empty_when_absent() {
        // tâche #43 : `sess-alpha` regroupe 2 événements dans un fichier,
        // `sess-beta` est présent sur le premier événement d'un second
        // fichier mais absent du second (ligne sans `sessionId` -> "").
        let scan = collect_events(&fixture("session_ids"), far_past());

        assert_eq!(scan.events.len(), 4);
        let by_tokens: HashMap<u64, &str> = scan
            .events
            .iter()
            .map(|e| (e.tokens.input, e.session_id.as_str()))
            .collect();
        assert_eq!(by_tokens[&10], "sess-alpha");
        assert_eq!(by_tokens[&20], "sess-alpha");
        assert_eq!(by_tokens[&7], "sess-beta");
        assert_eq!(by_tokens[&1], "");
    }

    #[test]
    fn project_is_extracted_from_the_first_folder_under_projects_root() {
        let scan = collect_events(&fixture("multi_model"), far_past());

        assert_eq!(scan.events.len(), 2);
        // Les deux événements viennent de `.claude/projects/proj-a/…`.
        assert_eq!(scan.events[0].project, "proj-a");
        assert_eq!(scan.events[1].project, "proj-a");
    }

    #[test]
    fn malformed_lines_are_counted_without_panicking_lines_without_usage_are_not_errors() {
        let scan = collect_events(&fixture("malformed"), far_past());

        // 1 ligne JSON cassée + 1 usage sans timestamp + 1 usage avec
        // timestamp invalide = 3 erreurs. La ligne sans usage et la ligne
        // sans `message` ne comptent pas comme erreurs.
        assert_eq!(scan.parse_errors, 3);
        assert_eq!(scan.files_scanned, 1);
        assert_eq!(scan.events.len(), 1);
        assert_eq!(scan.events[0].model, "claude-fable-5");
    }

    #[test]
    fn duplicate_events_across_files_are_deduplicated_by_id_and_request_id() {
        let scan = collect_events(&fixture("duplicates"), far_past());

        assert_eq!(scan.parse_errors, 0);
        assert_eq!(scan.files_scanned, 2);
        // msg_20 (dédupliqué), msg_21, msg_22 + 2 événements sans id (gardés
        // faute de clé de dédup possible) = 5.
        assert_eq!(scan.events.len(), 5);

        let with_id_count = scan
            .events
            .iter()
            .filter(|e| e.tokens.input == 10 || e.tokens.input == 3 || e.tokens.input == 7)
            .count();
        assert_eq!(with_id_count, 3);

        let no_id_count = scan.events.iter().filter(|e| e.tokens.input == 1).count();
        assert_eq!(no_id_count, 2);
    }

    #[test]
    fn since_filters_events_by_timestamp_inclusive() {
        let scan = collect_events(&fixture("since_filter"), ts("2026-07-03T00:00:00Z"));

        assert_eq!(scan.parse_errors, 0);
        assert_eq!(scan.files_scanned, 1);
        assert_eq!(scan.events.len(), 2);
        assert_eq!(scan.events[0].ts, ts("2026-07-03T00:00:00.000Z"));
        assert_eq!(scan.events[1].ts, ts("2026-07-05T00:00:00.000Z"));
    }

    #[test]
    fn events_are_returned_sorted_by_timestamp_regardless_of_file_order() {
        let scan = collect_events(&fixture("unsorted"), far_past());

        assert_eq!(scan.events.len(), 2);
        assert!(scan.events[0].ts < scan.events[1].ts);
        assert_eq!(scan.events[0].ts, ts("2026-07-02T00:00:00.000Z"));
        assert_eq!(scan.events[1].ts, ts("2026-07-04T00:00:00.000Z"));
    }

    /// Prépare un `home` temporaire avec un fichier récent et un fichier
    /// dont le `mtime` est artificiellement vieilli au-delà de la limite de
    /// scan (voir [`MTIME_CUTOFF_DAYS`]), pour vérifier que le filtre mtime
    /// exclut bien les vieux fichiers indépendamment de `since`.
    fn write_jsonl(path: &Path, message_id: &str, timestamp: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut file = File::create(path).unwrap();
        writeln!(
            file,
            r#"{{"type":"assistant","timestamp":"{timestamp}","message":{{"id":"{message_id}","model":"claude-fable-5","usage":{{"input_tokens":1,"output_tokens":1}}}},"requestId":"req_{message_id}"}}"#
        )
        .unwrap();
    }

    #[test]
    fn files_older_than_mtime_cutoff_are_excluded_even_if_since_would_include_them() {
        let home = std::env::temp_dir().join(format!(
            "junimo-transcripts-mtime-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let projects = home.join(".claude/projects/proj");
        fs::create_dir_all(&projects).unwrap();

        let recent_path = projects.join("recent.jsonl");
        let old_path = projects.join("old.jsonl");
        write_jsonl(&recent_path, "msg_recent", "2026-07-08T00:00:00Z");
        write_jsonl(&old_path, "msg_old", "2026-06-01T00:00:00Z");

        let old_mtime = SystemTime::now() - Duration::from_secs(17 * 24 * 3600);
        File::open(&old_path)
            .unwrap()
            .set_modified(old_mtime)
            .unwrap();

        // `since` très ancien : sans le filtre mtime, l'événement du
        // fichier vieilli passerait le filtre `ts >= since`.
        let scan = collect_events(&home, far_past());

        fs::remove_dir_all(&home).unwrap();

        assert_eq!(scan.files_scanned, 1);
        assert_eq!(scan.events.len(), 1);
        assert_eq!(scan.events[0].model, "claude-fable-5");
    }

    #[test]
    fn ten_thousand_lines_are_collected_in_under_one_second() {
        let home = std::env::temp_dir().join(format!(
            "junimo-transcripts-perf-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let projects = home.join(".claude/projects/proj");
        fs::create_dir_all(&projects).unwrap();

        let path = projects.join("big.jsonl");
        let mut file = File::create(&path).unwrap();
        for i in 0..10_000u32 {
            writeln!(
                file,
                r#"{{"type":"assistant","timestamp":"2026-07-08T00:00:{:02}Z","message":{{"id":"msg_{i}","model":"claude-fable-5","usage":{{"input_tokens":1,"output_tokens":1}}}},"requestId":"req_{i}"}}"#,
                i % 60,
                i = i
            )
            .unwrap();
        }
        drop(file);

        let start = std::time::Instant::now();
        let scan = collect_events(&home, far_past());
        let elapsed = start.elapsed();

        fs::remove_dir_all(&home).unwrap();

        assert_eq!(scan.events.len(), 10_000);
        assert_eq!(scan.parse_errors, 0);
        assert!(
            elapsed < Duration::from_secs(1),
            "collect_events a pris {elapsed:?}, attendu < 1s"
        );
    }

    /// Smoke test manuel sur les vraies données de la machine : lecture
    /// seule, jamais exécuté par la CI (`#[ignore]`). Lancer avec
    /// `cargo test -- --ignored collect_events_smoke_test_on_real_home`.
    #[test]
    #[ignore]
    fn collect_events_smoke_test_on_real_home() {
        let home = PathBuf::from(std::env::var("HOME").expect("HOME doit être défini"));
        let since = Utc::now() - chrono::Duration::days(7);

        let start = std::time::Instant::now();
        let scan = collect_events(&home, since);
        let elapsed = start.elapsed();

        println!(
            "smoke test réel : events={} parse_errors={} files_scanned={} elapsed={:?}",
            scan.events.len(),
            scan.parse_errors,
            scan.files_scanned,
            elapsed
        );
    }
}
