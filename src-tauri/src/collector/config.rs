//! Lecture défensive de la configuration Claude Code : compte OAuth, MCPs
//! déclarés (globaux et par projet), modèle par défaut, version du CLI.
//!
//! Toutes les fonctions de lecture prennent `home: &Path` explicitement pour
//! rester testables sur des fixtures (voir `tests/fixtures/`). Aucune de ces
//! fonctions ne doit jamais paniquer : un fichier absent ou un JSON invalide
//! se traduit par une entrée dans `ConfigData::degraded` et des valeurs par
//! défaut, jamais par un crash du collecteur.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// Informations de compte extraites de `oauthAccount` dans `~/.claude.json`.
/// Tous les champs sont optionnels : le format n'est pas documenté par
/// Anthropic et peut changer sans préavis.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct AccountInfo {
    pub display_name: Option<String>,
    pub email_address: Option<String>,
    pub organization_name: Option<String>,
    pub organization_type: Option<String>,
    pub user_rate_limit_tier: Option<String>,
    pub billing_type: Option<String>,
    /// Date de création de l'abonnement (RFC3339). Sert d'ancre estimée pour
    /// la fenêtre hebdomadaire (les resets `/usage` semblent alignés dessus).
    pub subscription_created_at: Option<String>,
}

/// Scope d'un serveur MCP déclaré : global (`mcpServers` racine) ou
/// spécifique à un projet (`projects.<chemin>.mcpServers`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpScope {
    Global,
    Project,
}

/// Un serveur MCP déclaré, dédupliqué par nom (le scope global l'emporte en
/// cas de doublon avec un scope projet).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct McpServer {
    pub name: String,
    pub scope: McpScope,
    /// Transport déduit : valeur du champ `type` si présent, sinon `"http"`
    /// si un champ `url` est présent, sinon `"stdio"`.
    pub transport: String,
}

/// Snapshot agrégé de la configuration Claude Code, prêt à être sérialisé
/// pour le front. `degraded` liste les sources qui n'ont pas pu être lues
/// correctement (fichier absent, JSON invalide, CLI indisponible).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ConfigData {
    pub account: AccountInfo,
    pub mcps: Vec<McpServer>,
    pub default_model: Option<String>,
    pub cli_version: Option<String>,
    pub degraded: Vec<String>,
}

// --- Structures brutes de désérialisation (partielles, défensives) ---

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawClaudeJson {
    oauth_account: Option<RawOauthAccount>,
    mcp_servers: HashMap<String, RawMcpServer>,
    projects: HashMap<String, RawProject>,
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawOauthAccount {
    display_name: Option<String>,
    email_address: Option<String>,
    organization_name: Option<String>,
    organization_type: Option<String>,
    user_rate_limit_tier: Option<String>,
    billing_type: Option<String>,
    subscription_created_at: Option<String>,
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawProject {
    mcp_servers: HashMap<String, RawMcpServer>,
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(default)]
struct RawMcpServer {
    #[serde(rename = "type")]
    server_type: Option<String>,
    url: Option<String>,
    /// Binaire à lancer pour un serveur stdio (ex. "npx", "node").
    command: Option<String>,
    /// Arguments passés au binaire stdio.
    args: Vec<String>,
    /// Variables d'environnement du serveur. ATTENTION : peut contenir des
    /// secrets (clés API) — ne JAMAIS logger ni sérialiser vers le front.
    env: HashMap<String, String>,
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(default)]
struct RawSettings {
    model: Option<String>,
}

impl From<RawOauthAccount> for AccountInfo {
    fn from(raw: RawOauthAccount) -> Self {
        AccountInfo {
            display_name: raw.display_name,
            email_address: raw.email_address,
            organization_name: raw.organization_name,
            organization_type: raw.organization_type,
            user_rate_limit_tier: raw.user_rate_limit_tier,
            billing_type: raw.billing_type,
            subscription_created_at: raw.subscription_created_at,
        }
    }
}

fn infer_transport(server: &RawMcpServer) -> String {
    if let Some(server_type) = &server.server_type {
        server_type.clone()
    } else if server.url.is_some() {
        "http".to_string()
    } else {
        "stdio".to_string()
    }
}

/// Lit `<home>/.claude.json` et en extrait le compte OAuth ainsi que la
/// liste dédupliquée des serveurs MCP (globaux puis par projet). Toute
/// erreur (fichier absent, JSON invalide) est consignée dans `degraded` et
/// remplacée par des valeurs par défaut.
fn read_account_config(home: &Path, degraded: &mut Vec<String>) -> (AccountInfo, Vec<McpServer>) {
    let path = home.join(".claude.json");
    let raw: RawClaudeJson = match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(parsed) => parsed,
            Err(_) => {
                degraded.push("claude_json_invalid".to_string());
                RawClaudeJson::default()
            }
        },
        Err(_) => {
            degraded.push("claude_json_missing".to_string());
            RawClaudeJson::default()
        }
    };

    let account = raw.oauth_account.map(AccountInfo::from).unwrap_or_default();

    let mut seen: HashSet<String> = HashSet::new();
    let mut mcps: Vec<McpServer> = Vec::new();

    // Scope global d'abord : il l'emporte en cas de doublon avec un projet.
    for (name, server) in &raw.mcp_servers {
        if seen.insert(name.clone()) {
            mcps.push(McpServer {
                name: name.clone(),
                scope: McpScope::Global,
                transport: infer_transport(server),
            });
        }
    }

    // Projets triés par chemin pour un résultat déterministe si un même nom
    // de serveur est déclaré dans plusieurs projets.
    let mut project_paths: Vec<&String> = raw.projects.keys().collect();
    project_paths.sort();
    for project_path in project_paths {
        let project = &raw.projects[project_path];
        for (name, server) in &project.mcp_servers {
            if seen.insert(name.clone()) {
                mcps.push(McpServer {
                    name: name.clone(),
                    scope: McpScope::Project,
                    transport: infer_transport(server),
                });
            }
        }
    }

    mcps.sort_by(|a, b| a.name.cmp(&b.name));

    (account, mcps)
}

