import { useEffect, useMemo, useState } from "react";
import {
  composeJunimoDataURL,
  JUNIMO_GRID,
  moodFrameCount,
  type JunimoAccessoryId,
  type JunimoColorId,
  type JunimoMood,
  type JunimoShapeId,
} from "../junimo/compose";

/**
 * Cadence d'animation par mood (#49), en ms/frame. `idle` reprend le rythme
 * lent du rebond existant (~500 ms) ; `run` est rapide (foulée), les autres
 * moods jouent à un tempo intermédiaire, lisible sans être agité. `bored` est
 * volontairement lent (bâillement, regards paresseux).
 */
const MOOD_FRAME_MS: Record<JunimoMood, number> = {
  idle: 500,
  run: 130,
  eat: 260,
  play: 220,
  celebrate: 200,
  bored: 620,
};

export interface JunimoSpriteSpec {
  shape: JunimoShapeId;
  color: JunimoColorId;
  accessory: JunimoAccessoryId;
}

/**
 * Junimo composé (tâche #33) : remplace le sprite PNG statique (`.junimo-idle`,
 * `assets/sprites/junimo.png`) par un rendu live de `composeJunimo`, avec une
 * animation par frames programmatiques (`moodFrameCount`) issue du module de
 * composition. Réutilisé par le header (petit format, mood piloté par le
 * snapshot via `useJunimoMood`) et l'éditeur (grand format, `scale` élevé,
 * mood `idle` par défaut).
 *
 * Les data URLs des frames sont mémoïsées par spec+mood+scale : recomposer un
 * canvas à chaque tick d'animation serait un gâchis, la seule chose qui change
 * au fil du temps est l'`<img>` affichée.
 */
export function JunimoSprite({
  spec,
  mood = "idle",
  scale = 2,
  className,
  label = "Junimo",
  alt,
}: {
  spec: JunimoSpriteSpec;
  /** État d'animation (#49). Défaut `idle` (rebond de repos). */
  mood?: JunimoMood;
  scale?: number;
  className?: string;
  label?: string;
  /**
   * Texte alternatif de l'`<img>`. Par défaut `label`. Passer `alt=""` quand
   * le sprite est décoratif (ex. dans le bouton du header, qui porte déjà son
   * propre aria-label) — évite l'annonce redondante par les lecteurs d'écran.
   */
  alt?: string;
}) {
  const [frame, setFrame] = useState(0);
  const count = moodFrameCount(mood);

  // Réinitialise et cadence l'animation à chaque changement de spec ou de mood
  // (chaque mood a son propre nombre de frames et son tempo).
  useEffect(() => {
    setFrame(0);
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % count);
    }, MOOD_FRAME_MS[mood]);
    return () => clearInterval(id);
  }, [spec.shape, spec.color, spec.accessory, mood, count]);

  const frames = useMemo(
    () =>
      Array.from({ length: count }, (_, i) =>
        composeJunimoDataURL({ ...spec, mood, frame: i }, { scale }),
      ),
    [spec.shape, spec.color, spec.accessory, mood, count, scale],
  );

  const size = JUNIMO_GRID * scale;

  return (
    <img
      src={frames[frame % count]}
      alt={alt ?? label}
      width={size}
      height={size}
      className={className ? `pixelated ${className}` : "pixelated"}
      style={{ width: size, height: size, flexShrink: 0 }}
    />
  );
}
