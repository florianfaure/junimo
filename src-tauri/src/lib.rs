// `pub` : les commandes Tauri qui s'appuieront sur le collecteur (snapshot,
// task #7) vivront ailleurs dans le crate ; le module doit rester atteignable
// depuis la racine pour ne pas déclencher le lint `dead_code` sur son API
// publique tant qu'aucune commande ne l'appelle encore.
pub mod collector;
mod alerts;
mod mcp_health;
// Conversion de l'overlay en NSPanel non-activant (tâche #34) : macOS seulement.
#[cfg(target_os = "macos")]
mod panel;
mod shortcut;
mod tray;

use collector::oauth_usage::{self, OfficialUsageState};
use collector::snapshot::{self, AppSettings, Snapshot};
use shortcut::{ManagedShortcutStatus, ShortcutStatus};
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;

/// Intervalle du polling de fond côté Rust : les seuils d'alerte (tâche #11)
/// doivent être surveillés même fenêtre cachée, quand le front ne rafraîchit
/// plus. 60 s : deux fois plus lâche que le refresh front (30 s), suffisant
/// pour un franchissement de seuil.
const BACKGROUND_POLL_SECS: u64 = 60;

/// Assemble le snapshot complet (jauges, MCPs, compte, méta) à partir des
/// vraies données de la machine. `Utc::now()` est lu ICI (jamais dans le
/// collecteur pur, voir `collector::snapshot`), pour que `build_snapshot`
/// reste testable avec une horloge injectée. Partagé entre la commande
/// `get_snapshot` et le polling de fond des alertes.
///
/// `official_max_age` borne la fraîcheur acceptée du cache des jauges
/// officielles (`collector::oauth_usage::resolve`) : au-delà, un fetch réseau
/// est tenté. Chaque site d'appel choisit sa propre valeur (voir `get_snapshot`
/// et le thread de fond) pour découpler la cadence de rafraîchissement visible
/// de la cadence réelle d'appel à l'API `/usage`.
fn assemble_snapshot(app: &tauri::AppHandle, official_max_age: chrono::Duration) -> Snapshot {
    let home = snapshot::resolve_home();

    // Lecture de la config une première fois pour connaître le tier et en
    // déduire les plafonds par défaut avant l'assemblage complet. Coût
    // accepté : `build_snapshot` relit la config (voir sa signature dans le
    // brief de la tâche #7, `caps` est un paramètre pur) ; le fichier
    // `.claude.json` est petit, seul `claude --version` est un peu coûteux
    // et s'exécute donc deux fois. Piste d'optimisation pour une tâche
    // ultérieure si le budget de 500 ms s'avère trop juste en pratique.
    let config_data = collector::config::collect_config(&home);
    let (settings, mut settings_degraded) = snapshot::load_settings(&app);
    let caps = snapshot::resolve_caps(
        config_data.account.user_rate_limit_tier.as_deref(),
        settings.as_ref(),
    );

    // Référence de reset hebdo calibrée par l'utilisateur (recopiée depuis
    // /usage) ; illisible → signalée en degraded, build_snapshot estimera.
    let weekly_reference = settings.as_ref().and_then(|s| {
        let raw = s.weekly_reset_reference.as_deref()?;
        match chrono::DateTime::parse_from_rfc3339(raw) {
            Ok(d) => Some(d.with_timezone(&chrono::Utc)),
            Err(_) => {
                settings_degraded.push("weekly_reset_reference_invalid".to_string());
                None
            }
        }
    });

    let now = chrono::Utc::now();
    let mut result = snapshot::build_snapshot(&home, now, &caps, weekly_reference);
    result.meta.degraded.append(&mut settings_degraded);

    // Dette #14 : les formats de Claude Code ne sont pas documentés — une
    // montée de version du CLI est le signal de re-vérifier les schémas
    // (voir docs/reference/claude-code-file-formats.md).
    if let Some(entry) = snapshot::track_cli_version(app, &result.account.cli_version) {
        result.meta.degraded.push(entry);
    }

    // Jauges officielles (tâche #23) : tentative de remplacement des jauges
    // estimées localement par les vraies données du compte (`GET /usage`).
    // `official_max_age` gouverne la fraîcheur du cache, indépendamment de la
    // cadence à laquelle `assemble_snapshot` est lui-même appelé. Échec (pas
    // de credentials, réseau down, cache trop vieux) : entrée `degraded`
    // purement informative — elle ne matche pas la clé `"gauges"` utilisée par
    // le front (`src/ui/render.ts`) pour assombrir la section, donc les
    // jauges estimées restent affichées normalement en repli.
    match app.try_state::<OfficialUsageState>() {
        Some(state) => match oauth_usage::resolve(&state, &home, now, official_max_age) {
            Some(usage) => oauth_usage::apply_official(&mut result, &usage),
            None => result
                .meta
                .degraded
                .push("official_usage_unavailable".to_string()),
        },
        None => result
            .meta
            .degraded
            .push("official_usage_unavailable".to_string()),
    }

    result
}

/// Commande Tauri principale : snapshot complet pour le front. Chaque refresh
/// passe aussi par la vérification des seuils d'alerte (notifications + badge
/// tray), en plus du polling de fond.
///
/// `async` : sur un historique de transcripts réel, l'assemblage peut
/// prendre 0.5-1 s (parsing JSONL + `claude --version`) ; on ne veut jamais
/// bloquer le thread principal de la webview.
///
/// `official_max_age` de 55 s : le front poll toutes les 60 s (voir
/// `src/main.ts`) ; 55 s < 60 s absorbe la gigue du timer JS tout en
/// garantissant qu'un fetch réel de `/usage` a lieu à (quasiment) chaque
/// poll, plutôt que de servir un cache vieux d'un cycle entier.
#[tauri::command(async)]
fn get_snapshot(app: tauri::AppHandle) -> Snapshot {
    let result = assemble_snapshot(&app, chrono::Duration::seconds(55));
    alerts::process(&app, &result.gauges);
    result
}

