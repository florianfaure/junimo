import "./styles.css";
import { mockSnapshot } from "./mock";
import type { Snapshot } from "./types";
import { render } from "./ui/render";
import { renderError } from "./ui/error";

const REFRESH_INTERVAL_MS = 30_000;

const isTauri = "__TAURI_INTERNALS__" in window;

let lastSnapshot: Snapshot | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;

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

async function refresh(): Promise<void> {
  try {
    const snapshot = await fetchSnapshot();
    lastSnapshot = snapshot;
    render(snapshot);
  } catch (error) {
    console.error("Junimo: echec de get_snapshot", error);
    if (lastSnapshot) {
      // On garde le dernier affichage connu + un indicateur discret d'erreur.
      render(lastSnapshot, { staleError: true });
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
