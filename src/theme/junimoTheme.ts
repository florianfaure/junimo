// Copyright (c) Junimo — thème Astryx custom (tâche #26, refonte monochrome #41).
//
// Thème « très tech » monochrome dérivé du thème neutral d'Astryx
// (@astryxdesign/theme-neutral). On garde toute la charpente de neutral (typo
// Figtree + mono, échelle d'espacements, ombres, composants, contrastes AA) et
// on RÉÉCRIT intégralement la palette couleur pour un rendu monochrome dense :
//
//   - une seule famille de neutres (variantes de blanc / gris / noir), JAMAIS
//     de blanc (#fff) ni de noir (#000) purs — ni en light ni en dark ;
//   - l'ancien accent teal devient un gris (le « gris d'action » : boutons
//     primaires, anneaux de focus, sélection, texte accent) ;
//   - AUCUNE autre couleur dans l'UI : les tokens catégoriels (red, orange,
//     yellow, green, teal, cyan, blue, purple, pink, gray) et la coloration
//     syntaxique sont rabattus sur la rampe de gris ;
//   - SEULES les jauges conservent une teinte ok / warn / alert, mais très
//     désaturée et subtile (cf. --color-success/-warning/-error + les alias
//     --color-gauge-* de styles.css, injectés dans les ProgressBar).
//
// -------------------------------------------------------------------------
// Élimination de `light-dark()` (dette #36 — baseline macOS 13.3 / Safari 16.4,
// le moteur WKWebView cible ne supporte pas la fonction CSS `light-dark()`) :
// le thème neutral hérité émettait ~91 `light-dark()` dans le CSS généré (via
// `extends`). Comme on redéfinit de toute façon toute la palette, on surcharge
// ICI chaque token couleur hérité par une valeur MONOCHROME en **chaîne simple**
// (une seule valeur, donc pas de `light-dark()` au build). Deux techniques :
//
//   1. Tokens « fondation » (backgrounds, textes, bordures, ombres, statuts) :
//      valeur LIGHT en dur ici + override DARK posé en dur dans src/styles.css
//      sous `[data-theme="dark"]` (règle hors `@layer`, prioritaire — même
//      mécanique que la tâche #40).
//   2. Tokens « dérivés » (icônes, on-*, catégoriels, syntaxe) : pointés en
//      `var(--token-fondation)` déjà sensible au mode → une seule déclaration,
//      aucune duplication dark, toujours zéro `light-dark()`.
//
// Résultat visé : 0 `light-dark()` dans src/theme/junimo.theme.css.
// -------------------------------------------------------------------------
//
// Densité : radius resserrés + motion snappy (feeling app native de barre de
// menu). Les tailles/paddings « small » des composants sont pilotés côté React
// (props size) ; le thème fournit la palette et les radius serrés.
//
// Source de vérité UNIQUE de la palette : ce fichier. Construit en CSS via
// `npx astryx theme build src/theme/junimoTheme.ts --out src/theme/junimo.theme.css`
// (package.json > scripts.theme). Le CSS généré ne s'édite JAMAIS à la main ;
// il est porté par l'attribut `data-astryx-theme="junimo"` posé sur <html>
// (main.tsx). Les tokens hors thème (alias jauges, chart-peak) et les overrides
// dark vivent dans src/styles.css.

import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";

// -------------------------------------------------------------------------
// Rampe de neutres — légèrement froide (bleu-gris) pour un ressenti « tech »,
// aucune valeur pure. Référencée ci-dessous ; les valeurs dark correspondantes
// sont dans src/styles.css sous [data-theme="dark"] (garder les deux en phase).
//
//   LIGHT                          DARK (styles.css)
//   ink   #1b1c1f  (texte primaire / near-black)   #f3f3f4 (off-white)
//   slate #33353b  (accent = gris d'action)         #d7d8dc
//   gray6 #61636b  (texte secondaire)               #9fa1a9
//   gray4 #a2a4ad  (texte désactivé)                #5a5c64
//   line  #e3e5e9  (bordure)                         #2c2d31
//   line2 #cdcfd6  (bordure appuyée)                 #42444b
//   mute  #eceef1  (surface atténuée)                #202124
//   body  #f2f3f5  (fond de page)                    #161719
//   surf  #fbfbfc  (surface / carte, off-white)      #232427 / #1c1d20
// -------------------------------------------------------------------------

