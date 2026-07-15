import { useEffect, useState } from "react";
import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { isTauri, useOverlayData } from "./hooks/useOverlayData";
import { Header } from "./components/Header";
import { Gauges } from "./components/Gauges";
import { History } from "./components/History";
import { Projects } from "./components/Projects";
import { Mcps } from "./components/Mcps";
import { SettingsPage } from "./components/SettingsPage";
import { JunimoEditorPage } from "./components/JunimoEditorPage";

/**
 * Page courante de l'overlay (routing interne léger, tâche #27 — pas de lib
 * de routing, juste un état) :
 *  - "home" : jauges, historique, projets, MCPs ;
 *  - "settings" : réglages (ex-SettingsFooter) + section Compte, page dédiée
 *    atteinte via l'icône réglages du header ;
 *  - "junimo-editor" : personnalisation du junimo (forme/couleur/accessoire/
 *    nom, tâche #33), atteinte via le clic sur le junimo du header.
 */
type Page = "home" | "settings" | "junimo-editor";

/**
 * Page initiale : "home" par défaut, surchargeable par `?page=settings|
 * junimo-editor` — deep-link de dev/QA et capture d'écran des pages internes
 * (sans effet en usage normal, sans le paramètre).
 */
function initialPage(): Page {
  const p = new URLSearchParams(location.search).get("page");
  return p === "settings" || p === "junimo-editor" ? p : "home";
}

/** État de chargement (avant réception du 1er snapshot). */
function LoadingView() {
  return (
    <div className="app-shell">
      <VStack style={{ height: "100%" }} justify="center" align="center" gap={3}>
        <div className="junimo-idle pixelated" role="img" aria-label="Junimo" />
        <Text type="supporting">chargement…</Text>
      </VStack>
    </div>
  );
}

/** État d'erreur plein écran (get_snapshot échoue avant toute réception). */
function ErrorView() {
  return (
    <div className="app-shell">
      <VStack style={{ height: "100%", padding: 16 }} justify="center" align="center">
        <EmptyState title="Connexion impossible" description="impossible de lire les données Claude" />
      </VStack>
    </div>
  );
}

export function App() {
  const [page, setPage] = useState<Page>(initialPage);
  const {
    phase,
    snapshot,
    settingsData,
    staleError,
    nowIso,
    mcpHealths,
    onCheckMcps,
    onSettingsSaved,
    setSettingsOpen,
    mcpsOpen,
    setMcpsOpen,
    projectsOpen,
    setProjectsOpen,
  } = useOverlayData();

  // Apparence (tâche #40) : dès que les réglages sont chargés, réapplique
  // l'apparence persistée sur <html> (main.tsx pose "light" par défaut avant
  // le 1er paint). `?theme=` (deep-link dev/QA, cf. main.tsx) reste
  // prioritaire : on ne l'écrase pas ici.
  useEffect(() => {
    if (!settingsData) return;
    const forcedTheme = new URLSearchParams(location.search).get("theme");
    if (forcedTheme === "light" || forcedTheme === "dark") return;
    document.documentElement.setAttribute("data-theme", settingsData.settings.appearance);
  }, [settingsData]);

  if (phase === "error") return <ErrorView />;
  if (phase === "loading" || !snapshot || !settingsData) return <LoadingView />;

  // Recalculés à chaque render : referenceIso = génération du snapshot ;
  // nowIso vient du tick (fait vivre le compte à rebours des jauges).
  const referenceIso = snapshot.meta?.generated_at ?? new Date().toISOString();
  const degraded = new Set(snapshot.meta?.degraded ?? []);

  // La garde anti-écrasement (settingsOpenRef dans useOverlayData) suit la
  // page affichée : elle s'active à l'entrée sur Réglages et se désactive au
  // retour, indépendamment d'un éventuel enregistrement entre-temps.
  function openSettings() {
    setSettingsOpen(true);
    setPage("settings");
  }
  function goHome() {
    setSettingsOpen(false);
    setPage("home");
  }
  function openJunimoEditor() {
    // Même garde anti-écrasement que Réglages (settingsOpenRef dans
    // useOverlayData) : évite qu'un refresh de fond ne vienne perturber une
    // édition en cours sur la page junimo, quand bien même `settingsData`
    // n'est aujourd'hui rechargé que sur `onSaved`.
    setSettingsOpen(true);
    setPage("junimo-editor");
  }

  if (page === "settings") {
    return (
      <SettingsPage
        snapshot={snapshot}
        data={settingsData}
        isTauri={isTauri}
        onBack={goHome}
        onSaved={onSettingsSaved}
      />
    );
  }

  if (page === "junimo-editor") {
    return (
      <JunimoEditorPage
        data={settingsData}
        isTauri={isTauri}
        onBack={goHome}
        onSaved={onSettingsSaved}
      />
    );
  }

  return (
    <div className="app-shell">
      <VStack gap={2} padding={3}>
        <Header
          staleError={staleError}
          junimo={settingsData.settings.junimo}
          onOpenSettings={openSettings}
          onOpenJunimoEditor={openJunimoEditor}
        />
        <Gauges gauges={snapshot.gauges} degraded={degraded.has("gauges")} referenceIso={referenceIso} nowIso={nowIso} />
        <History history={snapshot.history} />
        <Projects projects={snapshot.projects} referenceIso={referenceIso} isOpen={projectsOpen} onOpenChange={setProjectsOpen} />
        <Mcps mcps={snapshot.mcps} degraded={degraded.has("mcps")} healths={mcpHealths} onCheck={onCheckMcps} isOpen={mcpsOpen} onOpenChange={setMcpsOpen} />
      </VStack>
    </div>
  );
}
