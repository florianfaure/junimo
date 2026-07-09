import type { Snapshot } from "../types";
import { renderAccountSection } from "./account";
import { renderGaugesSection } from "./gauges";
import { renderMcpsSection } from "./mcps";

function renderHeader(staleError: boolean): string {
  return `
    <header class="header">
      <div class="sprite junimo-idle" role="img" aria-label="Junimo"></div>
      <div class="title-block">
        <h1 class="pixel-title">JUNIMO</h1>
        <p class="mono subtitle">tableau de bord Claude Code</p>
      </div>
      ${
        staleError
          ? `<span class="mono stale-badge" title="Derniere synchronisation en echec, donnees peut-etre obsoletes">⚠</span>`
          : ""
      }
    </header>`;
}

export interface RenderOptions {
  /** Le dernier refresh a echoue : on affiche quand meme le snapshot precedent, avec un indicateur discret. */
  staleError?: boolean;
}

/**
 * Rendu complet du Snapshot dans #app. Idempotent : peut etre appele autant
 * de fois que necessaire (rafraichissement periodique), remplace tout le
 * contenu a chaque appel plutot que de le muter partiellement.
 */
export function render(snapshot: Snapshot, options: RenderOptions = {}): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  const degraded = new Set(snapshot.meta?.degraded ?? []);
  const referenceIso = snapshot.meta?.generated_at ?? new Date().toISOString();

  app.innerHTML = `
    <div class="app-shell">
      ${renderHeader(options.staleError ?? false)}
      <main class="sections">
        ${renderGaugesSection(snapshot.gauges, degraded.has("gauges"), referenceIso)}
        ${renderMcpsSection(snapshot.mcps, degraded.has("mcps"))}
        ${renderAccountSection(snapshot.account, degraded.has("account"))}
      </main>
    </div>`;
}
