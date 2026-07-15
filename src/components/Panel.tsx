import type { ReactNode } from "react";
import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Banner } from "@astryxdesign/core/Banner";
import { Collapsible } from "@astryxdesign/core/Collapsible";

/**
 * Conteneur de section commun : une Card Astryx avec un en-tête (titre + slot
 * d'action optionnel) et un corps. Pur présentationnel, réutilisé par toutes
 * les sections des pages.
 *
 * Si `isOpen`/`onOpenChange` sont fournis, la section devient repliable : la
 * Card enveloppe alors un Collapsible dont le déclencheur est le titre (+
 * chevron). L'action éventuelle passe en tête du corps (elle reste ainsi hors
 * du bouton-déclencheur — pas d'imbrication d'éléments interactifs) et n'est
 * visible qu'une fois la section ouverte. Dans les deux cas le rendu extérieur
 * est une Card identique : densité et style homogènes entre toutes les sections.
 */
export function Panel({
  title,
  action,
  children,
  isOpen,
  onOpenChange,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const collapsible = isOpen !== undefined && onOpenChange !== undefined;

  return (
    <Card padding={3}>
      {collapsible ? (
        <Collapsible trigger={<Heading level={2}>{title}</Heading>} isOpen={isOpen} onOpenChange={onOpenChange}>
          <VStack gap={2} style={{ paddingTop: "var(--spacing-2)" }}>
            {action ? (
              <HStack justify="end" align="center">
                {action}
              </HStack>
            ) : null}
            {children}
          </VStack>
        </Collapsible>
      ) : (
        <VStack gap={2}>
          <HStack justify="between" align="center">
            <Heading level={2}>{title}</Heading>
            {action}
          </HStack>
          {children}
        </VStack>
      )}
    </Card>
  );
}

/**
 * État dégradé partagé par les sections dont la source de données a échoué
 * (`snapshot.meta.degraded`).
 */
export function DegradedSection({ title }: { title: string }) {
  return (
    <Panel title={title}>
      <Banner status="error" title="données indisponibles" />
    </Panel>
  );
}
