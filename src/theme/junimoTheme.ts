// Copyright (c) Junimo — thème Astryx custom (tâche #26).
//
// Thème clean/tech dérivé du thème neutral d'Astryx (@astryxdesign/theme-neutral,
// grayscale sobre + typo Figtree + dark mode natif). On garde tout l'excellent
// travail de neutral (backgrounds Figma-style, ombres, palette catégorielle,
// contrastes AA) et on ne personnalise QUE l'identité :
//
//   - accent teal qui « répond » au vert du junimo sans le concurrencer
//     (analogue plus froid/tech, calme, jamais criard) ;
//   - anneaux de focus/sélection retintés sur l'accent (au lieu du bleu #0074e2) ;
//   - radius légèrement resserrés (plus net, moins « bulle ») ;
//   - motion plus snappy (feeling app native de barre de menu).
//
// La typographie du DS (Figtree corps+titres, mono pour le code/les données)
// est héritée de neutral via `extends`. Le pixel art reste réservé au junimo.
//
// Construit en CSS via `npx astryx theme build src/theme/junimoTheme.ts -o
// src/theme/junimo.theme.css` (voir package.json > scripts.theme). Le CSS est
// portée par l'attribut `data-astryx-theme="junimo"` posé sur <html> (main.tsx).

import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";

export const junimoTheme = defineTheme({
  name: "junimo",
  extends: neutralTheme,

  // Snappy, sobre — un cran plus vif que neutral pour un ressenti d'app native.
  motion: { fast: 110, medium: 240, slow: 600, ratio: 0.8 },

  tokens: {
    // -----------------------------------------------------------------------
    // Accent teal — l'unique couleur de marque. Mid-tone lisible sur les deux
    // fonds ; texte blanc dessus dans les deux modes (bouton primaire, focus,
    // sélection). Répond au vert HSL(128) du junimo par une teinte plus froide
    // (~H185) : harmonie analogue, contraste net.
    // -----------------------------------------------------------------------
    "--color-accent": ["#0d8b7d", "#2dd4bf"],
    "--color-accent-muted": ["#e3f5f1", "#134e48"],
    "--color-on-accent": "#ffffff",
    "--color-text-accent": ["#0f766e", "#5eead4"],
    "--color-icon-accent": ["#0f766e", "#5eead4"],

    // Anneaux d'interaction retintés sur l'accent (neutral les codait en bleu
    // #0074e2 : hover/selected des inputs, swatches, cartes sélectionnables).
    "--shadow-inset-hover": "inset 0 0 0 2px #14b8a640",
    "--shadow-inset-selected": "inset 0 0 0 2px #14b8a680",

    // -----------------------------------------------------------------------
    // Radius — resserrés d'un cran vs neutral (net/tech plutôt que « bulle »).
    // -----------------------------------------------------------------------
    "--radius-inner": "0.375rem",
    "--radius-element": "0.5rem",
    "--radius-container": "0.625rem",
    "--radius-page": "1.25rem",
  },
});
