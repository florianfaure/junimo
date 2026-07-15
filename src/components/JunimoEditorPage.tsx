import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";

/**
 * Page dédiée à l'éditeur du junimo (forme / couleur / accessoire / nom),
 * atteinte en cliquant sur le sprite dans le header. Placeholder minimal
 * pour la tâche #27 (navigation) — le contenu réel (préview live, choix de
 * forme/couleur/accessoire, champ nom, persistance) est livré par la
 * tâche #33 (éditeur de junimo).
 */
export function JunimoEditorPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="app-shell">
      <VStack gap={2} padding={3}>
        <HStack gap={2} align="center">
          <Button label="Retour" variant="ghost" icon={<Icon icon="chevronLeft" />} onClick={onBack} />
          <Heading level={1}>Éditeur du junimo</Heading>
        </HStack>
        <Text type="supporting">
          à venir : choix de forme, couleur, accessoire et nom personnalisé pour le junimo.
        </Text>
      </VStack>
    </div>
  );
}
