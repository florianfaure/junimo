import type { McpHealth, Snapshot } from "../types";
import { renderAccountSection } from "./account";
import { renderGaugesSection } from "./gauges";
import { renderHistorySection } from "./history";
import { bindMcpsEvents, renderMcpsSection } from "./mcps";
import { renderProjectsSection } from "./projects";
import { bindSettingsEvents, renderSettingsFooter, type SettingsPanelData } from "./settings";

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
  /** Hors Tauri (npm run dev navigateur) : le save du footer reglages devient un no-op logue. */
  isTauri?: boolean;
  /** Appele apres une sauvegarde reussie du footer reglages (recharge + re-render cote appelant, voir main.ts). */
  onSettingsSaved?: () => void;
  /** Etat du health-check MCP (tache #17), porte par le module main.ts entre les renders. */
  mcpHealths?: Map<string, McpHealth> | "loading";
  /** Clic sur le bouton « tester » de la section MCPs (opt-in, jamais automatique). */
  onCheckMcps?: () => void;
}

/**
 * Rendu complet du Snapshot (+ footer reglages) dans #app. Idempotent : peut
 * etre appele autant de fois que necessaire (rafraichissement periodique),
 * remplace tout le contenu a chaque appel plutot que de le muter
 * partiellement. Les listeners du footer reglages sont ré-attaches APRES
 * chaque appel (voir `bindSettingsEvents`), puisque l'innerHTML est
 * integralement remplace.
 */
export function render(snapshot: Snapshot, settingsData: SettingsPanelData, options: RenderOptions = {}): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  const degraded = new Set(snapshot.meta?.degraded ?? []);
  const referenceIso = snapshot.meta?.generated_at ?? new Date().toISOString();

  app.innerHTML = `
    <div class="app-shell">
      ${renderHeader(options.staleError ?? false)}
      <main class="sections">
        ${renderGaugesSection(snapshot.gauges, degraded.has("gauges"), referenceIso)}
        ${renderHistorySection(snapshot.history)}
        ${renderProjectsSection(snapshot.projects, referenceIso)}
        ${renderMcpsSection(snapshot.mcps, degraded.has("mcps"), options.mcpHealths)}
        ${renderAccountSection(snapshot.account, degraded.has("account"))}
      </main>
      ${renderSettingsFooter(snapshot, settingsData)}
    </div>`;

  bindSettingsEvents(app, options.isTauri ?? false, options.onSettingsSaved ?? (() => {}));
  bindMcpsEvents(app, options.onCheckMcps ?? (() => {}));
}
