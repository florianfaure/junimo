// `pub` : les commandes Tauri qui s'appuieront sur le collecteur (snapshot,
// task #7) vivront ailleurs dans le crate ; le module doit rester atteignable
// depuis la racine pour ne pas déclencher le lint `dead_code` sur son API
// publique tant qu'aucune commande ne l'appelle encore.
pub mod collector;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
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
