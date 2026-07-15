import { useEffect, useRef, useState } from "react";
import type { JunimoMood } from "../junimo/compose";
import type { Snapshot } from "../types";

/**
 * Dérive l'état d'animation du junimo (#49) à partir du snapshot et de
 * l'horloge, SANS toucher à `useOverlayData`/`App` (isolation tâche #42) : le
 * hook prend `(snapshot, nowIso)` en paramètres et rend un `JunimoMood`. Le
 * header le branche et passe le mood à `JunimoSprite`.
 *
 * Les seuils s'appuient sur ce que le snapshot expose réellement :
 *  - activité récente = `max(projects[].last_used)` (dernier usage d'un projet) ;
 *  - consommation = `account.today_tokens` (compteur monotone du jour), dont on
 *    suit le delta entre deux snapshots pour détecter une consommation fraîche.
 *
 * Machine à états (priorité décroissante), réévaluée à chaque tick de `nowIso` :
 *  - `eat` : les tokens viennent d'augmenter (fenêtre courte) ET une conversation
 *    est active ;
 *  - `run` : activité < 2 min (une conversation est en cours) ;
 *  - `celebrate` : on vient de passer d'« actif » à « silencieux » (~8 s) ;
 *  - `bored` : plus rien depuis > 15 min ;
 *  - `play` : variation occasionnelle d'idle (~1 fois / 2 min, fenêtre de ~4 s,
 *    seedée sur l'horloge — pas de `Math.random` en boucle de rendu) ;
 *  - `idle` : défaut.
 *
 * Mode démo : `?anim=run|eat|play|celebrate|bored|idle` force le mood (même
 * mécanique que `?page=` dans `App.tsx`), pour la validation visuelle de chaque
 * état sans dépendre de l'activité réelle.
 */

/** Activité < 2 min → une conversation est active (run). */
const RUN_WINDOW_MS = 2 * 60_000;
/** Durée pendant laquelle une hausse de tokens déclenche l'état eat. */
const EAT_WINDOW_MS = 6_000;
/** Durée de la célébration après la fin d'une conversation. */
const CELEBRATE_WINDOW_MS = 8_000;
/** Inactivité > 15 min → ennui. */
const BORED_WINDOW_MS = 15 * 60_000;
/** Période du tirage « play » et durée d'une session de jeu. */
const PLAY_PERIOD_MS = 2 * 60_000;
const PLAY_WINDOW_MS = 4_000;

const MOODS: readonly JunimoMood[] = [
  "idle",
  "run",
  "eat",
  "play",
  "celebrate",
  "bored",
];

function isMood(v: string | null): v is JunimoMood {
  return v != null && (MOODS as readonly string[]).includes(v);
}

/** Lit `?anim=` une seule fois (deep-link de démo, cf. `App.tsx::initialPage`). */
function animOverride(): JunimoMood | null {
  if (typeof location === "undefined") return null;
  const a = new URLSearchParams(location.search).get("anim");
  return isMood(a) ? a : null;
}

/** Instant epoch (ms) du dernier usage d'un projet, ou null si aucun. */
function latestActivityMs(snapshot: Snapshot | null): number | null {
  if (!snapshot) return null;
  let latest: number | null = null;
  for (const p of snapshot.projects) {
    if (!p.last_used) continue;
    const t = Date.parse(p.last_used);
    if (Number.isNaN(t)) continue;
    if (latest == null || t > latest) latest = t;
  }
  return latest;
}

/** Compteur de tokens consommés du jour (monotone), 0 par défaut. */
function todayTokens(snapshot: Snapshot | null): number {
  return snapshot?.account?.today_tokens ?? 0;
}

/** Hash entier déterministe (pour seeder le tirage « play » sur l'horloge). */
function hashInt(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Vrai si `now` tombe dans la fenêtre de jeu de sa période courante. L'instant
 * de jeu est tiré une fois par période via un hash du numéro de période :
 * déterministe et stable (pas de `Math.random` réévalué à chaque rendu).
 */
function isPlayTick(now: number): boolean {
  const bucket = Math.floor(now / PLAY_PERIOD_MS);
  const offset = hashInt(bucket) % PLAY_PERIOD_MS;
  const dt = now - (bucket * PLAY_PERIOD_MS + offset);
  return dt >= 0 && dt < PLAY_WINDOW_MS;
}

interface MoodTracker {
  /** dernière valeur connue de today_tokens (détection de delta) */
  prevTokens: number | null;
  /** fin de la fenêtre eat (epoch ms) */
  eatUntil: number;
  /** fin de la fenêtre celebrate (epoch ms) */
  celebrateUntil: number;
  /** une conversation était-elle active au tick précédent */
  wasActive: boolean;
}

export function useJunimoMood(
  snapshot: Snapshot | null,
  nowIso: string,
): JunimoMood {
  // L'override de démo est lu une seule fois (comme `initialPage`).
  const [override] = useState<JunimoMood | null>(animOverride);
  const [mood, setMood] = useState<JunimoMood>(override ?? "idle");
  const trackerRef = useRef<MoodTracker>({
    prevTokens: null,
    eatUntil: 0,
    celebrateUntil: 0,
    wasActive: false,
  });

  // La dérivation vit dans un effet (pas d'effet de bord en rendu) : elle se
  // rejoue à chaque changement de `nowIso` (tick ~1 s de `useOverlayData`) ou de
  // snapshot, et met à jour l'état de mood.
  useEffect(() => {
    if (override) {
      setMood(override);
      return;
    }
    const now = Date.parse(nowIso) || Date.now();
    const t = trackerRef.current;

    const lastActivity = latestActivityMs(snapshot);
    const activityAge = lastActivity == null ? Infinity : now - lastActivity;
    const active = activityAge < RUN_WINDOW_MS;

    // delta de tokens → fenêtre eat
    const tokens = todayTokens(snapshot);
    if (t.prevTokens != null && tokens > t.prevTokens) {
      t.eatUntil = now + EAT_WINDOW_MS;
    }
    t.prevTokens = tokens;

    // passage actif → silencieux → fenêtre celebrate
    if (t.wasActive && !active) {
      t.celebrateUntil = now + CELEBRATE_WINDOW_MS;
    }
    t.wasActive = active;

    let next: JunimoMood;
    if (now < t.eatUntil && active) next = "eat";
    else if (active) next = "run";
    else if (now < t.celebrateUntil) next = "celebrate";
    else if (activityAge > BORED_WINDOW_MS) next = "bored";
    else if (isPlayTick(now)) next = "play";
    else next = "idle";

    setMood(next);
  }, [snapshot, nowIso, override]);

  return override ?? mood;
}
