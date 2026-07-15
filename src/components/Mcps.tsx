import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import type { McpHealth, McpServer } from "../types";
import { Panel, DegradedSection } from "./Panel";

/**
 * État du health-check des MCPs (tâche #17), piloté par le hook `useOverlayData` :
 * - `undefined` : aucun test lancé (pas de pastille).
 * - `"loading"` : test en cours (bouton « … » désactivé).
 * - `Map` : résultats indexés par nom de serveur (pastilles affichées).
 */
export type McpHealthState = Map<string, McpHealth> | "loading" | undefined;

/** Pastille StatusDot vert/orange/rouge, tooltip = détail (jamais de secret). */
function HealthDot({ health }: { health: McpHealth | undefined }) {
  if (!health) return null;
  const variant = health.status === "ok" ? "success" : health.status === "warn" ? "warning" : "error";
  return <StatusDot variant={variant} label={health.status} tooltip={health.detail ?? health.status} />;
}

/**
 * Section « MCPs » : serveurs configurés + health-check opt-in (bouton « tester »
 * → pastilles). Le check n'est JAMAIS automatique (déclenché au clic uniquement).
 * Contenu toujours visible : depuis la nav en tabs (#42), la section vit dans
 * son propre onglet — plus d'accordéon repliable.
 */
export function Mcps({
  mcps,
  degraded,
  healths,
  onCheck,
}: {
  mcps: McpServer[] | undefined;
  degraded: boolean;
  healths: McpHealthState;
  onCheck: () => void;
}) {
  if (degraded || !mcps) {
    return <DegradedSection title="MCPs" />;
  }
  if (mcps.length === 0) {
    return (
      <Panel title="MCPs">
        <Text type="supporting">aucun serveur configuré</Text>
      </Panel>
    );
  }
  const loading = healths === "loading";
  return (
    <Panel
      title="MCPs"
      action={
        <HStack gap={2} align="center">
          <Badge variant="neutral" label={String(mcps.length)} />
          <Button
            label={loading ? "…" : "tester"}
            variant="secondary"
            size="sm"
            isDisabled={loading}
            isLoading={loading}
            onClick={() => onCheck()}
          />
        </HStack>
      }
    >
      <VStack gap={1}>
        {mcps.map((mcp) => {
          const health = healths instanceof Map ? healths.get(mcp.name) : undefined;
          return (
            <HStack key={mcp.name} gap={2} align="center">
              <HealthDot health={health} />
              <Text type="body" maxLines={1} style={{ flex: 1, minWidth: 0 }}>
                {mcp.name}
              </Text>
              <Badge variant={mcp.scope === "global" ? "success" : "warning"} label={mcp.scope === "global" ? "global" : "projet"} />
              <Badge variant="neutral" label={mcp.transport} />
            </HStack>
          );
        })}
      </VStack>
    </Panel>
  );
}
