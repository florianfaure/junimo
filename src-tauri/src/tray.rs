//! Icône tray (placeholder pixel-art monochrome) : clic gauche = toggle
//! show/hide de l'overlay, positionné sous l'icône via tauri-plugin-positioner.

use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use tauri_plugin_positioner::{Position, WindowExt};

const OVERLAY_WINDOW_LABEL: &str = "main";

/// Construit et enregistre l'icône tray de l'application.
///
/// Doit être appelé depuis `setup()` : `app` doit être un `&AppHandle` (ou
/// tout type implémentant `Manager`) capable de résoudre la fenêtre overlay.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
        .expect("l'icône tray placeholder embarquée est invalide");

    TrayIconBuilder::with_id("junimo-tray")
        .icon(icon)
        // Image "template" : macOS la recolore automatiquement en clair/sombre.
        .icon_as_template(true)
        .tooltip("Junimo")
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();

            // Tient à jour la position connue de l'icône tray pour le positioner.
            tauri_plugin_positioner::on_tray_event(app, &event);

            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_overlay(app);
            }
        })
        .build(app)?;

    Ok(())
}

/// Bascule la fenêtre overlay : cachée -> visible (ancrée sous le tray) et
/// inversement.
fn toggle_overlay(app: &AppHandle) {
    let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) else {
        return;
    };

    let is_visible = window.is_visible().unwrap_or(false);

    if is_visible {
        let _ = window.hide();
    } else {
        let _ = window.move_window_constrained(Position::TrayCenter);
        let _ = window.show();
        let _ = window.set_focus();
    }
}