/// Spécification interne d'un serveur MCP, destinée au health-check
/// (tâche #17). N'est **PAS** exposée dans le `Snapshot` : le contrat front
/// des MCPs (`McpServer`) reste inchangé. `env` peut contenir des secrets
/// (clés API) — cette struct ne dérive donc pas `Serialize` et son `env` ne
/// doit JAMAIS être loggé ni renvoyé au front.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpSpec {
    pub name: String,
    /// Transport déduit (voir `infer_transport`) : "stdio", "http", "sse"…
    pub transport: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub url: Option<String>,
}

fn spec_from_raw(name: &str, server: &RawMcpServer) -> McpSpec {
    McpSpec {
        name: name.to_string(),
        transport: infer_transport(server),
        command: server.command.clone(),
        args: server.args.clone(),
        env: server.env.clone(),
        url: server.url.clone(),
    }
}

/// Collecte les specs complètes (command/args/env/url) des serveurs MCP
/// déclarés, dédupliquées selon la même règle que `read_account_config` : le
/// scope global l'emporte sur un doublon de scope projet, résultat trié par
/// nom. Utilisée uniquement par le health-check (jamais dans le Snapshot).
/// Toute erreur de lecture donne une liste vide (best-effort, jamais de
/// panic ni de `degraded` — le contexte d'appel n'expose pas ce canal).
pub fn collect_mcp_specs(home: &Path) -> Vec<McpSpec> {
    let path = home.join(".claude.json");
    let raw: RawClaudeJson = match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => RawClaudeJson::default(),
    };

    let mut seen: HashSet<String> = HashSet::new();
    let mut specs: Vec<McpSpec> = Vec::new();

    // Scope global d'abord : il l'emporte en cas de doublon avec un projet.
    for (name, server) in &raw.mcp_servers {
        if seen.insert(name.clone()) {
            specs.push(spec_from_raw(name, server));
        }
    }

    // Projets triés par chemin pour un résultat déterministe.
    let mut project_paths: Vec<&String> = raw.projects.keys().collect();
    project_paths.sort();
    for project_path in project_paths {
        let project = &raw.projects[project_path];
        for (name, server) in &project.mcp_servers {
            if seen.insert(name.clone()) {
                specs.push(spec_from_raw(name, server));
            }
        }
    }

    specs.sort_by(|a, b| a.name.cmp(&b.name));
    specs
}

