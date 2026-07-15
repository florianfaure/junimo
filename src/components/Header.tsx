import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Badge } from "@astryxdesign/core/Badge";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { JunimoSprite } from "./JunimoSprite";
import { useJunimoMood } from "../hooks/useJunimoMood";
import type { JunimoSettings, Snapshot } from "../types";

/**
 * En-tête de l'overlay : le junimo composé par l'utilisateur (seul élément
 * pixel-art de l'UI, cliquable vers son éditeur) + son nom personnalisé, puis à
 * droite le badge « obsolète » (dernier refresh en échec, snapshot précédent
 * encore affiché) et l'icône réglages.
 *
 * Casse du titre : on affiche le nom TEL QUE saisi par l'utilisateur (aucune
 * transformation) — décision de la refonte #26, le défaut restant « Junimo ».
 *
 * Le sous-titre « tableau de bord Claude Code » a été supprimé (#26).
 *
 * Pas d'icône « engrenage »/« cog » dans le registre sémantique Astryx :
 * `wrench` est l'équivalent « réglages/outils » le plus proche.
 */
export function Header({
  staleError,
  junimo,
  snapshot,
  nowIso,
  onOpenSettings,
  onOpenJunimoEditor,
}: {
  staleError: boolean;
  junimo: JunimoSettings;
  /**
   * Snapshot courant + horloge, source des déclencheurs d'animation (#49). Ils
   * alimentent `useJunimoMood`. Optionnels : sans eux (ou avec `?anim=`), le
   * junimo reste en `idle` / suit l'override de démo — le header build et
   * fonctionne dans les deux cas, ce qui évite de dépendre du refactor #42 de
   * `App.tsx`/`useOverlayData` pour compiler.
   */
  snapshot?: Snapshot | null;
  nowIso?: string;
  onOpenSettings: () => void;
  onOpenJunimoEditor: () => void;
}) {
  // Mood animé dérivé du snapshot (ou forcé par `?anim=`). `nowIso` cadence la
  // réévaluation ; à défaut on retombe sur l'instant courant (mood idle).
  const mood = useJunimoMood(snapshot ?? null, nowIso ?? new Date().toISOString());
  return (
    <HStack gap={2} align="center">
      <button
        type="button"
        className="junimo-trigger"
        onClick={onOpenJunimoEditor}
        aria-label="Personnaliser le junimo"
      >
        <div className="junimo-trigger-wrapper">
          {/* Sprite décoratif : le bouton porte déjà l'aria-label (alt="" évite
              la redondance pour les lecteurs d'écran). */}
          <JunimoSprite spec={junimo} mood={mood} scale={2} alt="" />
          {/* Overlay affordance : mini bouton crayon au hover du junimo. */}
          <div className="junimo-edit-overlay" aria-hidden="true">
            <svg
              viewBox="0 0 16 16"
              xmlns="http://www.w3.org/2000/svg"
              className="junimo-edit-pencil"
            >
              <path
                d="M12.5 2.5l1.5 1.5L5 13l-2.5.5L3 11z"
                fill="none"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </button>
      <Heading level={1}>{junimo.name}</Heading>
      <HStack gap={1} align="center" style={{ marginInlineStart: "auto" }}>
        {staleError ? <Badge variant="warning" label="obsolète" /> : null}
        <IconButton
          label="Réglages"
          icon={<Icon icon="wrench" />}
          variant="ghost"
          onClick={onOpenSettings}
        />
      </HStack>
    </HStack>
  );
}
