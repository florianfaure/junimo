import { createRoot } from "react-dom/client";
import { registerIcons } from "@astryxdesign/core/Icon";
import "@astryxdesign/core/reset.css";
import "./theme/junimo.theme.css";
import "./styles.css";
import { junimoTheme } from "./theme/junimoTheme";
import { App } from "./App";

// Le CSS built ne transporte que les tokens : le jeu d'icônes du thème
// (Lucide, hérité de neutralTheme) doit être poussé au registre global,
// sinon Icon retombe sur les SVG génériques d'Astryx.
if (junimoTheme.icons) registerIcons(junimoTheme.icons);

// Le thème custom (tâche #26) est un thème Astryx « built » : son CSS est porté
// par l'attribut data-astryx-theme sur un ancêtre. On le pose sur <html> (et pas
// sur #app) pour que les portails Astryx (popovers, tooltips, dialogs rendus en
// fin de <body>) héritent eux aussi des tokens.
const root = document.documentElement;
root.setAttribute("data-astryx-theme", "junimo");

// Apparence (tâche #40) : le thème ne suit plus le système — light est le
// défaut prioritaire, posé tout de suite (avant le 1er paint, pour éviter un
// flash) ; `App` réapplique l'apparence persistée (réglage "Apparence", voir
// AppSettings.appearance) dès que `get_settings` répond (useOverlayData).
root.setAttribute("data-theme", "light");

// `?theme=light|dark` force un mode : deep-link de dev/QA et capture d'écran
// des deux rendus (aucun effet en usage normal, sans le paramètre) —
// prioritaire sur l'apparence persistée, voir App.tsx.
const forcedTheme = new URLSearchParams(location.search).get("theme");
if (forcedTheme === "light" || forcedTheme === "dark") {
  root.setAttribute("data-theme", forcedTheme);
}

const container = document.getElementById("app");
if (container) {
  createRoot(container).render(<App />);
}
