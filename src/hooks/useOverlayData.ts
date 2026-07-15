import { useCallback, useEffect, useRef, useState } from "react";
import { mockSnapshot } from "../mock";
import type { AppSettings, McpHealth, ShortcutStatus, Snapshot } from "../types";
import { mockSettingsData, type SettingsPanelData } from "../components/SettingsForm";
import type { McpHealthState } from "../components/Mcps";

// NB : valeurs reprises telles quelles du front vanilla (main.ts).
// Poll réseau = 60 s ; tick d'affichage local (avance le compte à rebours
// "reset dans Xh Ym" sans invoke) = 30 s.
const REFRESH_INTERVAL_MS = 60_000;
const DISPLAY_TICK_INTERVAL_MS = 30_000;

export const isTauri = "__TAURI_INTERNALS__" in window;

async function fetchSnapshot(): Promise<Snapshot> {
  if (!isTauri) {
    // Hors Tauri (npm run dev navigateur) : le mock est la seule source possible.
    return mockSnapshot;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Snapshot>("get_snapshot");
}

/** Charge les 3 sources du footer réglages (settings, autostart, statut raccourci) en parallèle. */
async function fetchSettingsData(): Promise<SettingsPanelData> {
  if (!isTauri) {
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

export type Phase = "loading" | "error" | "ready";

export interface OverlayData {
  phase: Phase;
  snapshot: Snapshot | undefined;
  settingsData: SettingsPanelData | undefined;
  staleError: boolean;
  nowIso: string;
  mcpHealths: McpHealthState;
  onCheckMcps: () => void;
  onSettingsSaved: () => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
}

/**
 * Onglets de la navigation de la page home (tâche #42). Remplacent les
 * accordéons persistants de #28 : un seul onglet visible à la fois, le choix
 * étant persisté (même esprit que l'ancien état ouvert/fermé des sections).
 */
export const TAB_IDS = ["usage", "chats", "projects", "system"] as const;
export type TabId = (typeof TAB_IDS)[number];
const DEFAULT_TAB: TabId = "usage";

/**
 * Charge l'onglet actif : `?tab=` prioritaire (deep-link de dev/QA, même
 * doctrine que `?page=`/`?theme=`/`?anim=` — sans effet en usage normal),
 * sinon localStorage, repli sur "usage".
 */
function loadActiveTab(): TabId {
  const forced = new URLSearchParams(location.search).get("tab");
  if (TAB_IDS.includes(forced as TabId)) return forced as TabId;
  try {
    const stored = localStorage.getItem("junimo.nav.tab");
    return TAB_IDS.includes(stored as TabId) ? (stored as TabId) : DEFAULT_TAB;
  } catch {
    return DEFAULT_TAB; // Défaut si localStorage indisponible.
  }
}

/** Sauvegarde l'onglet actif dans localStorage. */
function saveActiveTab(tab: TabId): void {
  try {
    localStorage.setItem("junimo.nav.tab", tab);
  } catch {
    // Silencieux si localStorage est plein ou indisponible.
  }
}

/**
 * Cœur du comportement de l'overlay, migré tel quel depuis main.ts :
 *  - poll 60 s + refresh immédiat à l'ouverture (visibilitychange) ;
 *  - tick d'affichage 30 s (re-render local, sans invoke) ;
 *  - timers coupés quand la fenêtre est cachée ;
 *  - badge staleError conservé entre deux polls ;
 *  - garde anti-écrasement : pendant que la page Réglages est ouverte (App
 *    pilote `setSettingsOpen` sur la navigation, cf. tâche #27), les
 *    polls/ticks ne re-render pas (les refs restent à jour) ;
 *  - health-check MCP opt-in (jamais automatique) ;
 *  - mode mock hors Tauri.
 */
export function useOverlayData(): OverlayData {
  const [phase, setPhase] = useState<Phase>("loading");
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [settingsData, setSettingsData] = useState<SettingsPanelData>();
  const [staleError, setStaleError] = useState(false);
  const [mcpHealths, setMcpHealths] = useState<McpHealthState>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const [settingsOpen, setSettingsOpenState] = useState(false);
  const [activeTab, setActiveTabState] = useState<TabId>(() => loadActiveTab());

  // Refs mises à jour à chaque poll (survivent au « skip render » du footer).
  const snapshotRef = useRef<Snapshot | undefined>(undefined);
  const settingsDataRef = useRef<SettingsPanelData | undefined>(undefined);
  const staleRef = useRef(false);
  const settingsOpenRef = useRef(false);

  const setSettingsOpen = useCallback((open: boolean) => {
    settingsOpenRef.current = open;
    setSettingsOpenState(open);
  }, []);

  const setActiveTab = useCallback((tab: TabId) => {
    saveActiveTab(tab);
    setActiveTabState(tab);
  }, []);

  // Pousse l'état interne (refs) vers le rendu. `now` rafraîchi à chaque commit
  // pour faire vivre le compte à rebours des jauges.
  const commit = useCallback(() => {
    setPhase("ready");
    setSnapshot(snapshotRef.current);
    setStaleError(staleRef.current);
    setNow(Date.now());
  }, []);

  const ensureSettings = useCallback(async () => {
    if (!settingsDataRef.current) {
      const data = await fetchSettingsData();
      settingsDataRef.current = data;
      setSettingsData(data);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const snap = await fetchSnapshot();
      snapshotRef.current = snap;
      await ensureSettings();
      staleRef.current = false;
      // Édition en cours dans le footer : refs à jour, mais on saute le
      // re-render pour ne pas écraser une saisie non sauvegardée.
      if (settingsOpenRef.current) return;
      commit();
    } catch (error) {
      console.error("Junimo: echec de get_snapshot", error);
      if (snapshotRef.current) {
        // On garde le dernier affichage connu + indicateur discret d'erreur.
        staleRef.current = true;
        if (settingsOpenRef.current) return;
        await ensureSettings();
        commit();
      } else {
        setPhase("error");
      }
    }
  }, [commit, ensureSettings]);

  const displayTick = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    if (settingsOpenRef.current) return; // même garde que refresh()
    if (snapshotRef.current) commit();
  }, [commit]);

  const onCheckMcps = useCallback(async () => {
    if (!isTauri) {
      console.log("Junimo (dev, hors Tauri) : check_mcps serait appele");
      return;
    }
    setMcpHealths("loading");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const results = await invoke<McpHealth[]>("check_mcps");
      setMcpHealths(new Map(results.map((health) => [health.name, health])));
    } catch (error) {
      console.error("Junimo: echec de check_mcps", error);
      setMcpHealths(undefined);
    }
  }, []);

  const onSettingsSaved = useCallback(async () => {
    // Recharge les réglages et re-render immédiatement (équivalent de
    // handleSettingsSaved du front vanilla). Ne touche PAS à settingsOpen :
    // la garde anti-écrasement (tâche #27) est pilotée uniquement par la
    // navigation de page côté App (page === "settings"), pas par la
    // sauvegarde — sinon un poll qui arrive juste après « Enregistrer »,
    // pendant que l'utilisateur est encore sur la page Réglages, pourrait
    // écraser une saisie en cours.
    const data = await fetchSettingsData();
    settingsDataRef.current = data;
    setSettingsData(data);
    staleRef.current = false;
    if (snapshotRef.current) commit();
  }, [commit]);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setInterval> | undefined;
    let tickTimer: ReturnType<typeof setInterval> | undefined;
    const isVisible = () => document.visibilityState === "visible";

    const startPolling = () => {
      if (refreshTimer === undefined) {
        refreshTimer = setInterval(() => {
          if (isVisible()) void refresh();
        }, REFRESH_INTERVAL_MS);
      }
    };
    const stopPolling = () => {
      if (refreshTimer !== undefined) {
        clearInterval(refreshTimer);
        refreshTimer = undefined;
      }
    };
    const startTick = () => {
      if (tickTimer === undefined) tickTimer = setInterval(displayTick, DISPLAY_TICK_INTERVAL_MS);
    };
    const stopTick = () => {
      if (tickTimer !== undefined) {
        clearInterval(tickTimer);
        tickTimer = undefined;
      }
    };

    const onVisibilityChange = () => {
      if (isVisible()) {
        // Fenêtre redevenue visible (ouverture depuis le tray) : refresh
        // immédiat + réactivation des timers coupés pendant qu'elle était cachée.
        void refresh();
        startPolling();
        startTick();
      } else {
        stopPolling();
        stopTick();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void refresh();
    if (isVisible()) {
      startPolling();
      startTick();
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopPolling();
      stopTick();
    };
  }, [refresh, displayTick]);

  return {
    phase,
    snapshot,
    settingsData,
    staleError,
    nowIso: new Date(now).toISOString(),
    mcpHealths,
    onCheckMcps: () => void onCheckMcps(),
    onSettingsSaved: () => void onSettingsSaved(),
    settingsOpen,
    setSettingsOpen,
    activeTab,
    setActiveTab,
  };
}
