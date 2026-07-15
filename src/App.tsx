import { useState } from "react";
import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { isTauri, useOverlayData } from "./hooks/useOverlayData";
import { Header } from "./components/Header";
import { Gauges } from "./components/Gauges";
import { History } from "./components/History";
import { Projects } from "./components/Projects";
import { Mcps } from "./components/Mcps";
import { Account } from "./components/Account";
import { SettingsFooter } from "./components/SettingsFooter";

/**
 * Page courante de l'overlay. Aujourd'hui `home` seule ; la tâche #27
 * (navigation) ajoutera "settings" et "junimo-editor".
 */
type Page = "home";

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
  const [page] = useState<Page>("home");
  const {
    phase,
    snapshot,
    settingsData,
    staleError,
    nowIso,
    mcpHealths,
    onCheckMcps,
    onSettingsSaved,
    settingsOpen,
    setSettingsOpen,
    mcpsOpen,
    setMcpsOpen,
    projectsOpen,
    setProjectsOpen,
  } = useOverlayData();

  if (phase === "error") return <ErrorView />;
  if (phase === "loading" || !snapshot || !settingsData) return <LoadingView />;

  // Recalculés à chaque render : referenceIso = génération du snapshot ;
  // nowIso vient du tick (fait vivre le compte à rebours des jauges).
  const referenceIso = snapshot.meta?.generated_at ?? new Date().toISOString();
  const degraded = new Set(snapshot.meta?.degraded ?? []);

  if (page === "home") {
    return (
      <div className="app-shell">
        <VStack gap={2} padding={3}>
          <Header staleError={staleError} />
          <Gauges gauges={snapshot.gauges} degraded={degraded.has("gauges")} referenceIso={referenceIso} nowIso={nowIso} />
          <History history={snapshot.history} />
          <Projects projects={snapshot.projects} referenceIso={referenceIso} isOpen={projectsOpen} onOpenChange={setProjectsOpen} />
          <Mcps mcps={snapshot.mcps} degraded={degraded.has("mcps")} healths={mcpHealths} onCheck={onCheckMcps} isOpen={mcpsOpen} onOpenChange={setMcpsOpen} />
          <Account account={snapshot.account} degraded={degraded.has("account")} />
          <SettingsFooter
            snapshot={snapshot}
            data={settingsData}
            isTauri={isTauri}
            isOpen={settingsOpen}
            onOpenChange={setSettingsOpen}
            onSaved={onSettingsSaved}
          />
        </VStack>
      </div>
    );
  }

  return null;
}
