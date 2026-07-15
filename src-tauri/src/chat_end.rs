//! Détection de « fin de chat » (tâche #50, partie 2), pour déclencher la
//! courte animation de célébration du tray.
//!
//! Claude Code n'expose aucun évènement natif de fin de conversation : ni
//! hook, ni marqueur dans les transcripts JSONL (voir
//! `collector::transcripts`). On l'**approxime** en surveillant, à chaque
//! passage de polling (`get_snapshot` OU le thread de fond, voir `lib.rs`),
//! l'horodatage du plus récent événement d'usage connu
//! (`ProjectStat::last_used`, déjà calculé par
//! `collector::snapshot::project_stats` — aucun nouveau scan de transcripts
//! n'est nécessaire). Une conversation est considérée « terminée » quand ce
//! plus-récent horodatage cesse d'avancer APRÈS avoir déjà avancé pendant la
//! durée de vie du process : le silence qui suit une activité observée.
//!
//! Limite connue : `project_stats` ne remonte que les [`MAX_PROJECT_STATS`]
//! projets les plus actifs sur 7 jours (voir `collector::snapshot`) ; un chat
//! dans un projet hors de ce top N ne sera pas vu. Acceptable pour un usage
//! solo (le projet actif y figure quasi toujours) — à revisiter si le besoin
//! d'exhaustivité se confirme.
//!
//! [`MAX_PROJECT_STATS`]: crate::collector::snapshot::MAX_PROJECT_STATS

use chrono::{DateTime, Utc};
use std::sync::Mutex;

/// État partagé, managé par Tauri (`app.manage(...)`, comme
/// `alerts::AlertsState`) : accessible depuis la commande `get_snapshot` et
/// le thread de polling de fond, qui partagent donc la même détection (pas
/// de double déclenchement).
#[derive(Default)]
pub struct ChatEndState {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    /// Horodatage du plus récent événement d'usage vu au dernier passage.
    last_seen: Option<DateTime<Utc>>,
    /// Vrai dès qu'on a observé au moins une progression (un `last_seen` plus
    /// récent que le précédent) pendant la durée de vie du process — évite de
    /// déclencher l'animation sur un historique déjà ancien au tout premier
    /// passage (démarrage de l'app, aucune activité encore observée ce run).
    advanced_once: bool,
    /// Horodatage pour lequel l'animation a déjà été jouée : empêche de la
    /// rejouer à chaque tick tant que le silence se prolonge sur le même chat.
    fired_for: Option<DateTime<Utc>>,
}

/// Fonction pure (testée) : décide si le silence observé au tick courant doit
/// déclencher l'animation de fin de chat, et met à jour l'état en place.
fn should_fire(latest: Option<DateTime<Utc>>, state: &mut Inner) -> bool {
    let Some(latest) = latest else { return false };

    match state.last_seen {
        None => {
            // Premier tick : on mémorise la référence sans jamais déclencher
            // sur un historique déjà ancien au démarrage de l'app.
            state.last_seen = Some(latest);
            false
        }
        Some(prev) if latest > prev => {
            // Nouvelle activité : la conversation progresse toujours.
            state.last_seen = Some(latest);
            state.advanced_once = true;
            false
        }
        Some(_) => {
            // Silence depuis le dernier tick (même `latest` qu'avant) : ne
            // déclenche que si une vraie progression a déjà été vue cette
            // session, et une seule fois par horodatage final.
            if state.advanced_once && state.fired_for != Some(latest) {
                state.fired_for = Some(latest);
                true
            } else {
                false
            }
        }
    }
}

/// Point d'entrée managé : verrouille l'état et applique [`should_fire`].
/// Ne panique jamais (mutex empoisonné → pas de déclenchement, dégradation
/// silencieuse comme le reste du polling de fond).
pub fn process(state: &ChatEndState, latest: Option<DateTime<Utc>>) -> bool {
    match state.inner.lock() {
        Ok(mut inner) => should_fire(latest, &mut inner),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(s: &str) -> DateTime<Utc> {
        s.parse().unwrap()
    }

    #[test]
    fn first_tick_never_fires_even_with_a_recent_timestamp() {
        let mut state = Inner::default();
        assert!(!should_fire(Some(ts("2026-07-15T10:00:00Z")), &mut state));
    }

    #[test]
    fn repeated_same_timestamp_without_prior_progress_never_fires() {
        // Démarrage de l'app avec un historique déjà figé (aucune conversation
        // en cours) : ne doit jamais déclencher l'animation.
        let mut state = Inner::default();
        let t = Some(ts("2026-07-15T10:00:00Z"));
        assert!(!should_fire(t, &mut state));
        assert!(!should_fire(t, &mut state));
        assert!(!should_fire(t, &mut state));
    }

    #[test]
    fn silence_after_progress_fires_once() {
        let mut state = Inner::default();
        assert!(!should_fire(Some(ts("2026-07-15T10:00:00Z")), &mut state));
        assert!(!should_fire(Some(ts("2026-07-15T10:01:00Z")), &mut state)); // avance
        assert!(should_fire(Some(ts("2026-07-15T10:01:00Z")), &mut state)); // silence -> déclenche
        // Silence prolongé : ne redéclenche pas à chaque tick suivant.
        assert!(!should_fire(Some(ts("2026-07-15T10:01:00Z")), &mut state));
        assert!(!should_fire(Some(ts("2026-07-15T10:01:00Z")), &mut state));
    }

    #[test]
    fn new_activity_after_a_fired_silence_can_fire_again_on_its_own_end() {
        let mut state = Inner::default();
        should_fire(Some(ts("2026-07-15T10:00:00Z")), &mut state);
        should_fire(Some(ts("2026-07-15T10:01:00Z")), &mut state);
        assert!(should_fire(Some(ts("2026-07-15T10:01:00Z")), &mut state)); // fin du 1er chat

        // Un nouveau chat démarre (nouvel horodatage) puis se termine à son tour.
        assert!(!should_fire(Some(ts("2026-07-15T10:05:00Z")), &mut state)); // progresse
        assert!(should_fire(Some(ts("2026-07-15T10:05:00Z")), &mut state)); // fin du 2e chat
    }

    #[test]
    fn no_events_at_all_never_fires() {
        let mut state = Inner::default();
        assert!(!should_fire(None, &mut state));
        assert!(!should_fire(None, &mut state));
    }
}
