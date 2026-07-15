import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Badge } from "@astryxdesign/core/Badge";
import { IconButton } from "@astryxdesign/core/IconButton";
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
 * Icône engrenage : SVG inline monochrome (tâche #44, thème T3/#41). Trait fin
 * arrondi, non fourni par Astryx.
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
          icon={
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              {/* Engrenage monochrome : cercle central + 8 dents en petits segments */}
              <circle cx="8" cy="8" r="3" />
              {/* Dents extérieures : 8 petits traits radiaux */}
              <g>
                <line x1="8" y1="0.5" x2="8" y2="2" />
                <line x1="12.6" y1="3.4" x2="11.5" y2="4.5" />
                <line x1="15.5" y1="8" x2="14" y2="8" />
                <line x1="12.6" y1="12.6" x2="11.5" y2="11.5" />
                <line x1="8" y1="15.5" x2="8" y2="14" />
                <line x1="3.4" y1="12.6" x2="4.5" y2="11.5" />
                <line x1="0.5" y1="8" x2="2" y2="8" />
                <line x1="3.4" y1="3.4" x2="4.5" y2="4.5" />
              </g>
            </svg>
          }
          variant="ghost"
          onClick={onOpenSettings}
        />
      </HStack>
    </HStack>
  );
}
