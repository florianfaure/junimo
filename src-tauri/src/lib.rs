// `pub` : les commandes Tauri qui s'appuieront sur le collecteur (snapshot,
// task #7) vivront ailleurs dans le crate ; le module doit rester atteignable
// depuis la racine pour ne pas déclencher le lint `dead_code` sur son API
// publique tant qu'aucune commande ne l'appelle encore.
pub mod collector;
mod tray;

use collector::snapshot::{self, AppSettings, Snapshot};

/// Commande Tauri principale : assemble le snapshot complet (jauges, MCPs,
/// compte, méta) à partir des vraies données de la machine. `Utc::now()` est
/// lu ICI (jamais dans le collecteur pur, voir `collector::snapshot`), pour
/// que `build_snapshot` reste testable avec une horloge injectée.
///
/// `async` : sur un historique de transcripts réel, l'assemblage peut
/// prendre 0.5-1 s (parsing JSONL + `claude --version`) ; on ne veut jamais
/// bloquer le thread principal de la webview.
#[tauri::command(async)]
fn get_snapshot(app: tauri::AppHandle) -> Snapshot {
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

    let mut result = snapshot::build_snapshot(&home, chrono::Utc::now(), &caps);
    result.meta.degraded.append(&mut settings_degraded);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            get_settings,
            set_settings
        ])
        .setup(|app| {
            // macOS : pas d'icône Dock, l'app ne vit que dans la barre de menu.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            tray::build(app.handle())?;

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
