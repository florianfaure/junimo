import type { McpServer } from "../types";
import { renderDegradedSection } from "./degraded";
import { escapeHtml } from "./format";

function renderMcpRow(mcp: McpServer): string {
  const scopeLabel = mcp.scope === "global" ? "global" : "projet";
  return `
    <div class="mcp-row">
      <span class="mono mcp-name">${escapeHtml(mcp.name)}</span>
      <span class="tag mono" data-scope="${mcp.scope}">${scopeLabel}</span>
      <span class="tag mono" data-transport="${mcp.transport}">${mcp.transport}</span>
    </div>`;
}

export function renderMcpsSection(mcps: McpServer[] | undefined, degraded: boolean): string {
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
        <span class="mono mcp-count">${mcps.length}</span>
      </div>
      <div class="mcp-list">
        ${mcps.map(renderMcpRow).join("")}
      </div>
    </section>`;
}
