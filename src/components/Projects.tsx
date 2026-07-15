import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import type { ProjectStat } from "../types";
import { formatRelativeAgo, formatTokens } from "../ui/format";
import { Panel } from "./Panel";
import { Num } from "./Num";

/**
 * Une ligne de projet : nom, badge git (si dépôt détecté), tokens pondérés,
 * modèle dominant et dernière activité sur la ligne principale ; chemin du
 * dossier et première activité connue en second rang, plus discrets (texte
 * "supporting", petite taille). `path`/`has_git`/`first_seen` peuvent être
 * `null`/`false` (projet renommé/déplacé, ou résolution indisponible côté
 * backend, tâche #43) : la ligne secondaire est alors simplement omise.
 */
function ProjectRow({ project, referenceIso }: { project: ProjectStat; referenceIso: string }) {
  return (
    <VStack gap={0}>
      <HStack gap={2} align="center">
        <Text type="body" maxLines={1} style={{ flex: 1, minWidth: 0 }}>
          {project.name}
        </Text>
        {project.has_git ? <Badge variant="neutral" label="git" /> : null}
        <Num>{formatTokens(project.tokens_7d)} tok</Num>
        <Badge variant="neutral" label={project.top_model} />
        <Num>{formatRelativeAgo(project.last_used, referenceIso)}</Num>
      </HStack>
      {project.path || project.first_seen ? (
        <HStack gap={2} align="center">
          {project.path ? (
            <Text type="supporting" size="2xs" maxLines={1} style={{ flex: 1, minWidth: 0 }}>
              {project.path}
            </Text>
          ) : null}
          {project.first_seen ? (
            <Text type="supporting" size="2xs">
              depuis {formatRelativeAgo(project.first_seen, referenceIso)}
            </Text>
          ) : null}
        </HStack>
      ) : null}
    </VStack>
  );
}

/**
 * Section « Projets » : top 5 des projets par tokens pondérés sur 7 jours (déjà
 * trié/tronqué côté backend). Pur affichage. React échappe le texte : plus
 * besoin de `escapeHtml`. Contenu toujours visible : depuis la nav en tabs
 * (#42), la section vit dans son propre onglet — plus d'accordéon repliable.
 * Enrichi tâche #43 : dépôt git, chemin du dossier et première activité
 * connue, en plus des tokens/modèle/dernière activité déjà affichés.
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
    <Panel
      title="Projets"
      action={<Badge variant="neutral" label={String(projects.length)} />}
    >
      <VStack gap={2}>
        {projects.map((project) => (
          <ProjectRow key={project.name} project={project} referenceIso={referenceIso} />
        ))}
      </VStack>
    </Panel>
  );
}
