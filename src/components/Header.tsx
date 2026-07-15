import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";

/**
 * En-tête de l'overlay : sprite pixel du junimo (seul élément pixel-art
 * conservé) + nom + sous-titre. Le badge « obsolète » apparaît quand le dernier
 * refresh a échoué mais qu'un snapshot précédent reste affiché (staleError).
 *
 * Le sous-titre « tableau de bord Claude Code » est conservé ici pour rester
 * iso-fonctionnel ; sa suppression est prévue à la tâche #26 (refonte visuelle).
 */
export function Header({ staleError }: { staleError: boolean }) {
  return (
    <HStack gap={2} align="center">
      <div className="junimo-idle pixelated" role="img" aria-label="Junimo" />
      <VStack gap={0.5}>
        <Heading level={1}>Junimo</Heading>
        <Text type="supporting">tableau de bord Claude Code</Text>
      </VStack>
      {staleError ? (
        <Badge variant="warning" label="⚠" style={{ marginInlineStart: "auto" }} />
      ) : null}
    </HStack>
  );
}
