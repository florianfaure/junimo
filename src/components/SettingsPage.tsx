import { useState } from "react";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Tabs } from "./Tabs";
import type { Snapshot } from "../types";
import { Account } from "./Account";
import { SettingsForm, type SettingsPanelData } from "./SettingsForm";

/**
 * Icônes des onglets Réglages (tâche #44) : style monochrome SVG inline
 * 14px, trait fin arrondi, currentColor.
 */
const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  xmlns: "http://www.w3.org/2000/svg",
  "aria-hidden": true,
};

/** Compte → personne/user. */
const AccountIcon = (
  <svg {...iconProps}>
    <circle cx="8" cy="5.5" r="2" />
    <path d="M3.5 14c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
  </svg>
);

/** Réglages → engrenage. */
const SettingsIcon = (
  <svg {...iconProps}>
    <circle cx="8" cy="8" r="3" />
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
);

/**
 * Page Réglages dédiée (tâche #27) : regroupe le formulaire réglages
 * (ex-SettingsFooter) et la section Compte en 2 onglets (tâche #44).
 * Bouton retour systématique en haut de la page. L'onglet actif n'est pas
 * persisté (état local, défaut « Compte »).
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
  // État local de l'onglet actif : pas de persistance pour cette page.
  const [activeTab, setActiveTab] = useState<string>("account");

  const degraded = new Set(snapshot.meta?.degraded ?? []);
  return (
    <div className="app-shell">
      <VStack gap={2} padding={3}>
        <HStack gap={2} align="center">
          <Button label="Retour" variant="ghost" icon={<Icon icon="chevronLeft" />} onClick={onBack} />
          <Heading level={1}>Réglages</Heading>
        </HStack>
        <Tabs
          active={activeTab}
          onChange={setActiveTab}
          items={[
            {
              id: "account",
              label: "Compte",
              icon: AccountIcon,
              content: <Account account={snapshot.account} degraded={degraded.has("account")} />,
            },
            {
              id: "settings",
              label: "Réglages",
              icon: SettingsIcon,
              content: <SettingsForm snapshot={snapshot} data={data} isTauri={isTauri} onSaved={onSaved} />,
            },
          ]}
        />
      </VStack>
    </div>
  );
}