/// Réglages actuels de l'app (plafonds personnalisés), lus depuis
/// `junimo-settings.json`. Défauts vides si le fichier est absent ou
/// invalide (pas d'erreur exposée au front : `get_snapshot` porte déjà
/// `settings_invalid` dans `meta.degraded` le cas échéant).
#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> AppSettings {
    snapshot::load_settings(&app).0.unwrap_or_default()
}

/// Écrit les réglages fournis par le front dans `junimo-settings.json`.
#[tauri::command]
fn set_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    snapshot::write_settings(&app, &settings)
}

/// Statut du raccourci clavier global (tâche #12) : accelerator résolu,
/// succès/échec d'enregistrement et message d'erreur éventuel. Consommé par
/// la future section réglages (tâche #13) pour signaler un raccourci pris.
#[tauri::command]
fn get_shortcut_status(state: tauri::State<ManagedShortcutStatus>) -> ShortcutStatus {
    state.snapshot()
}

/// Etat courant du lancement au démarrage (login item macOS, tâche #13).
/// `unwrap_or(false)` défensif : une erreur de lecture du launch agent ne
/// doit jamais faire planter le footer réglages, juste afficher "désactivé".
#[tauri::command]
fn get_autostart(app: tauri::AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Active/désactive le lancement au démarrage. Erreur mappée en `String`
/// (contrat `Result` uniforme avec `set_settings`) plutôt que de paniquer.
#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|e| e.to_string())
    } else {
        autolaunch.disable().map_err(|e| e.to_string())
    }
}

/// Health-check opt-in des serveurs MCP configurés (tâche #17) : tente un
/// handshake `initialize` stdio (spawn + timeout, process tué) ou un ping
/// http/sse pour chaque serveur, et renvoie un état ok/warn/down par serveur.
///
/// Coûteux (spawn de process) : déclenché uniquement par le bouton « tester »
/// du front, jamais en automatique. `async` : plusieurs spawns + I/O réseau,
/// on ne bloque pas le thread de la webview.
#[tauri::command(async)]
fn check_mcps() -> Vec<mcp_health::McpHealth> {
    let home = snapshot::resolve_home();
    let specs = collector::config::collect_mcp_specs(&home);
    mcp_health::check_all(specs)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(alerts::AlertsState::default())
        .manage(OfficialUsageState::default())
        .manage(ManagedShortcutStatus::default())
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            get_settings,
            set_settings,
            get_shortcut_status,
            get_autostart,
            set_autostart,
            check_mcps
        ])
        .setup(|app| {
            // macOS : pas d'icône Dock, l'app ne vit que dans la barre de menu.
            // Politique "Accessory" indispensable au comportement NSPanel
            // non-activant au-dessus du plein écran (voir `panel::setup`).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            tray::build(app.handle())?;

            // Ouverture de l'overlay au-dessus des apps plein écran (tâche #34).
            // Le plugin nspanel est enregistré ici (à l'exécution) plutôt que
            // dans la chaîne `Builder` pour garder celle-ci compilable hors
            // macOS ; il installe l'état managé (`WebviewPanelManager`) dont
            // dépend `window.to_panel` appelé juste après.
            #[cfg(target_os = "macos")]
            {
                app.handle().plugin(tauri_nspanel::init())?;
                panel::setup(app.handle());
            }

            // Raccourci clavier global (tâche #12) : réglage rechargé au
            // démarrage uniquement, défaut Alt+Cmd+J. Échec d'enregistrement
            // (accelerator invalide ou déjà pris) : loggé + exposé via
            // `get_shortcut_status`, jamais de crash (voir shortcut::setup).
            let (settings, _) = snapshot::load_settings(app.handle());
            shortcut::setup(app.handle(), settings.as_ref());

            // Polling de fond (tâche #11) : le front coupe son propre polling
            // quand la fenêtre overlay est masquée (cas le plus courant, l'app
            // vit dans la barre de menu), mais les seuils d'alerte doivent
            // continuer à être surveillés même sans que l'utilisateur ouvre la
            // fenêtre. On boucle donc indéfiniment sur un thread dédié, avec un
            // clone du handle (Send + 'static) pour ré-assembler un snapshot et
            // repasser par `alerts::process` toutes les `BACKGROUND_POLL_SECS`.
            // Découplage tick/fetch (tâche #23) : le tick de fond reste à
            // `BACKGROUND_POLL_SECS` (60 s, il pilote la détection des seuils
            // d'alerte), mais on ne veut PAS interroger `/usage` toutes les
            // 60 s alors que personne ne regarde l'overlay — un
            // `official_max_age` de 300 s (5 min) fait que le cache des
            // jauges officielles n'est réellement rafraîchi par le réseau
            // qu'une fois toutes les 5 itérations de la boucle, même si
            // `assemble_snapshot` (et donc `alerts::process`) tourne bien
            // toutes les 60 s sur les jauges (éventuellement en cache).
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(BACKGROUND_POLL_SECS));
                let snapshot = assemble_snapshot(&handle, chrono::Duration::seconds(300));
                alerts::process(&handle, &snapshot.gauges);
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Clic ailleurs (perte de focus) -> on cache l'overlay.
            if let tauri::WindowEvent::Focused(false) = event {
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
