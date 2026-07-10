//! Raccourci clavier global (tâche #12) : bascule l'overlay depuis n'importe
//! quelle application, avec le même positionnement tray-relative que le clic
//! sur l'icône tray (voir `tray::toggle_overlay`).
//!
//! L'accelerator est résolu depuis `junimo-settings.json`
//! (`AppSettings::global_shortcut`) au démarrage de l'app UNIQUEMENT : pas de
//! ré-enregistrement à chaud si le réglage change en cours de session (il
//! faudra relancer l'app, comme documenté sur le champ `global_shortcut`).
//! Le statut d'enregistrement (succès/échec + message) est managé pour que
//! la future section réglages (tâche #13) puisse l'afficher.

use crate::collector::snapshot::AppSettings;
use crate::tray;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Raccourci par défaut si aucun réglage n'est présent (ou réglage vide).
pub const DEFAULT_SHORTCUT: &str = "Alt+Cmd+J";

/// Statut d'enregistrement du raccourci global, exposé au front via la
/// commande `get_shortcut_status` (affiché en tâche #13).
#[derive(Debug, Clone, Serialize)]
pub struct ShortcutStatus {
    pub accelerator: String,
    pub registered: bool,
    pub error: Option<String>,
}

/// État managé (Mutex) contenant le dernier statut connu du raccourci.
#[derive(Default)]
pub struct ManagedShortcutStatus(Mutex<Option<ShortcutStatus>>);

impl ManagedShortcutStatus {
    pub fn snapshot(&self) -> ShortcutStatus {
        self.0
            .lock()
            .ok()
            .and_then(|guard| guard.clone())
            .unwrap_or_else(|| ShortcutStatus {
                accelerator: DEFAULT_SHORTCUT.to_string(),
                registered: false,
                error: Some("raccourci jamais initialisé".to_string()),
            })
    }

    fn set(&self, status: ShortcutStatus) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = Some(status);
        }
    }
}

/// Résout l'accelerator à utiliser depuis les réglages : le réglage
/// `global_shortcut` s'il est présent et non vide, sinon `DEFAULT_SHORTCUT`.
/// Fonction pure, testée directement.
pub fn resolve_accelerator(settings: Option<&AppSettings>) -> String {
    match settings.and_then(|s| s.global_shortcut.as_deref()) {
        Some(s) if !s.trim().is_empty() => s.to_string(),
        _ => DEFAULT_SHORTCUT.to_string(),
    }
}

/// Enregistre le raccourci clavier global résolu depuis les réglages (ou le
/// défaut) et met à jour l'état managé avec le statut obtenu. Ne panique et
/// ne fait jamais crasher l'app : un accelerator invalide ou déjà pris par
/// une autre application se traduit par un `eprintln!` et un statut
/// `registered: false`.
pub fn setup(app: &AppHandle, settings: Option<&AppSettings>) -> ShortcutStatus {
    let accelerator = resolve_accelerator(settings);

    let status = match app
        .global_shortcut()
        .on_shortcut(accelerator.as_str(), |app, _shortcut, event| {
            // Le plugin v2 notifie à la fois l'appui et le relâchement de la
            // touche : ne basculer l'overlay qu'à l'appui, sous peine de
            // toggle deux fois par activation.
            if event.state() == ShortcutState::Pressed {
                tray::toggle_overlay(app);
            }
        }) {
        Ok(()) => ShortcutStatus {
            accelerator: accelerator.clone(),
            registered: true,
            error: None,
        },
        Err(e) => {
            eprintln!(
                "junimo: échec d'enregistrement du raccourci global '{accelerator}' : {e}"
            );
            ShortcutStatus {
                accelerator: accelerator.clone(),
                registered: false,
                error: Some(e.to_string()),
            }
        }
    };

    if let Some(state) = app.try_state::<ManagedShortcutStatus>() {
        state.set(status.clone());
    }

    status
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_accelerator_uses_setting_when_present() {
        let settings = AppSettings {
            global_shortcut: Some("Ctrl+Alt+K".to_string()),
            ..AppSettings::default()
        };

        assert_eq!(resolve_accelerator(Some(&settings)), "Ctrl+Alt+K");
    }

    #[test]
    fn resolve_accelerator_falls_back_to_default_without_settings() {
        assert_eq!(resolve_accelerator(None), DEFAULT_SHORTCUT);
    }

    #[test]
    fn resolve_accelerator_falls_back_to_default_on_empty_string() {
        let settings = AppSettings {
            global_shortcut: Some("   ".to_string()),
            ..AppSettings::default()
        };

        assert_eq!(resolve_accelerator(Some(&settings)), DEFAULT_SHORTCUT);
    }
}
