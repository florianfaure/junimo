import type { ReactNode } from "react";
import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Banner } from "@astryxdesign/core/Banner";

/**
 * Conteneur de section commun (ex-`.panel .section` du thème pixel) : une Card
 * Astryx avec un en-tête (titre + slot d'action optionnel) et un corps. Pur
 * présentationnel, réutilisé par toutes les sections de l'accueil.
 */
export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card padding={3}>
      <VStack gap={2}>
        <HStack justify="between" align="center">
          <Heading level={2}>{title}</Heading>
          {action}
        </HStack>
        {children}
      </VStack>
    </Card>
  );
}

/**
 * État dégradé partagé par les sections dont la source de données a échoué
 * (`snapshot.meta.degraded`). Remplace `renderDegradedSection` du front vanilla.
 */
export function DegradedSection({ title }: { title: string }) {
  return (
    <Panel title={title}>
      <Banner status="error" title="données indisponibles" />
    </Panel>
  );
}
