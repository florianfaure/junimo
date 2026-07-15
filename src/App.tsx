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
import { Tabs } from "./components/Tabs";
import type { TabId } from "./hooks/useOverlayData";

/**
 * Icônes des onglets de la nav (tâche #42). Le registre sémantique Astryx
 * n'expose ni jauge, ni bulle, ni dossier, ni puce (cf. Icon/globalIconRegistry) :
 * on fournit des SVG inline monochromes 14px, contour `currentColor` (hérite
 * de la couleur du libellé — texte secondaire au repos, primaire à l'actif),
 * dans le même style de trait fin arrondi que le crayon du header.
 */
const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  xmlns: "http://www.w3.org/2000/svg",
};

/** Usage → jauge (demi-cercle + aiguille). */
const UsageIcon = (
  <svg {...iconProps}>
    <path d="M2.5 11a5.5 5.5 0 0 1 11 0" />
    <path d="M8 11l2.5-3" />
  </svg>
);

/** Chats → bulle de conversation. */
const ChatsIcon = (
  <svg {...iconProps}>
    <path d="M2.5 4.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H6l-3 2.5V10.5H3.5a1 1 0 0 1-1-1z" />
  </svg>
);

/** Projects → dossier. */
const ProjectsIcon = (
  <svg {...iconProps}>
    <path d="M2.5 4.5a1 1 0 0 1 1-1h2.5l1.5 1.5h5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
  </svg>
);

/** System → puce/CPU. */
const SystemIcon = (
  <svg {...iconProps}>
    <rect x="5" y="5" width="6" height="6" rx="0.5" />
    <path d="M6.5 2.5v1.5M9.5 2.5v1.5M6.5 12v1.5M9.5 12v1.5M2.5 6.5H4M2.5 9.5H4M12 6.5h1.5M12 9.5h1.5" />
  </svg>
);

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
    activeTab,
    setActiveTab,
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
        {/* Nav en tabs sous le Header (tâche #42) : remplace l'empilement des
            sections. Chaque onglet porte le contenu de l'ancienne section. */}
        <Tabs
          active={activeTab}
          onChange={(id) => setActiveTab(id as TabId)}
          items={[
            {
              id: "usage",
              label: "Usage",
              icon: UsageIcon,
              content: (
                <Gauges gauges={snapshot.gauges} degraded={degraded.has("gauges")} referenceIso={referenceIso} nowIso={nowIso} />
              ),
            },
            {
              id: "chats",
              label: "Chats",
              icon: ChatsIcon,
              content: (
                <History history={snapshot.history} chats={snapshot.chats} referenceIso={referenceIso} />
              ),
            },
            {
              id: "projects",
              label: "Projects",
              icon: ProjectsIcon,
              content: <Projects projects={snapshot.projects} referenceIso={referenceIso} />,
            },
            {
              id: "system",
              label: "System",
              icon: SystemIcon,
              content: (
                <Mcps
                  mcps={snapshot.mcps}
                  degraded={degraded.has("mcps")}
                  healths={mcpHealths}
                  onCheck={onCheckMcps}
                  meta={snapshot.meta}
                  cliVersion={snapshot.account.cli_version}
                  defaultModel={snapshot.account.default_model}
                />
              ),
            },
          ]}
        />
      </VStack>
    </div>
  );
}