/// Lit `<home>/.claude/settings.json` et en extrait le modèle par défaut.
fn read_default_model(home: &Path, degraded: &mut Vec<String>) -> Option<String> {
    let path = home.join(".claude").join("settings.json");
    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<RawSettings>(&content) {
            Ok(parsed) => parsed.model,
            Err(_) => {
                degraded.push("settings_json_invalid".to_string());
                None
            }
        },
        Err(_) => {
            degraded.push("settings_json_missing".to_string());
            None
        }
    }
}

/// Exécute `claude --version` avec un timeout de 2 s, best-effort. Isolée
/// volontairement : jamais couverte par un test unitaire (dépend du CLI
/// installé sur la machine), jamais bloquante au-delà du timeout, jamais de
/// panic si le binaire est absent.
fn read_cli_version() -> Option<String> {
    let child = Command::new("claude")
        .arg("--version")
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

    match rx.recv_timeout(Duration::from_secs(2)) {
        Ok(Ok(output)) if output.status.success() => String::from_utf8(output.stdout)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        _ => None,
    }
}

/// Point d'entrée du collecteur de configuration. Agrège compte, MCPs,
/// modèle par défaut et version du CLI. Ne panique jamais : chaque source
/// dégradée (fichier absent, JSON invalide, CLI indisponible) est consignée
/// dans `ConfigData::degraded`.
pub fn collect_config(home: &Path) -> ConfigData {
    let mut degraded = Vec::new();
    let (account, mcps) = read_account_config(home, &mut degraded);
    let default_model = read_default_model(home, &mut degraded);
    let cli_version = read_cli_version();

    ConfigData {
        account,
        mcps,
        default_model,
        cli_version,
        degraded,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    #[test]
    fn complete_config_reads_account_fields() {
        let mut degraded = Vec::new();
        let (account, _) = read_account_config(&fixture("complete"), &mut degraded);

        assert_eq!(degraded, Vec::<String>::new());
        assert_eq!(account.display_name, Some("Ada Lovelace".to_string()));
        assert_eq!(account.email_address, Some("ada@example.com".to_string()));
        assert_eq!(account.organization_name, Some("Acme Corp".to_string()));
        assert_eq!(account.organization_type, Some("claude_team".to_string()));
        assert_eq!(
            account.user_rate_limit_tier,
            Some("default_claude_max_5x".to_string())
        );
        assert_eq!(
            account.billing_type,
            Some("stripe_subscription".to_string())
        );
    }

    #[test]
    fn complete_config_reads_mcp_servers_deduplicated_and_scoped() {
        let mut degraded = Vec::new();
        let (_, mcps) = read_account_config(&fixture("complete"), &mut degraded);

        // 4 attendus : figma-console (global, gagne sur le doublon projet),
        // notion (global), remote-api (global, url seule -> http), ovra
        // (projet, ni type ni url -> stdio).
        assert_eq!(mcps.len(), 4);

        let by_name: HashMap<&str, &McpServer> =
            mcps.iter().map(|m| (m.name.as_str(), m)).collect();

        let figma = by_name["figma-console"];
        assert_eq!(figma.scope, McpScope::Global);
        assert_eq!(figma.transport, "stdio");

        let notion = by_name["notion"];
        assert_eq!(notion.scope, McpScope::Global);
        assert_eq!(notion.transport, "sse");

        let remote = by_name["remote-api"];
        assert_eq!(remote.scope, McpScope::Global);
        assert_eq!(remote.transport, "http");

        let ovra = by_name["ovra"];
        assert_eq!(ovra.scope, McpScope::Project);
        assert_eq!(ovra.transport, "stdio");
    }

    #[test]
    fn collect_mcp_specs_extracts_command_args_env_and_dedups() {
        let specs = collect_mcp_specs(&fixture("complete"));

        // Même dédup que read_account_config : figma-console global gagne sur
        // le doublon projet, ordre trié par nom.
        let names: Vec<&str> = specs.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["figma-console", "notion", "ovra", "remote-api"]);

        let by_name: HashMap<&str, &McpSpec> =
            specs.iter().map(|s| (s.name.as_str(), s)).collect();

        // figma-console : stdio avec command + args (scope global, pas le
        // doublon projet en http).
        let figma = by_name["figma-console"];
        assert_eq!(figma.transport, "stdio");
        assert_eq!(figma.command, Some("npx".to_string()));
        assert_eq!(figma.args, vec!["-y", "figma-console-mcp@latest"]);
        assert_eq!(figma.url, None);

        // notion : sse avec url, sans command.
        let notion = by_name["notion"];
        assert_eq!(notion.transport, "sse");
        assert_eq!(notion.command, None);
        assert_eq!(notion.url, Some("https://mcp.notion.com/sse".to_string()));

        // ovra : stdio projet avec command node.
        let ovra = by_name["ovra"];
        assert_eq!(ovra.transport, "stdio");
        assert_eq!(ovra.command, Some("node".to_string()));
    }

    #[test]
    fn collect_mcp_specs_on_absent_config_is_empty() {
        assert!(collect_mcp_specs(&fixture("absent")).is_empty());
    }

    #[test]
    fn complete_config_reads_default_model() {
        let mut degraded = Vec::new();
        let model = read_default_model(&fixture("complete"), &mut degraded);

        assert_eq!(degraded, Vec::<String>::new());
        assert_eq!(model, Some("claude-fable-5[1m]".to_string()));
    }

    #[test]
    fn partial_config_missing_optional_fields_are_none() {
        let mut degraded = Vec::new();
        let (account, mcps) = read_account_config(&fixture("partial"), &mut degraded);

        assert_eq!(degraded, Vec::<String>::new());
        assert_eq!(account.display_name, Some("Grace".to_string()));
        assert_eq!(account.email_address, None);
        assert_eq!(account.organization_name, None);
        assert_eq!(account.organization_type, None);
        assert_eq!(account.user_rate_limit_tier, None);
        assert_eq!(account.billing_type, None);
        assert!(mcps.is_empty());

        let model = read_default_model(&fixture("partial"), &mut degraded);
        assert_eq!(model, None);
        assert_eq!(degraded, Vec::<String>::new());
    }

    #[test]
    fn absent_files_yield_defaults_and_degraded_entries() {
        let mut degraded = Vec::new();
        let (account, mcps) = read_account_config(&fixture("absent"), &mut degraded);

        assert_eq!(account, AccountInfo::default());
        assert!(mcps.is_empty());
        assert!(degraded.contains(&"claude_json_missing".to_string()));

        let model = read_default_model(&fixture("absent"), &mut degraded);
        assert_eq!(model, None);
        assert!(degraded.contains(&"settings_json_missing".to_string()));
    }

    #[test]
    fn invalid_claude_json_yields_degraded_entry_and_defaults() {
        let mut degraded = Vec::new();
        let (account, mcps) = read_account_config(&fixture("invalid_claude_json"), &mut degraded);

        assert_eq!(account, AccountInfo::default());
        assert!(mcps.is_empty());
        assert!(degraded.contains(&"claude_json_invalid".to_string()));
    }

    #[test]
    fn invalid_settings_json_yields_degraded_entry_and_default_model_none() {
        let mut degraded = Vec::new();
        let model = read_default_model(&fixture("invalid_settings_json"), &mut degraded);

        assert_eq!(model, None);
        assert!(degraded.contains(&"settings_json_invalid".to_string()));
    }

    #[test]
    fn collect_config_never_panics_and_aggregates_degraded_sources() {
        // Vérifie l'orchestration globale sans dépendre du CLI `claude`
        // (peut être présent ou absent sur la machine qui exécute les
        // tests) : on n'affirme rien sur `cli_version`, seulement que
        // l'appel ne panique pas et que les autres champs sont cohérents.
        let data = collect_config(&fixture("absent"));

        assert_eq!(data.account, AccountInfo::default());
        assert!(data.mcps.is_empty());
        assert_eq!(data.default_model, None);
        assert!(data.degraded.contains(&"claude_json_missing".to_string()));
        assert!(data
            .degraded
            .contains(&"settings_json_missing".to_string()));
    }

    #[test]
    fn collect_config_on_complete_fixture_matches_direct_reads() {
        let data = collect_config(&fixture("complete"));

        assert_eq!(data.account.display_name, Some("Ada Lovelace".to_string()));
        assert_eq!(data.mcps.len(), 4);
        assert_eq!(data.default_model, Some("claude-fable-5[1m]".to_string()));
        assert_eq!(data.degraded, Vec::<String>::new());
    }
}
