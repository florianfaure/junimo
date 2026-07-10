import type { ProjectStat } from "../types";
import { escapeHtml, formatRelativeAgo, formatTokens } from "./format";

function renderProjectRow(project: ProjectStat, referenceIso: string): string {
  return `
    <div class="project-row">
      <span class="mono project-name">${escapeHtml(project.name)}</span>
      <span class="mono project-tokens">${formatTokens(project.tokens_7d)} tok</span>
      <span class="tag mono project-model">${escapeHtml(project.top_model)}</span>
      <span class="mono project-ago">${formatRelativeAgo(project.last_used, referenceIso)}</span>
    </div>`;
}

/**
 * Section « Projets » de l'overlay : top 5 des projets par tokens pondérés
 * sur 7 jours (déjà trié/tronqué côté backend). Pur affichage.
 */
export function renderProjectsSection(
  projects: ProjectStat[] | undefined,
  referenceIso: string,
): string {
  if (!projects || projects.length === 0) {
    return `
      <section class="panel section" data-section="projects">
        <div class="section-head">
          <h2 class="pixel-label section-title">Projets</h2>
        </div>
        <p class="mono empty-hint">aucune activité sur 7 jours</p>
      </section>`;
  }
  return `
    <section class="panel section" data-section="projects">
      <div class="section-head">
        <h2 class="pixel-label section-title">Projets</h2>
        <span class="mono mcp-count">${projects.length}</span>
      </div>
      <div class="project-list">
        ${projects.map((project) => renderProjectRow(project, referenceIso)).join("")}
      </div>
    </section>`;
}
