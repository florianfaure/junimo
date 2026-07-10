//! Health-check opt-in des serveurs MCP configurés (tâche #17).
//!
//! Au-delà de la liste statique, on tente réellement de joindre chaque
//! serveur : handshake JSON-RPC `initialize` pour le transport **stdio**
//! (spawn + timeout court, process systématiquement tué), ping HTTP POST
//! pour **http/sse**. Le verdict (ok / warn / down) alimente les pastilles
//! pixel du front.
//!
//! Coûteux (spawn de process) : déclenché uniquement à la demande via la
//! commande `check_mcps`, jamais en automatique.
//!
//! SÉCURITÉ : `McpSpec::env` peut contenir des secrets (clés API). Rien de
//! ce module ne logge ni ne renvoie l'`env` au front — les détails d'erreur
//! sont des messages courts et neutres.

use crate::collector::config::McpSpec;
use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// Timeout global du handshake stdio (spawn + écriture + lecture réponse).
const STDIO_TIMEOUT_SECS: u64 = 6;
/// Timeout de la requête HTTP/SSE.
const HTTP_TIMEOUT_SECS: u64 = 5;

/// Requête JSON-RPC `initialize` envoyée aux serveurs (stdio comme http),
/// sérialisée une seule fois. `\n` ajouté séparément pour le stdio.
const INITIALIZE_REQUEST: &str = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"junimo","version":"0.1.0"}}}"#;

/// État de santé d'un serveur MCP, sérialisé vers le front. `status` ∈
/// "ok" | "warn" | "down". `detail` est une raison courte et **sans secret**.
#[derive(Debug, Clone, Serialize)]
pub struct McpHealth {
    pub name: String,
    pub status: String,
    pub detail: Option<String>,
}

/// Fabrique un verdict "down" avec une raison courte (helper de lisibilité).
fn down(name: &str, detail: &str) -> McpHealth {
    McpHealth {
        name: name.to_string(),
        status: "down".to_string(),
        detail: Some(detail.to_string()),
    }
}

/// Fonction **pure** : à partir de la ligne de réponse JSON-RPC `initialize`,
/// renvoie `(status, detail)`.
/// - JSON avec `result` → ok (detail = `serverInfo.name` + version si présents)
/// - JSON avec `error` → warn (code d'erreur en detail)
/// - JSON valide sans l'un ni l'autre / JSON illisible → down
pub fn verdict_from_stdio_response(line: &str) -> (String, Option<String>) {
    let value: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return ("down".to_string(), Some("réponse illisible".to_string())),
    };

    if let Some(result) = value.get("result") {
        let detail = result.get("serverInfo").and_then(|si| {
            let name = si.get("name").and_then(|n| n.as_str());
            let version = si.get("version").and_then(|v| v.as_str());
            match (name, version) {
                (Some(n), Some(v)) => Some(format!("{n} {v}")),
                (Some(n), None) => Some(n.to_string()),
                _ => None,
            }
        });
        return ("ok".to_string(), detail);
    }

    if let Some(error) = value.get("error") {
        let detail = match error.get("code").and_then(|c| c.as_i64()) {
            Some(code) => format!("erreur {code}"),
            None => "erreur".to_string(),
        };
        return ("warn".to_string(), Some(detail));
    }

    ("down".to_string(), Some("réponse sans result".to_string()))
}

/// Fonction **pure** : verdict d'un ping http/sse selon le code HTTP.
/// - 2xx → ok
/// - tout autre code (401/403/404/405…) → warn « HTTP <code> » (serveur
///   joignable mais refus, souvent auth)
pub fn verdict_from_http_status(code: u16) -> (String, Option<String>) {
    if (200..300).contains(&code) {
        ("ok".to_string(), None)
    } else {
        ("warn".to_string(), Some(format!("HTTP {code}")))
    }
}

