import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import type { Snapshot } from "../types";
import { Account } from "./Account";
import { SettingsForm, type SettingsPanelData } from "./SettingsForm";

/**
 * Page Réglages dédiée (tâche #27) : regroupe le formulaire réglages
 * (ex-SettingsFooter) et la section Compte, qui disparaissent de la home.
 * Bouton retour systématique en haut de la page.
 */
export function SettingsPage({
  snapshot,
  data,
  isTauri,
  onBack,
  onSaved,
}: {
  snapshot: Snapshot;
  data: SettingsPanelData;
  isTauri: boolean;
  onBack: () => void;
  onSaved: () => void;
}) {
  const degraded = new Set(snapshot.meta?.degraded ?? []);
  return (
    <div className="app-shell">
      <VStack gap={2} padding={3}>
        <HStack gap={2} align="center">
          <Button label="Retour" variant="ghost" icon={<Icon icon="chevronLeft" />} onClick={onBack} />
          <Heading level={1}>Réglages</Heading>
        </HStack>
        <Account account={snapshot.account} degraded={degraded.has("account")} />
        <SettingsForm snapshot={snapshot} data={data} isTauri={isTauri} onSaved={onSaved} />
      </VStack>
    </div>
  );
}
