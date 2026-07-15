//! Overlay au-dessus des apps en plein écran (tâche #34, macOS uniquement).
//!
//! Par défaut une NSWindow Tauri, même `alwaysOnTop`, ne s'affiche PAS de façon
//! fiable au-dessus du Space dédié d'une autre app en plein écran : dès qu'elle
//! devient *key* l'app s'active et macOS bascule hors du plein écran. La recette
//! éprouvée (type Raycast/Alfred) combine quatre ingrédients, TOUS nécessaires :
//!
//!  1. app en politique d'activation **Accessory** (déjà fait dans `lib.rs`, pas
//!     d'icône Dock) ;
//!  2. la fenêtre overlay devient un **NSPanel non-activant** — le masque
//!     `NSWindowStyleMaskNonactivatingPanel` fait que montrer l'overlay
//!     n'active pas l'app, donc pas de bascule de Space. Ce masque n'ayant
//!     d'effet que sur un NSPanel (pas sur une NSWindow), on s'appuie sur le
//!     swizzle de classe rodé de `tauri-nspanel` (`window.to_panel`) ;
//!  3. `collectionBehavior = canJoinAllSpaces | fullScreenAuxiliary`
//!     (+ `stationary | ignoresCycle`) pour flotter sur le Space courant, y
//!     compris celui d'une app plein écran, sans y être « déplacé » ;
//!  4. un **niveau** élevé (`NSPopUpMenuWindowLevel`, comme un menu système)
//!     pour passer au-dessus du contenu plein écran et de la barre de menus.
//!
//! Le panneau garde `can_become_key_window: true` : c'est indispensable pour que
//! l'overlay reçoive le focus clavier à l'ouverture (via `window.set_focus()`
//! dans `tray::toggle_overlay`) SANS activer l'app, et donc pour que sa perte de
//! focus déclenche le blur-close (voir plus bas).
//!
//! ## Blur-close préservé (double filet de sécurité)
//!
//! Le blur-close historique repose sur `WindowEvent::Focused(false)`
//! (voir `lib.rs::on_window_event`). On le CONSERVE : comme on ne remplace pas
//! le delegate NSWindow installé par tao (on n'appelle jamais
//! `panel.set_event_handler`), tao continue d'émettre `Focused(false)` quand le
//! panneau — devenu key à l'ouverture — perd le focus.
//!
//! Mais cet évènement est réputé peu fiable sur un panneau non-activant (il ne
//! tire pas si le panneau n'est jamais devenu key, et Tauri a un historique de
//! bugs de focus macOS). On ajoute donc un **observateur de clic global**
//! (`NSEvent addGlobalMonitorForEventsMatchingMask`) qui masque l'overlay à tout
//! clic HORS de nos propres fenêtres — un moniteur global ne voit jamais les
//! clics dans nos fenêtres, ce qui correspond exactement au dismiss « clic
//! ailleurs ». Les deux mécanismes appellent `window.hide()`, opération
//! idempotente : les cumuler est sans risque.

use tauri::{AppHandle, Manager};
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt,
};

/// Doit correspondre au `label` de la fenêtre overlay dans `tauri.conf.json`
/// et à `tray::OVERLAY_WINDOW_LABEL`.
const OVERLAY_WINDOW_LABEL: &str = "main";

// Sous-classe NSPanel générée par `tauri-nspanel`. `can_become_key_window`
// force `-canBecomeKeyWindow` à YES (une NSWindow sans bordure répondrait NON,
// empêchant le focus donc le blur-close) ; `is_floating_panel` évite que le
// panneau se cache automatiquement quand l'app n'est pas active.
tauri_panel!(JunimoOverlayPanel {
    config: {
        can_become_key_window: true,
        is_floating_panel: true
    }
});

/// Convertit la fenêtre overlay en NSPanel non-activant et installe le repli de
/// blur-close. À appeler depuis `setup()` (thread principal). Best-effort : tout
/// échec est loggé mais ne fait jamais crasher l'app — l'overlay retomberait
/// simplement sur son comportement NSWindow d'origine.
pub fn setup(app: &AppHandle) {
    // Garde de ré-entrance : `to_panel` swizzle la classe de la NSWindow en
    // capturant sa classe D'ORIGINE pour un éventuel `to_window()` inverse. Un
    // second appel sur une fenêtre déjà panelifiée capturerait la classe panel
    // comme "originale" et casserait cette restauration. Si le manager du
    // plugin connaît déjà le label, la conversion a déjà eu lieu : no-op.
    if app.get_webview_panel(OVERLAY_WINDOW_LABEL).is_ok() {
        return;
    }

    let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) else {
        eprintln!("junimo: fenêtre overlay introuvable, conversion NSPanel ignorée");
        return;
    };

    let panel = match window.to_panel::<JunimoOverlayPanel>() {
        Ok(panel) => panel,
        Err(e) => {
            eprintln!("junimo: conversion NSPanel impossible: {e}");
            return;
        }
    };

    // Niveau menu déroulant (101) : au-dessus du contenu plein écran et de la
    // barre de menus, à l'image des menus système.
    panel.set_level(PanelLevel::PopUpMenu.value());

    // Non-activant : montrer l'overlay n'active pas l'app -> pas de bascule hors
    // du Space plein écran.
    panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());

    // Flotte sur le Space courant (y compris celui d'une app plein écran) sans
    // y être déplacé ni participer au cycle Cmd+Tab / Exposé.
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .can_join_all_spaces()
            .full_screen_auxiliary()
            .stationary()
            .ignores_cycle()
            .into(),
    );

    install_outside_click_monitor(app);
}

/// Repli robuste du blur-close : masque l'overlay à tout clic (gauche/droit)
/// survenu HORS de nos fenêtres. Indépendant des évènements de focus Tauri, il
/// fonctionne même si le panneau n'est jamais devenu key.
fn install_outside_click_monitor(app: &AppHandle) {
    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask};
    use std::ptr::NonNull;

    let handle = app.clone();
    let block = RcBlock::new(move |_event: NonNull<NSEvent>| {
        if let Some(window) = handle.get_webview_window(OVERLAY_WINDOW_LABEL) {
            if window.is_visible().unwrap_or(false) {
                let _ = window.hide();
            }
        }
    });

    let mask = NSEventMask::LeftMouseDown | NSEventMask::RightMouseDown;
    let token = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &block);

    // Le token retourné possède le moniteur : s'il est droppé, macOS retire
    // l'observateur. On veut qu'il vive toute la durée du process (l'app tourne
    // jusqu'à sa fermeture), d'où le `forget` volontaire.
    std::mem::forget(token);
}