/// Vrai si la ligne est la réponse JSON-RPC attendue (`"id":1`). Les autres
/// lignes de stdout (bruit de log) sont ignorées par la boucle de lecture.
fn is_response_line(line: &str) -> bool {
    match serde_json::from_str::<serde_json::Value>(line) {
        Ok(v) => v.get("id").and_then(|id| id.as_i64()) == Some(1),
        Err(_) => false,
    }
}

/// Handshake stdio : spawn `command` + `args` + `env`, écrit la requête
/// `initialize` newline-delimited, lit stdout jusqu'à la réponse `id:1`, puis
/// TUE le process (kill + wait, jamais de zombie). Timeout global via le
/// pattern thread + mpsc (cf. `read_cli_version`).
fn check_stdio(spec: &McpSpec) -> McpHealth {
    let command = match spec.command.as_deref() {
        Some(c) if !c.is_empty() => c,
        _ => return down(&spec.name, "command absente"),
    };

    let mut cmd = Command::new(command);
    cmd.args(&spec.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    // env : peut contenir des secrets, transmis au process mais jamais loggé.
    for (key, value) in &spec.env {
        cmd.env(key, value);
    }

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        // io::Error de spawn : ne contient jamais l'env (typiquement
        // "No such file or directory"). Message tronqué court par prudence.
        Err(_) => return down(&spec.name, "spawn impossible"),
    };

    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let (mut stdin, stdout) = match (stdin, stdout) {
        (Some(stdin), Some(stdout)) => (stdin, stdout),
        _ => {
            let _ = child.kill();
            let _ = child.wait();
            return down(&spec.name, "pipes indisponibles");
        }
    };

    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        // Écriture de la requête initialize.
        if stdin.write_all(INITIALIZE_REQUEST.as_bytes()).is_err()
            || stdin.write_all(b"\n").is_err()
            || stdin.flush().is_err()
        {
            let _ = tx.send(None);
            return;
        }
        // Lecture ligne par ligne jusqu'à la réponse id:1 (stdin reste ouvert
        // le temps de la lecture pour ne pas faire sortir le serveur trop tôt).
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) if is_response_line(&line) => {
                    let _ = tx.send(Some(verdict_from_stdio_response(&line)));
                    return;
                }
                Ok(_) => continue, // bruit de log, on poursuit
                Err(_) => break,
            }
        }
        let _ = tx.send(None); // EOF sans réponse exploitable
    });

    let verdict = rx.recv_timeout(Duration::from_secs(STDIO_TIMEOUT_SECS));

    // Le process est tué quoi qu'il arrive : réponse reçue, timeout ou EOF.
    let _ = child.kill();
    let _ = child.wait();

    match verdict {
        Ok(Some((status, detail))) => McpHealth {
            name: spec.name.clone(),
            status,
            detail,
        },
        Ok(None) => down(&spec.name, "pas de réponse initialize"),
        Err(_) => down(&spec.name, "timeout"),
    }
}

/// Ping http/sse : POST de la requête `initialize` avec les headers MCP,
/// timeout court. Non-2xx → warn (joignable mais refus). Erreur réseau →
/// down.
fn check_http(spec: &McpSpec) -> McpHealth {
    let url = match spec.url.as_deref() {
        Some(u) if !u.is_empty() => u,
        _ => return down(&spec.name, "url absente"),
    };

    let response = ureq::post(url)
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .send_string(INITIALIZE_REQUEST);

    let (status, detail) = match response {
        Ok(resp) => verdict_from_http_status(resp.status()),
        // Réponse HTTP non-2xx : serveur joignable, verdict warn « HTTP <code> ».
        Err(ureq::Error::Status(code, _)) => verdict_from_http_status(code),
        // Erreur transport (réseau, DNS, timeout, TLS) : serveur injoignable.
        Err(_) => return down(&spec.name, "réseau injoignable"),
    };

    McpHealth {
        name: spec.name.clone(),
        status,
        detail,
    }
}

