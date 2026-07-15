//! Icône tray (placeholder pixel-art monochrome) : clic gauche = toggle
//! show/hide de l'overlay, ancré sous l'icône (calcul manuel, tâche #39 —
//! voir `anchor_under_tray`). Le badge d'alerte (tâche #11) teinte la même
//! icône en orange/rouge tant qu'un seuil de jauge est franchi.

use crate::alerts::BadgeLevel;
use std::sync::Mutex;
use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow,
};

const OVERLAY_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "junimo-tray";

/// Dernière position/taille connue de l'icône tray (physique, origine haut-
/// gauche de l'écran), mise à jour à chaque évènement souris dessus. Sert au
/// calcul manuel d'ancrage sous la menu bar (`anchor_under_tray`) : le crate
/// `tauri-plugin-positioner` ne l'expose pas publiquement (son propre état
/// interne, alimenté par `on_tray_event`, est privé), donc on la retrace
/// nous-mêmes depuis les mêmes évènements qu'on lui transmet déjà.
static TRAY_RECT: Mutex<Option<(PhysicalPosition<f64>, PhysicalSize<f64>)>> = Mutex::new(None);

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

            // Tient à jour notre propre trace de la position de l'icône tray
            // (tâche #39, voir `TRAY_RECT`) — indépendante du positioner.
            remember_tray_rect(&event);

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

/// Capture la position/taille de l'icône tray depuis l'évènement souris et la
/// mémorise dans `TRAY_RECT`. Le crate `tray-icon` (sous-jacent à Tauri) émet
/// déjà des coordonnées physiques, origine haut-gauche de l'écran : la fenêtre
/// de l'icône a `position.y` calé sur le HAUT de l'icône (donc de la menu bar)
/// — c'est `position.y + size.height` qui donne le BAS de la menu bar, cf.
/// `anchor_under_tray`.
fn remember_tray_rect(event: &TrayIconEvent) {
    let rect = match event {
        TrayIconEvent::Click { rect, .. }
        | TrayIconEvent::Enter { rect, .. }
        | TrayIconEvent::Leave { rect, .. }
        | TrayIconEvent::Move { rect, .. } => rect,
        _ => return,
    };
    let position: PhysicalPosition<f64> = rect.position.to_physical(1.0);
    let size: PhysicalSize<f64> = rect.size.to_physical(1.0);
    *TRAY_RECT.lock().unwrap() = Some((position, size));
}

/// Bascule la fenêtre overlay : cachée -> visible (ancrée sous le tray) et
/// inversement. `pub(crate)` : réutilisée par le raccourci clavier global
/// (tâche #12, voir `shortcut.rs`) pour appliquer exactement le même
/// positionnement tray-relative que le clic sur l'icône.
///
/// Reste volontairement sur l'API `WebviewWindow` (et non l'API panel de
/// `tauri-nspanel`, tâche #34) : le calcul de position n'opère que sur la
/// fenêtre, et show/hide/set_focus agissent sur le même objet natif une fois
/// swizzlé en NSPanel — ne pas « corriger » vers `get_webview_panel`.
pub(crate) fn toggle_overlay(app: &AppHandle) {
    let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) else {
        return;
    };

    let is_visible = window.is_visible().unwrap_or(false);

    if is_visible {
        let _ = window.hide();
    } else {
        // #37 : en multi-moniteurs à DPI mixtes, un calcul de position
        // tray-relative peut projeter la fenêtre hors de tout écran (observé :
        // y=-4320) ; et une fois hors écran, `current_monitor()` est `None`.
        // Doctrine : secourir AVANT (fenêtre naufragée d'un toggle précédent),
        // ne tenter l'ancrage sous le tray que si le moniteur est résolu, et
        // re-secourir APRÈS si le calcul a renvoyé la fenêtre hors écran.
        rescue_if_offscreen(app, &window);
        if let Ok(Some(monitor)) = window.current_monitor() {
            anchor_under_tray(&window, &monitor);
            rescue_if_offscreen(app, &window);
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Ancre la fenêtre entièrement sous la menu bar, centrée horizontalement sur
/// l'icône tray (tâche #39, comportement menubar-app classique).
///
/// Calcul manuel plutôt que `Position::TrayCenter` /
/// `Position::TrayBottomCenter` du positioner : sur macOS, les deux replient
/// leur `y` sur le HAUT de l'icône tray dès que `tray_y - hauteur_fenêtre`
/// est négatif (systématique ici, l'icône étant collée en haut de l'écran),
/// ce qui fait chevaucher la menu bar par la fenêtre au lieu de la placer
/// dessous. `tray_y + hauteur_icône` donne le BAS de l'icône — qui coïncide
/// avec le bas de la menu bar — d'où le calcul ci-dessous.
fn anchor_under_tray(window: &WebviewWindow, monitor: &Monitor) {
    let Some((tray_pos, tray_size)) = *TRAY_RECT.lock().unwrap() else {
        // Icône jamais survolée/cliquée (ex. tout premier appel via le
        // raccourci clavier global, tâche #12) : pas de rect connu, on ne
        // recalcule rien plutôt que de deviner une position dans le vide —
        // le sauvetage hors-écran (avant/après) reste le filet de sécurité.
        return;
    };
    let Ok(window_size) = window.outer_size() else {
        return;
    };
    let (ww, wh) = (window_size.width as f64, window_size.height as f64);

    let x = tray_pos.x + tray_size.width / 2.0 - ww / 2.0;
    let y = tray_pos.y + tray_size.height; // Bas de l'icône = bas de la menu bar.

    // Contraint dans les bornes du moniteur (même doctrine que
    // `move_window_constrained` du positioner) : une icône tray proche d'un
    // bord ne doit pas faire déborder la fenêtre de l'écran.
    let mpos = monitor.position();
    let msize = monitor.size();
    let min_x = mpos.x as f64;
    let max_x = mpos.x as f64 + msize.width as f64 - ww;
    let x = x.clamp(min_x.min(max_x), max_x.max(min_x));
    let min_y = mpos.y as f64;
    let max_y = mpos.y as f64 + msize.height as f64 - wh;
    let y = y.clamp(min_y.min(max_y), max_y.max(min_y));

    let _ = window.set_position(PhysicalPosition::new(x, y));
}

/// Ramène l'overlay sur un écran réel s'il n'intersecte plus aucun moniteur
/// (`current_monitor()` = `None`) : ancrage en haut à droite du moniteur du
/// curseur — le clic tray ou le raccourci vient d'y avoir lieu — sinon du
/// moniteur principal. No-op si la fenêtre est déjà sur un écran (#37).
fn rescue_if_offscreen(app: &AppHandle, window: &tauri::WebviewWindow) {
    if matches!(window.current_monitor(), Ok(Some(_))) {
        return;
    }
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let mpos = monitor.position();
    let msize = monitor.size();
    // outer_size est en pixels physiques du moniteur d'origine : approximation
    // acceptable pour un sauvetage, le but est de rendre la fenêtre visible.
    let wwidth = window.outer_size().map(|s| s.width as i32).unwrap_or(720);
    let margin = (12.0 * monitor.scale_factor()) as i32;
    let menubar = (40.0 * monitor.scale_factor()) as i32;
    let x = mpos.x + msize.width as i32 - wwidth - margin;
    let y = mpos.y + menubar;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    eprintln!("[junimo] overlay hors écran, ramené en ({x},{y})");
}
