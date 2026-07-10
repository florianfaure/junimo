import type { McpHealth, McpServer } from "../types";
import { renderDegradedSection } from "./degraded";
import { escapeHtml } from "./format";

/**
 * État du health-check des MCPs (tâche #17), piloté par le module `main.ts` :
 * - `undefined` : aucun test lancé (pas de pastille, état par défaut).
 * - `"loading"` : test en cours (bouton « … » désactivé).
 * - `Map` : résultats indexés par nom de serveur (pastilles affichées).
 */
export type McpHealthState = Map<string, McpHealth> | "loading" | undefined;

/** Pastille carrée 8x8 vert/orange/rouge, `title` = détail (jamais de secret). */
function renderHealthDot(health: McpHealth | undefined): string {
  if (!health) return "";
  const title = escapeHtml(health.detail ?? health.status);
  return `<span class="mcp-health-dot" data-status="${health.status}" title="${title}"></span>`;
}

function renderMcpRow(mcp: McpServer, healths: McpHealthState): string {
  const scopeLabel = mcp.scope === "global" ? "global" : "projet";
  const health = healths instanceof Map ? healths.get(mcp.name) : undefined;
  return `
    <div class="mcp-row">
      ${renderHealthDot(health)}
      <span class="mono mcp-name">${escapeHtml(mcp.name)}</span>
      <span class="tag mono" data-scope="${mcp.scope}">${scopeLabel}</span>
      <span class="tag mono" data-transport="${mcp.transport}">${mcp.transport}</span>
    </div>`;
}

/** Bouton pixel « tester » du header, désactivé et en « … » pendant le check. */
function renderTestButton(healths: McpHealthState): string {
  const loading = healths === "loading";
  const label = loading ? "…" : "tester";
  return `<button type="button" class="tag mono mcp-test-btn" data-mcp-test ${loading ? "disabled" : ""}>${label}</button>`;
}

export function renderMcpsSection(
  mcps: McpServer[] | undefined,
  degraded: boolean,
  healths?: McpHealthState,
): string {
  if (degraded || !mcps) {
    return renderDegradedSection("MCPs", "mcps");
  }
  if (mcps.length === 0) {
    return `
      <section class="panel section" data-section="mcps">
        <div class="section-head">
          <h2 class="pixel-label section-title">MCPs</h2>
        </div>
        <p class="mono empty-hint">aucun serveur configuré</p>
      </section>`;
  }
  return `
    <section class="panel section" data-section="mcps">
      <div class="section-head">
        <h2 class="pixel-label section-title">MCPs</h2>
        <div class="mcp-head-actions">
          <span class="mono mcp-count">${mcps.length}</span>
          ${renderTestButton(healths)}
        </div>
      </div>
      <div class="mcp-list">
        ${mcps.map((mcp) => renderMcpRow(mcp, healths)).join("")}
      </div>
    </section>`;
}

/**
 * Attache le listener du bouton « tester » APRÈS chaque render (qui remplace
 * tout le innerHTML de #app, voir `render.ts`), même pattern que
 * `bindSettingsEvents`. No-op si le bouton est absent (section dégradée/vide).
 */
export function bindMcpsEvents(app: HTMLElement, onCheck: () => void): void {
  const button = app.querySelector<HTMLButtonElement>("[data-mcp-test]");
  if (!button) return;
  button.addEventListener("click", () => onCheck());
}
