import "./styles.css";
import { mockSnapshot } from "./mock";
import type { AppSettings, McpHealth, ShortcutStatus, Snapshot } from "./types";
import { render } from "./ui/render";
import { renderError } from "./ui/error";
import { mockSettingsData, type SettingsPanelData } from "./ui/settings";

const REFRESH_INTERVAL_MS = 30_000;

const isTauri = "__TAURI_INTERNALS__" in window;

let lastSnapshot: Snapshot | undefined;
// Cache : rechargees au demarrage puis apres chaque sauvegarde uniquement
// (pas a chaque tick de 30 s, voir `fetchSettingsData`/`handleSettingsSaved`).
let lastSettingsData: SettingsPanelData | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
// Health-check MCP (tache #17), opt-in : `undefined` tant qu'aucun test n'a
// ete lance, `"loading"` pendant le check, `Map` avec les resultats ensuite.
// Cet etat module survit aux re-renders : les pastilles restent affichees
// entre les refresh 30 s, mais ne sont JAMAIS rafraichies automatiquement.
let mcpHealths: Map<string, McpHealth> | "loading" | undefined;

/** Rendu de l'etat "chargement" pixel affiche avant reception du 1er snapshot. */
function renderLoading(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;
  app.innerHTML = `
    <div class="app-shell">
      <div class="loading-state">
        <div class="sprite junimo-idle" role="img" aria-label="Junimo"></div>
        <p class="mono loading-text">chargement…</p>
      </div>
    </div>`;
}

async function fetchSnapshot(): Promise<Snapshot> {
  if (!isTauri) {
    // Hors Tauri (npm run dev dans un navigateur) : le mock reste la seule
    // source de donnees possible, invoke() n'existe pas.
    return mockSnapshot;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Snapshot>("get_snapshot");
}

/** Charge les 3 sources du footer reglages (settings, autostart, statut du raccourci) en parallele. */
async function fetchSettingsData(): Promise<SettingsPanelData> {
  if (!isTauri) {
    // Hors Tauri : mock plausible, le footer reste manipulable sans backend.
    return mockSettingsData;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const [settings, autostart, shortcutStatus] = await Promise.all([
    invoke<AppSettings>("get_settings"),
    invoke<boolean>("get_autostart"),
    invoke<ShortcutStatus>("get_shortcut_status"),
  ]);
  return { settings, autostart, shortcutStatus };
}

/** true si le footer reglages est deploye (edition potentiellement en cours). */
function isSettingsFooterOpen(): boolean {
  return document.querySelector<HTMLDetailsElement>("[data-settings-footer]")?.open ?? false;
}

function renderSnapshot(snapshot: Snapshot, staleError: boolean): void {
  if (!lastSettingsData) return; // pas encore charge (course improbable, le prochain tick reessaiera)
  render(snapshot, lastSettingsData, {
    staleError,
    isTauri,
    onSettingsSaved: () => void handleSettingsSaved(),
    mcpHealths,
    onCheckMcps: () => void handleCheckMcps(),
  });
}

/**
 * Lance le health-check des MCPs (bouton « tester »). Opt-in strict : appele
 * uniquement au clic, jamais depuis le polling. Passe par `"loading"` puis
 * stocke les resultats dans l'etat module (re-render immediat a chaque etape).
 */
async function handleCheckMcps(): Promise<void> {
  if (!isTauri) {
    // Hors Tauri (npm run dev navigateur) : invoke() n'existe pas, no-op logue.
    console.log("Junimo (dev, hors Tauri) : check_mcps serait appele");
    return;
  }
  mcpHealths = "loading";
  if (lastSnapshot) renderSnapshot(lastSnapshot, false);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const results = await invoke<McpHealth[]>("check_mcps");
    mcpHealths = new Map(results.map((health) => [health.name, health]));
  } catch (error) {
    console.error("Junimo: echec de check_mcps", error);
    mcpHealths = undefined;
  }
  if (lastSnapshot) renderSnapshot(lastSnapshot, false);
}

/** Apres une sauvegarde reussie du footer : recharge les reglages et re-render immediatement. */
async function handleSettingsSaved(): Promise<void> {
  lastSettingsData = await fetchSettingsData();
  if (lastSnapshot) renderSnapshot(lastSnapshot, false);
}

async function refresh(): Promise<void> {
  try {
    const snapshot = await fetchSnapshot();
    lastSnapshot = snapshot;
    if (!lastSettingsData) {
      // Chargement initial uniquement (voir le commentaire sur lastSettingsData).
      lastSettingsData = await fetchSettingsData();
    }
    // Edition en cours dans le footer : on vient de rafraichir lastSnapshot
    // (donnees a jour au prochain re-render), mais on saute le re-render de
    // ce tick pour ne pas ecraser une saisie non sauvegardee.
    if (isSettingsFooterOpen()) return;
    renderSnapshot(snapshot, false);
  } catch (error) {
    console.error("Junimo: echec de get_snapshot", error);
    if (lastSnapshot) {
      if (isSettingsFooterOpen()) return;
      // On garde le dernier affichage connu + un indicateur discret d'erreur.
      if (!lastSettingsData) lastSettingsData = await fetchSettingsData();
      renderSnapshot(lastSnapshot, true);
    } else {
      renderError();
    }
  }
}

function isWindowVisible(): boolean {
  return document.visibilityState === "visible";
}

function stopPolling(): void {
  if (refreshTimer !== undefined) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}

function startPolling(): void {
  if (refreshTimer !== undefined) return;
  refreshTimer = setInterval(() => {
    if (isWindowVisible()) void refresh();
  }, REFRESH_INTERVAL_MS);
}

document.addEventListener("visibilitychange", () => {
  if (isWindowVisible()) {
    // La fenetre redevient visible (ouverture depuis le tray) : on rafraichit
    // immediatement plutot que d'attendre le prochain tick de 30 s, et on
    // reactive le polling (coupe pendant que la fenetre etait cachee).
    void refresh();
    startPolling();
  } else {
    // Fenetre cachee (perte de focus) : inutile d'interroger le backend.
    stopPolling();
  }
});

renderLoading();
void refresh();
if (isWindowVisible()) startPolling();
