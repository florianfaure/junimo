// `pub` : les commandes Tauri qui s'appuieront sur le collecteur (snapshot,
// task #7) vivront ailleurs dans le crate ; le module doit rester atteignable
// depuis la racine pour ne pas déclencher le lint `dead_code` sur son API
// publique tant qu'aucune commande ne l'appelle encore.
pub mod collector;
mod alerts;
mod shortcut;
mod tray;

use collector::snapshot::{self, AppSettings, Snapshot};
use shortcut::{ManagedShortcutStatus, ShortcutStatus};

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
fn assemble_snapshot(app: &tauri::AppHandle) -> Snapshot {
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

    let mut result =
        snapshot::build_snapshot(&home, chrono::Utc::now(), &caps, weekly_reference);
    result.meta.degraded.append(&mut settings_degraded);
    result
}

/// Commande Tauri principale : snapshot complet pour le front. Chaque refresh
/// passe aussi par la vérification des seuils d'alerte (notifications + badge
/// tray), en plus du polling de fond.
///
/// `async` : sur un historique de transcripts réel, l'assemblage peut
/// prendre 0.5-1 s (parsing JSONL + `claude --version`) ; on ne veut jamais
/// bloquer le thread principal de la webview.
#[tauri::command(async)]
fn get_snapshot(app: tauri::AppHandle) -> Snapshot {
    let result = assemble_snapshot(&app);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(alerts::AlertsState::default())
        .manage(ManagedShortcutStatus::default())
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            get_settings,
            set_settings,
            get_shortcut_status
        ])
        .setup(|app| {
            // macOS : pas d'icône Dock, l'app ne vit que dans la barre de menu.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            tray::build(app.handle())?;

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
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(BACKGROUND_POLL_SECS));
                let snapshot = assemble_snapshot(&handle);
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
