import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import type { ProjectStat } from "../types";
import { formatRelativeAgo, formatTokens } from "../ui/format";
import { Panel } from "./Panel";

/**
 * Section « Projets » : top 5 des projets par tokens pondérés sur 7 jours (déjà
 * trié/tronqué côté backend). Pur affichage. React échappe le texte : plus
 * besoin de `escapeHtml`.
 */
export function Projects({
  projects,
  referenceIso,
}: {
  projects: ProjectStat[] | undefined;
  referenceIso: string;
}) {
  if (!projects || projects.length === 0) {
    return (
      <Panel title="Projets">
        <Text type="supporting">aucune activité sur 7 jours</Text>
      </Panel>
    );
  }
  return (
    <Panel title="Projets" action={<Badge variant="neutral" label={String(projects.length)} />}>
      <VStack gap={1}>
        {projects.map((project) => (
          <HStack key={project.name} gap={2} align="center">
            <Text type="body" maxLines={1} style={{ flex: 1, minWidth: 0 }}>
              {project.name}
            </Text>
            <Text type="supporting">{formatTokens(project.tokens_7d)} tok</Text>
            <Badge variant="neutral" label={project.top_model} />
            <Text type="supporting">{formatRelativeAgo(project.last_used, referenceIso)}</Text>
          </HStack>
        ))}
      </VStack>
    </Panel>
  );
}
