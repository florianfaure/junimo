import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { JunimoSprite } from "./JunimoSprite";
import type { JunimoSettings } from "../types";

/**
 * En-tête de l'overlay : icône réglages en haut à gauche (bouton icône
 * accessible, tâche #27), junimo composé par l'utilisateur (tâche #33,
 * `composeJunimo` — seul élément pixel-art conservé, cliquable vers son
 * éditeur) + son nom personnalisé (remplace le titre statique « Junimo »).
 * Le badge « obsolète » apparaît quand le dernier refresh a échoué mais
 * qu'un snapshot précédent reste affiché (staleError).
 *
 * Le sous-titre « tableau de bord Claude Code » est conservé ici pour rester
 * iso-fonctionnel ; sa suppression est prévue à la tâche #26 (refonte visuelle).
 *
 * Pas d'icône "engrenage"/"cog" dans le registre sémantique Astryx
 * (@astryxdesign/theme-neutral) : `wrench` est le plus proche équivalent
 * "réglages/outils" sans introduire de dépendance icône supplémentaire.
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
      <IconButton
        label="Réglages"
        icon={<Icon icon="wrench" />}
        variant="ghost"
        onClick={onOpenSettings}
      />
      <button type="button" className="junimo-trigger" onClick={onOpenJunimoEditor} aria-label="Personnaliser le junimo">
        <JunimoSprite spec={junimo} scale={2} label={junimo.name} />
      </button>
      <VStack gap={0.5}>
        <Heading level={1}>{junimo.name}</Heading>
        <Text type="supporting">tableau de bord Claude Code</Text>
      </VStack>
      {staleError ? (
        <Badge variant="warning" label="⚠" style={{ marginInlineStart: "auto" }} />
      ) : null}
    </HStack>
  );
}
