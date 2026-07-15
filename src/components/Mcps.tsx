import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import type { McpHealth, McpServer, Meta } from "../types";
import { Panel, DegradedSection } from "./Panel";
import { Num } from "./Num";

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
 * Section « État système » (tâche #43) : quelques métadonnées déjà présentes
 * dans le snapshot (`meta`, `account`) mais pas encore affichées dans un tab —
 * version CLI, modèle par défaut, mode des jauges (officiel/estimé) et
 * sources dégradées éventuelles. Pur affichage, aucune donnée nouvelle.
 *
 * Hors scope (tâche #43, à noter en feedback) : « skills les plus utilisés »
 * (spec section 4) nécessiterait de parser le contenu des messages des
 * transcripts (blocs d'outils), pas seulement `message.usage` comme
 * aujourd'hui — un nouveau scan plus coûteux, explicitement interdit
 * (perf, tâche #22). Non implémenté ici.
 */
function SystemStatusPanel({
  cliVersion,
  defaultModel,
  meta,
}: {
  cliVersion: string;
  defaultModel: string;
  meta: Meta;
}) {
  return (
    <Panel title="État système">
      <VStack gap={1}>
        <HStack justify="between" align="center">
          <Text type="supporting">CLI Claude Code</Text>
          <Num>{cliVersion}</Num>
        </HStack>
        <HStack justify="between" align="center">
          <Text type="supporting">modèle par défaut</Text>
          <Num>{defaultModel}</Num>
        </HStack>
        <HStack justify="between" align="center">
          <Text type="supporting">jauges</Text>
          <Badge
            variant={meta.estimated ? "warning" : "success"}
            label={meta.estimated ? "estimées" : "officielles"}
          />
        </HStack>
        {meta.degraded.length > 0 ? (
          <HStack gap={2} align="center">
            <Badge variant="warning" label="dégradé" />
            <Text type="supporting" size="2xs" maxLines={1} style={{ flex: 1, minWidth: 0 }}>
              {meta.degraded.join(", ")}
            </Text>
          </HStack>
        ) : null}
      </VStack>
    </Panel>
  );
}

/**
 * Section « MCPs » : serveurs configurés + health-check opt-in (bouton « tester »
 * → pastilles). Le check n'est JAMAIS automatique (déclenché au clic uniquement).
 * Contenu toujours visible : depuis la nav en tabs (#42), la section vit dans
 * son propre onglet — plus d'accordéon repliable. Complétée tâche #43 par un
 * bloc « État système » (voir [`SystemStatusPanel`]) sous la liste des MCPs.
 */
export function Mcps({
  mcps,
  degraded,
  healths,
  onCheck,
  meta,
  cliVersion,
  defaultModel,
}: {
  mcps: McpServer[] | undefined;
  degraded: boolean;
  healths: McpHealthState;
  onCheck: () => void;
  meta: Meta;
  cliVersion: string;
  defaultModel: string;
}) {
  if (degraded || !mcps) {
    return (
      <VStack gap={2}>
        <DegradedSection title="MCPs" />
        <SystemStatusPanel cliVersion={cliVersion} defaultModel={defaultModel} meta={meta} />
      </VStack>
    );
  }
  const loading = healths === "loading";
  return (
    <VStack gap={2}>
      {mcps.length === 0 ? (
        <Panel title="MCPs">
          <Text type="supporting">aucun serveur configuré</Text>
        </Panel>
      ) : (
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
      )}
      <SystemStatusPanel cliVersion={cliVersion} defaultModel={defaultModel} meta={meta} />
    </VStack>
  );
}
