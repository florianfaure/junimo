//! Icône tray (placeholder pixel-art monochrome) : clic gauche = toggle
//! show/hide de l'overlay, positionné sous l'icône via tauri-plugin-positioner.
//! Le badge d'alerte (tâche #11) teinte la même icône en orange/rouge tant
//! qu'un seuil de jauge est franchi.

use crate::alerts::BadgeLevel;
use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use tauri_plugin_positioner::{Position, WindowExt};

const OVERLAY_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "junimo-tray";

/// PNG de base de l'icône tray, partagé entre la construction initiale et
/// les variantes teintées du badge.
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray-icon.png");

/// Teintes du badge, alignées sur les couleurs des jauges du front
/// (`--gauge-orange` / `--gauge-red` dans styles.css).
const TINT_WARN: (u8, u8, u8) = (232, 163, 61);
const TINT_ALERT: (u8, u8, u8) = (212, 61, 42);

/// Construit et enregistre l'icône tray de l'application.
///
/// Doit être appelé depuis `setup()` : `app` doit être un `&AppHandle` (ou
/// tout type implémentant `Manager`) capable de résoudre la fenêtre overlay.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let icon = Image::from_bytes(TRAY_ICON_BYTES)
        .expect("l'icône tray placeholder embarquée est invalide");

    TrayIconBuilder::with_id(TRAY_ID)
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

/// Applique le niveau d'alerte à l'icône tray : icône template monochrome en
/// temps normal (macOS la recolore), variante teintée orange/rouge tant qu'un
/// seuil est franchi (le mode template est alors coupé pour garder la teinte).
/// Best-effort : si le tray n'est pas résolvable, on ne fait rien.
pub fn set_badge(app: &AppHandle, level: BadgeLevel) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };

    match level {
        BadgeLevel::Normal => {
            if let Ok(icon) = Image::from_bytes(TRAY_ICON_BYTES) {
                let _ = tray.set_icon(Some(icon));
                let _ = tray.set_icon_as_template(true);
            }
        }
        BadgeLevel::Warn => {
            if let Some(icon) = tinted_icon(TINT_WARN) {
                let _ = tray.set_icon_as_template(false);
                let _ = tray.set_icon(Some(icon));
            }
        }
        BadgeLevel::Alert => {
            if let Some(icon) = tinted_icon(TINT_ALERT) {
                let _ = tray.set_icon_as_template(false);
                let _ = tray.set_icon(Some(icon));
            }
        }
    }
}

/// Variante teintée de l'icône tray : la forme (canal alpha) est conservée,
/// les pixels visibles prennent la couleur d'alerte.
fn tinted_icon((r, g, b): (u8, u8, u8)) -> Option<Image<'static>> {
    let base = Image::from_bytes(TRAY_ICON_BYTES).ok()?;
    let (width, height) = (base.width(), base.height());

    let mut rgba = base.rgba().to_vec();
    for pixel in rgba.chunks_exact_mut(4) {
        if pixel[3] > 0 {
            pixel[0] = r;
            pixel[1] = g;
            pixel[2] = b;
        }
    }

    Some(Image::new_owned(rgba, width, height))
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
