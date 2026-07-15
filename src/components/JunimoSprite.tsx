import { useEffect, useMemo, useState } from "react";
import {
  composeJunimoDataURL,
  JUNIMO_FRAME_COUNT,
  JUNIMO_GRID,
  type JunimoAccessoryId,
  type JunimoColorId,
  type JunimoShapeId,
} from "../junimo/compose";

/** Rythme de l'animation idle (2 frames), repris du sprite PNG précédent (~300ms/frame à 4 frames -> un ordre de grandeur similaire à 2 frames). */
const IDLE_FRAME_MS = 500;

export interface JunimoSpriteSpec {
  shape: JunimoShapeId;
  color: JunimoColorId;
  accessory: JunimoAccessoryId;
}

/**
 * Junimo composé (tâche #33) : remplace le sprite PNG statique (`.junimo-idle`,
 * `assets/sprites/junimo.png`) par un rendu live de `composeJunimo`, avec la
 * même animation idle 2-frames (`JUNIMO_FRAME_COUNT`) que le module de
 * composition. Réutilisé par le header (petit format) et l'éditeur (grand
 * format, `scale` élevé).
 *
 * Les data URLs des 2 frames sont mémoïsées par spec+scale : recomposer un
 * canvas à chaque tick d'animation serait un gâchis, la seule chose qui
 * change au fil du temps est l'`<img>` affichée.
 */
export function JunimoSprite({
  spec,
  scale = 2,
  className,
  label = "Junimo",
}: {
  spec: JunimoSpriteSpec;
  scale?: number;
  className?: string;
  label?: string;
}) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % JUNIMO_FRAME_COUNT);
    }, IDLE_FRAME_MS);
    return () => clearInterval(id);
  }, [spec.shape, spec.color, spec.accessory]);

  const frames = useMemo(
    () =>
      Array.from({ length: JUNIMO_FRAME_COUNT }, (_, i) =>
        composeJunimoDataURL({ ...spec, frame: i }, { scale }),
      ),
    [spec.shape, spec.color, spec.accessory, scale],
  );

  const size = JUNIMO_GRID * scale;

  return (
    <img
      src={frames[frame]}
      alt={label}
      width={size}
      height={size}
      className={className ? `pixelated ${className}` : "pixelated"}
      style={{ width: size, height: size, flexShrink: 0 }}
    />
  );
}
