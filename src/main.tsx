import { createRoot } from "react-dom/client";
import "@astryxdesign/core/reset.css";
import "./theme/junimo.theme.css";
import "./styles.css";
import { App } from "./App";

// Le thème custom (tâche #26) est un thème Astryx « built » : son CSS est porté
// par l'attribut data-astryx-theme sur un ancêtre. On le pose sur <html> (et pas
// sur #app) pour que les portails Astryx (popovers, tooltips, dialogs rendus en
// fin de <body>) héritent eux aussi des tokens.
const root = document.documentElement;
root.setAttribute("data-astryx-theme", "junimo");

// Sans data-theme, `color-scheme: light dark` (reset Astryx) fait suivre
// l'apparence système via light-dark() — comportement voulu pour l'overlay.
// `?theme=light|dark` force un mode : deep-link de dev/QA et capture d'écran
// des deux rendus (aucun effet en usage normal, sans le paramètre).
const forcedTheme = new URLSearchParams(location.search).get("theme");
if (forcedTheme === "light" || forcedTheme === "dark") {
  root.setAttribute("data-theme", forcedTheme);
}

const container = document.getElementById("app");
if (container) {
  createRoot(container).render(<App />);
}
