//! Notifications de seuil (80 % / 95 %) et badge tray (tâche #11).
//!
//! À chaque refresh du snapshot — commande `get_snapshot` du front OU tick du
//! polling de fond côté Rust (fenêtre cachée) — les trois jauges sont
//! comparées aux seuils. Un franchissement à la hausse déclenche UNE seule
//! notification macOS par (jauge, fenêtre) : l'état notifié est mémorisé par
//! clé `(jauge, reset_at)` — au reset de la fenêtre, `reset_at` change et la
//! clé précédente est purgée, ré-armant les seuils.
//!
//! Le badge tray (icône teintée orange/rouge) est lui **sans mémoire** :
//! recalculé à chaque passage depuis les pourcentages courants, il apparaît
//! dès qu'un seuil est franchi et disparaît de lui-même au reset.

use crate::collector::windows::{Gauge, GaugeSource, Gauges};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::Manager;

pub const THRESHOLD_WARN: f64 = 80.0;
pub const THRESHOLD_ALERT: f64 = 95.0;

const BIT_WARN: u8 = 0b01;
const BIT_ALERT: u8 = 0b10;

/// Niveau visuel du badge tray, dérivé du pire pourcentage courant des
/// trois jauges.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BadgeLevel {
    Normal,
    Warn,
    Alert,
}

/// État partagé des alertes, managé par Tauri (`app.manage(...)`) : accessible
/// à la fois depuis la commande `get_snapshot` et le thread de polling.
#[derive(Default)]
pub struct AlertsState {
    /// `(nom de jauge, reset_at RFC3339)` → seuils déjà notifiés (bitmask
    /// BIT_WARN/BIT_ALERT). Purgé des fenêtres expirées à chaque passage.
    notified: Mutex<HashMap<(String, String), u8>>,
    /// Dernier niveau appliqué à l'icône tray, pour ne pas re-teinter
    /// l'icône à chaque tick.
    badge: Mutex<Option<BadgeLevel>>,
}

/// Bitmask des seuils couverts par `percent` (95 % implique 80 %).
fn mask_for(percent: f64) -> u8 {
    if percent >= THRESHOLD_ALERT {
        BIT_WARN | BIT_ALERT
    } else if percent >= THRESHOLD_WARN {
        BIT_WARN
    } else {
        0
    }
}

/// Décide de la notification à émettre pour une jauge : retourne le seuil à
/// notifier (le plus haut nouvellement franchi, un seul par passage pour ne
/// jamais empiler deux notifications sur un même refresh) et le nouveau
/// bitmask à mémoriser. Fonction pure, testée directement.
fn next_notification(percent: f64, already: u8) -> (Option<f64>, u8) {
    let mask = mask_for(percent);
    let fresh = mask & !already;

    let threshold = if fresh & BIT_ALERT != 0 {
        Some(THRESHOLD_ALERT)
    } else if fresh & BIT_WARN != 0 {
        Some(THRESHOLD_WARN)
    } else {
        None
    };

    (threshold, already | mask)
}

/// Niveau de badge dérivé des pourcentages courants (sans mémoire : le badge
/// disparaît naturellement quand une fenêtre reset). Fonction pure, testée.
pub fn badge_level(gauges: &Gauges) -> BadgeLevel {
    let worst = gauges
        .block_5h
        .percent
        .max(gauges.weekly.percent)
        .max(gauges.weekly_fable.percent);

    if worst >= THRESHOLD_ALERT {
        BadgeLevel::Alert
    } else if worst >= THRESHOLD_WARN {
        BadgeLevel::Warn
    } else {
        BadgeLevel::Normal
    }
}

/// Point d'entrée appelé après chaque assemblage de snapshot : notifications
/// de franchissement + mise à jour du badge tray. Ne panique jamais (les
/// verrous empoisonnés et les échecs de notification sont absorbés).
pub fn process(app: &tauri::AppHandle, gauges: &Gauges) {
    let state = match app.try_state::<AlertsState>() {
        Some(state) => state,
        None => return,
    };

    let entries = [
        ("Bloc 5h", &gauges.block_5h),
        ("7j global", &gauges.weekly),
        ("7j Fable/Opus", &gauges.weekly_fable),
    ];

    if let Ok(mut notified) = state.notified.lock() {
        let mut current_keys: HashSet<(String, String)> = HashSet::new();

        for (label, gauge) in entries {
            // Pas de fenêtre courante (aucun événement) : rien à surveiller.
            let Some(reset_at) = gauge.reset_at else {
                continue;
            };

            let key = (label.to_string(), reset_at.to_rfc3339());
            let already = notified.get(&key).copied().unwrap_or(0);
            let (to_notify, new_mask) = next_notification(gauge.percent, already);

            if new_mask != already {
                notified.insert(key.clone(), new_mask);
            }
            current_keys.insert(key);

            if let Some(threshold) = to_notify {
                send_notification(app, label, gauge, threshold);
            }
        }

        // Fenêtres expirées (reset passé) : on purge, les seuils se ré-arment
        // pour la fenêtre suivante.
        notified.retain(|key, _| current_keys.contains(key));
    }

    let level = badge_level(gauges);
    let should_update = match state.badge.lock() {
        Ok(mut last) => {
            if *last == Some(level) {
                false
            } else {
                *last = Some(level);
                true
            }
        }
        Err(_) => false,
    };

    if should_update {
        crate::tray::set_badge(app, level);
    }
}