/// Route un serveur vers le bon check selon son transport, avec repli sur les
/// champs disponibles pour un transport inconnu.
fn check_one(spec: &McpSpec) -> McpHealth {
    match spec.transport.as_str() {
        "stdio" => check_stdio(spec),
        "http" | "sse" => check_http(spec),
        _ if spec.command.is_some() => check_stdio(spec),
        _ if spec.url.is_some() => check_http(spec),
        _ => down(&spec.name, "transport inconnu"),
    }
}

/// Vérifie tous les serveurs en parallèle (un thread par serveur). L'ordre de
/// sortie respecte l'ordre d'entrée.
pub fn check_all(specs: Vec<McpSpec>) -> Vec<McpHealth> {
    let handles: Vec<_> = specs
        .into_iter()
        .map(|spec| thread::spawn(move || check_one(&spec)))
        .collect();

    handles
        .into_iter()
        .map(|handle| {
            handle.join().unwrap_or_else(|_| McpHealth {
                name: "?".to_string(),
                status: "down".to_string(),
                detail: Some("thread interrompu".to_string()),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stdio_verdict_result_is_ok_with_server_info() {
        let line = r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"figma-console","version":"1.2.3"}}}"#;
        let (status, detail) = verdict_from_stdio_response(line);
        assert_eq!(status, "ok");
        assert_eq!(detail, Some("figma-console 1.2.3".to_string()));
    }

    #[test]
    fn stdio_verdict_result_without_server_info_is_ok_no_detail() {
        let line = r#"{"jsonrpc":"2.0","id":1,"result":{}}"#;
        let (status, detail) = verdict_from_stdio_response(line);
        assert_eq!(status, "ok");
        assert_eq!(detail, None);
    }

    #[test]
    fn stdio_verdict_error_is_warn_with_code() {
        let line = r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}"#;
        let (status, detail) = verdict_from_stdio_response(line);
        assert_eq!(status, "warn");
        assert_eq!(detail, Some("erreur -32601".to_string()));
    }

    #[test]
    fn stdio_verdict_invalid_json_is_down() {
        let (status, detail) = verdict_from_stdio_response("pas du json {{{");
        assert_eq!(status, "down");
        assert_eq!(detail, Some("réponse illisible".to_string()));
    }

    #[test]
    fn stdio_verdict_valid_json_without_result_or_error_is_down() {
        let (status, _) = verdict_from_stdio_response(r#"{"jsonrpc":"2.0","id":1}"#);
        assert_eq!(status, "down");
    }

    #[test]
    fn http_verdict_2xx_is_ok_and_non_2xx_is_warn() {
        assert_eq!(verdict_from_http_status(200).0, "ok");
        assert_eq!(verdict_from_http_status(204).0, "ok");

        let (status, detail) = verdict_from_http_status(401);
        assert_eq!(status, "warn");
        assert_eq!(detail, Some("HTTP 401".to_string()));

        assert_eq!(verdict_from_http_status(404).0, "warn");
        assert_eq!(verdict_from_http_status(500).0, "warn");
    }

    #[test]
    fn is_response_line_matches_id_one_only() {
        assert!(is_response_line(r#"{"id":1,"result":{}}"#));
        assert!(!is_response_line(r#"{"id":2,"result":{}}"#));
        assert!(!is_response_line("log line, not json"));
    }

    /// Smoke test réel sur la config de la machine (non lancé par défaut).
    /// `cargo test -- --ignored check_mcps_smoke --nocapture`. Un serveur
    /// down/warn n'est PAS un échec : c'est de l'information. N'affiche JAMAIS
    /// l'env des serveurs.
    #[test]
    #[ignore]
    fn check_mcps_smoke_test_on_real_config() {
        let home = crate::collector::snapshot::resolve_home();
        let specs = crate::collector::config::collect_mcp_specs(&home);
        println!("{} serveur(s) MCP détecté(s)", specs.len());
        let healths = check_all(specs);
        for health in &healths {
            println!(
                "  {} -> {} ({})",
                health.name,
                health.status,
                health.detail.as_deref().unwrap_or("-")
            );
        }
    }
}