export const junimoTheme = defineTheme({
  name: "junimo",
  extends: neutralTheme,

  // Snappy, sobre — un cran plus vif que neutral pour un ressenti d'app native.
  motion: { fast: 110, medium: 240, slow: 600, ratio: 0.8 },

  // Densité — on resserre l'échelle typographique d'un cran (base 14→13 px)
  // pour une UI plus dense, façon barre de menu macOS. On reprend le MÊME
  // ratio 1.2 que neutral : l'échelle reste harmonieuse, juste plus compacte.
  // On ne redéclare ni familles ni graisses → `extends: neutralTheme` les
  // conserve (Figtree corps+titres, mono pour code/données), seul le sizing
  // change (aucune couleur, aucun `light-dark()` ici).
  typography: { scale: { base: 13, ratio: 1.2 } },

  tokens: {
    // =====================================================================
    // FONDATION — valeurs LIGHT en dur (override DARK dans styles.css).
    // =====================================================================

    // Backgrounds — off-white pour les surfaces (jamais #fff), fond de page
    // en gris clair pour détacher les cartes.
    "--color-background-body": "#f2f3f5",
    "--color-background-surface": "#fbfbfc",
    "--color-background-card": "#fbfbfc",
    "--color-background-popover": "#fbfbfc",
    "--color-background-muted": "#eceef1",

    // Textes — near-black (jamais #000) → gris moyen → gris clair.
    "--color-text-primary": "#1b1c1f",
    "--color-text-secondary": "#61636b",
    "--color-text-disabled": "#a2a4ad",

    // Bordures + squelette de chargement.
    "--color-border": "#e3e5e9",
    "--color-border-emphasized": "#cdcfd6",
    "--color-skeleton": "#e3e5e9",

    // Tints translucides (hover/pressed/scrim) — dérivés du near-black, jamais
    // du noir pur. Alpha en suffixe hexa (0f≈6 %, 0d≈5 %, 1a≈10 %, 80≈50 %).
    "--color-neutral": "#1b1c1f0f",
    "--color-overlay": "#1b1c1f80",
    "--color-overlay-hover": "#1b1c1f0d",
    "--color-overlay-pressed": "#1b1c1f1a",
    "--color-shadow": "#1b1c1f1a",
    "--color-tint-hover": "#1b1c1f",

    // Contenu sur surface inversée (MediaTheme : tooltip/toast sombre en light,
    // popover clair en dark). Tokens FIXES chez neutral, codés en #ffffff pur
    // (proscrit) : on repasse sur nos neutres extrêmes off-white / near-black.
    // Fixes = mêmes valeurs dans les deux modes (pas d'override dark).
    "--color-on-dark": "#fbfbfc",
    "--color-on-light": "#1b1c1f",

    // =====================================================================
    // ACCENT — l'ancien teal de marque devient le « gris d'action » : bouton
    // primaire, anneau de focus, sélection, texte/icône accent. Contraste net,
    // zéro chroma. LIGHT = gris ardoise foncé sur fond clair ; DARK inversé
    // (styles.css).
    // =====================================================================
    "--color-accent": "#33353b",
    "--color-accent-muted": "#e7e8ec",
    "--color-on-accent": "#fbfbfc",
    "--color-text-accent": "#33353b",
    "--color-icon-accent": "#33353b",

    // =====================================================================
    // JAUGES — SEULE couleur tolérée dans l'UI, très désaturée. Ces tokens
    // sémantiques pilotent la pastille StatusDot (var(--color-success)…) et le
    // texte des Badge de statut. Le remplissage des ProgressBar passe par les
    // alias --color-gauge-* (styles.css) via l'override `components.progressbar`
    // ci-dessous (on ne peut pas y auto-référencer --color-success sans cycle).
    // Muted = fond de badge très pâle et neutre-teinté.
    // =====================================================================
    "--color-success": "#5c7a63", // vert sauge éteint
    "--color-warning": "#8a7345", // ocre éteint
    "--color-error": "#9e5c5c", // brique éteint
    "--color-success-muted": "#e7ece8",
    "--color-warning-muted": "#efe9dc",
    "--color-error-muted": "#efe2e2",

    // Texte sur aplat de statut — pointé sur la carte (near-white en light /
    // near-black en dark) : donne automatiquement le bon contraste sur nos
    // aplats mi-tons quel que soit le mode, sans dupliquer de valeur dark.
    "--color-on-success": "var(--color-background-card)",
    "--color-on-error": "var(--color-background-card)",
    "--color-on-warning": "var(--color-background-card)",

    // =====================================================================
    // DÉRIVÉS mode-aware (var → aucune valeur dark à dupliquer, zéro light-dark).
    // =====================================================================

    // Icônes = mêmes valeurs que les textes correspondants.
    "--color-icon-primary": "var(--color-text-primary)",
    "--color-icon-secondary": "var(--color-text-secondary)",
    "--color-icon-disabled": "var(--color-text-disabled)",

    // Coloration syntaxique rabattue sur la rampe de gris (le code, s'il est
    // affiché, reste monochrome). Emphase → primaire, corps → secondaire,
    // décor → désactivé, fond → surface atténuée.
    "--color-syntax-keyword": "var(--color-text-primary)",
    "--color-syntax-type": "var(--color-text-primary)",
    "--color-syntax-tag": "var(--color-text-primary)",
    "--color-syntax-function": "var(--color-text-primary)",
    "--color-syntax-variable": "var(--color-text-primary)",
    "--color-syntax-string": "var(--color-text-secondary)",
    "--color-syntax-number": "var(--color-text-secondary)",
    "--color-syntax-constant": "var(--color-text-secondary)",
    "--color-syntax-attribute": "var(--color-text-secondary)",
    "--color-syntax-property": "var(--color-text-secondary)",
    "--color-syntax-comment": "var(--color-text-disabled)",
    "--color-syntax-operator": "var(--color-text-disabled)",
    "--color-syntax-punctuation": "var(--color-text-disabled)",
    "--color-syntax-background": "var(--color-background-muted)",

    // Tokens catégoriels rabattus sur les neutres : plus AUCUN aplat coloré
    // dans l'UI (badges neutral/red/…/gray, switch, chart-peak). Fond → muted,
    // bordure → border, icône → secondaire, texte → secondaire.
    "--color-background-red": "var(--color-background-muted)",
    "--color-background-orange": "var(--color-background-muted)",
    "--color-background-yellow": "var(--color-background-muted)",
    "--color-background-green": "var(--color-background-muted)",
    "--color-background-teal": "var(--color-background-muted)",
    "--color-background-cyan": "var(--color-background-muted)",
    "--color-background-blue": "var(--color-background-muted)",
    "--color-background-purple": "var(--color-background-muted)",
    "--color-background-pink": "var(--color-background-muted)",
    "--color-background-gray": "var(--color-background-muted)",
    "--color-border-red": "var(--color-border)",
    "--color-border-orange": "var(--color-border)",
    "--color-border-yellow": "var(--color-border)",
    "--color-border-green": "var(--color-border)",
    "--color-border-teal": "var(--color-border)",
    "--color-border-cyan": "var(--color-border)",
    "--color-border-blue": "var(--color-border)",
    "--color-border-purple": "var(--color-border)",
    "--color-border-pink": "var(--color-border)",
    "--color-border-gray": "var(--color-border)",
    "--color-icon-red": "var(--color-icon-secondary)",
    "--color-icon-orange": "var(--color-icon-secondary)",
    "--color-icon-yellow": "var(--color-icon-secondary)",
    "--color-icon-green": "var(--color-icon-secondary)",
    "--color-icon-teal": "var(--color-icon-secondary)",
    "--color-icon-cyan": "var(--color-icon-secondary)",
    "--color-icon-blue": "var(--color-icon-secondary)",
    "--color-icon-purple": "var(--color-icon-secondary)",
    "--color-icon-pink": "var(--color-icon-secondary)",
    "--color-icon-gray": "var(--color-icon-secondary)",
    "--color-text-red": "var(--color-text-secondary)",
    "--color-text-orange": "var(--color-text-secondary)",
    "--color-text-yellow": "var(--color-text-secondary)",
    "--color-text-green": "var(--color-text-secondary)",
    "--color-text-teal": "var(--color-text-secondary)",
    "--color-text-cyan": "var(--color-text-secondary)",
    "--color-text-blue": "var(--color-text-secondary)",
    "--color-text-purple": "var(--color-text-secondary)",
    "--color-text-pink": "var(--color-text-secondary)",
    "--color-text-gray": "var(--color-text-secondary)",

    // =====================================================================
    // OMBRES — valeurs LIGHT en dur (override DARK dans styles.css). On quitte
    // les `oklch(... )` + `light-dark()` de neutral pour des rgba d'un
    // near-black (jamais noir pur) : douces et discrètes en light.
    // =====================================================================
    "--shadow-low": "0 1px 2px #1b1c1f14, 0 1px 3px #1b1c1f0f",
    "--shadow-med": "0 2px 4px #1b1c1f14, 0 4px 10px #1b1c1f14",
    "--shadow-high": "0 6px 12px #1b1c1f1f, 0 12px 28px #1b1c1f24",

    // Anneaux internes (focus/sélection/validation d'inputs) — retintés sur le
    // gris d'action et sur les teintes de jauge désaturées. Chaînes simples
    // identiques dans les deux modes (l'alpha les garde subtils partout).
    "--shadow-inset-hover": "inset 0 0 0 2px #33353b40",
    "--shadow-inset-selected": "inset 0 0 0 2px #33353b80",
    "--shadow-inset-success": "inset 0 0 0 2px #5c7a6366",
    "--shadow-inset-warning": "inset 0 0 0 2px #8a734566",
    "--shadow-inset-error": "inset 0 0 0 2px #9e5c5c66",

    // =====================================================================
    // RADIUS — resserrés d'un cran vs neutral (net/tech plutôt que « bulle »),
    // au service de la densité.
    // =====================================================================
    "--radius-inner": "0.375rem",
    "--radius-element": "0.5rem",
    "--radius-container": "0.625rem",
    "--radius-page": "1.25rem",
  },

  // =======================================================================
  // COMPOSANTS — neutralisation des couleurs codées EN DUR par neutral dans le
  // CSS de composant (que les overrides de tokens ne peuvent pas atteindre).
  // C'est ici qu'on supprime les dernières `light-dark()` (badge info/success/
  // error) et les aplats vifs des barres de progression.
  // =======================================================================
  components: {
    badge: {
      // neutral codait ces variantes en `light-dark(#…, #…)` (aplat plein +
      // texte blanc). On repasse en style « soft » monochrome/désaturé : fond
      // muted + texte teinté, via tokens sensibles au mode → plus de light-dark.
      "variant:info": {
        backgroundColor: "var(--color-background-muted)",
        color: "var(--color-text-secondary)",
      },
      "variant:success": {
        backgroundColor: "var(--color-success-muted)",
        color: "var(--color-success)",
      },
      "variant:warning": {
        backgroundColor: "var(--color-warning-muted)",
        color: "var(--color-warning)",
      },
      "variant:error": {
        backgroundColor: "var(--color-error-muted)",
        color: "var(--color-error)",
      },
    },
    progressbar: {
      // neutral forçait localement --color-{accent,success,warning,error} à des
      // valeurs VIVES pour le remplissage. On les rebranche : accent → gris
      // secondaire ; statuts → alias --color-gauge-* (styles.css) qui portent
      // la teinte désaturée par mode. On passe par ces alias (et non
      // var(--color-success)) pour éviter l'auto-référence circulaire : ici on
      // REDÉFINIT --color-success, s'y référer se mordrait la queue.
      "variant:accent": { "--color-accent": "var(--color-icon-secondary)" },
      "variant:success": { "--color-success": "var(--color-gauge-ok)" },
      "variant:warning": { "--color-warning": "var(--color-gauge-warn)" },
      "variant:error": { "--color-error": "var(--color-gauge-alert)" },
    },
  },
});
