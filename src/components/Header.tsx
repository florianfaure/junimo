import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Badge } from "@astryxdesign/core/Badge";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { JunimoSprite } from "./JunimoSprite";
import type { JunimoSettings } from "../types";

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
  onOpenSettings,
  onOpenJunimoEditor,
}: {
  staleError: boolean;
  junimo: JunimoSettings;
  onOpenSettings: () => void;
  onOpenJunimoEditor: () => void;
}) {
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
          <JunimoSprite spec={junimo} scale={2} alt="" />
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