/// Dernier niveau de badge appliqué (ou `Normal` si aucun état géré n'est
/// disponible). Consommé par `tray::play_end_of_chat_animation` (tâche #50) :
/// à la fin de l'animation, l'icône de repos doit respecter la teinte
/// warn/alert courante plutôt que de toujours revenir au template neutre.
pub fn current_badge_level(app: &tauri::AppHandle) -> BadgeLevel {
    app.try_state::<AlertsState>()
        .and_then(|state| state.badge.lock().ok().and_then(|guard| *guard))
        .unwrap_or(BadgeLevel::Normal)
}

/// Libellé de la source d'une jauge, inséré dans le corps de la notification
/// pour que l'utilisateur sache si le pourcentage vient du quota officiel du
/// compte ou d'une estimation locale (repli, voir `collector::oauth_usage`).
fn source_label(source: GaugeSource) -> &'static str {
    match source {
        GaugeSource::Official => "quota officiel",
        GaugeSource::Estimated => "estimation locale",
    }
}

/// Émet la notification macOS, best-effort : un échec (permissions,
/// environnement dev non bundlé) est loggé mais jamais bloquant.
fn send_notification(app: &tauri::AppHandle, label: &str, gauge: &Gauge, threshold: f64) {
    use tauri_plugin_notification::NotificationExt;

    let percent = gauge.percent;
    let source = source_label(gauge.source);

    let result = app
        .notification()
        .builder()
        .title(format!("Junimo — {label} à {percent:.0} %"))
        .body(format!(
            "Seuil {threshold:.0} % franchi sur la jauge {label} ({source})."
        ))
        .show();

    if let Err(e) = result {
        eprintln!("junimo: notification de seuil impossible: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gauge(percent: f64) -> Gauge {
        Gauge {
            used_tokens: Some(0),
            cap: Some(100),
            percent,
            reset_at: None,
            source: GaugeSource::Estimated,
            tokens_source: Some(GaugeSource::Estimated),
        }
    }

    fn gauges(p1: f64, p2: f64, p3: f64) -> Gauges {
        Gauges {
            block_5h: gauge(p1),
            weekly: gauge(p2),
            weekly_fable: gauge(p3),
        }
    }

    // --- next_notification : franchissements, une seule notification ---

    #[test]
    fn below_warn_notifies_nothing() {
        assert_eq!(next_notification(79.9, 0), (None, 0));
    }

    #[test]
    fn crossing_warn_notifies_eighty_once() {
        let (threshold, mask) = next_notification(80.0, 0);
        assert_eq!(threshold, Some(THRESHOLD_WARN));

        // Passage suivant, toujours au-dessus de 80 : plus rien à notifier.
        assert_eq!(next_notification(85.0, mask), (None, mask));
    }

    #[test]
    fn crossing_alert_after_warn_notifies_ninety_five() {
        let (_, mask) = next_notification(82.0, 0);
        let (threshold, mask) = next_notification(96.0, mask);

        assert_eq!(threshold, Some(THRESHOLD_ALERT));
        assert_eq!(next_notification(99.0, mask), (None, mask));
    }

    #[test]
    fn jumping_straight_past_both_thresholds_notifies_only_the_highest() {
        let (threshold, mask) = next_notification(97.0, 0);

        assert_eq!(threshold, Some(THRESHOLD_ALERT));
        // Les deux seuils sont marqués couverts : redescendre à 85 puis
        // rester au-dessus de 80 ne renotifie pas.
        assert_eq!(next_notification(85.0, mask), (None, mask));
    }

    #[test]
    fn dropping_below_then_crossing_again_within_same_window_does_not_renotify() {
        // Le bitmask est conservé tant que la fenêtre (reset_at) est la même :
        // une oscillation autour du seuil ne spamme pas.
        let (_, mask) = next_notification(81.0, 0);
        assert_eq!(next_notification(75.0, mask), (None, mask));
        assert_eq!(next_notification(82.0, mask), (None, mask));
    }

    // --- badge_level : dérivé du pire pourcentage, sans mémoire ---

    #[test]
    fn badge_is_normal_below_warn() {
        assert_eq!(badge_level(&gauges(10.0, 50.0, 79.9)), BadgeLevel::Normal);
    }

    #[test]
    fn badge_is_warn_when_any_gauge_crosses_eighty() {
        assert_eq!(badge_level(&gauges(10.0, 80.0, 20.0)), BadgeLevel::Warn);
    }

    #[test]
    fn badge_is_alert_when_any_gauge_crosses_ninety_five() {
        assert_eq!(badge_level(&gauges(96.0, 80.0, 20.0)), BadgeLevel::Alert);
    }

    // --- source_label : libellé de la source insérée dans la notification ---

    #[test]
    fn source_label_official_mentions_official_quota() {
        assert_eq!(source_label(GaugeSource::Official), "quota officiel");
    }

    #[test]
    fn source_label_estimated_mentions_local_estimate() {
        assert_eq!(source_label(GaugeSource::Estimated), "estimation locale");
    }
}
