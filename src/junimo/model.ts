/**
 * Junimo pixel-art model — framework-agnostic, DOM-free.
 *
 * The junimo is drawn on a fixed 32×32 pixel grid. Bodies are generated
 * procedurally from a silhouette + role-based shading so that recoloring is a
 * trivial palette swap (each pixel references a *role*, not a literal color).
 * Accessories are compact hand-authored stamps aligned to the same grid.
 *
 * This module has no dependency on the DOM or any framework: it produces raw
 * RGBA pixel buffers. `compose.ts` turns those into an <canvas> for the UI.
 */

export const JUNIMO_GRID = 32;
/** Number of idle-animation frames (0 = rest, 1 = mid-bounce). */
export const JUNIMO_FRAME_COUNT = 2;

export type JunimoShapeId = "classic" | "round" | "star" | "square" | "drop" | "ghost";
/**
 * Pose du junimo. `idle` = posture de repos (petits bras-nubs sur les flancs) ;
 * `celebrate` = bras levés en diagonale au-dessus de la tête (réf. 2 de Florian,
 * consommée par la machine à états de la tâche #49). La pose ne change que les
 * membres : le visage, la tige et le corps restent identiques.
 */
export type JunimoPose = "idle" | "celebrate";

/**
 * État d'animation du junimo (machine à états de la tâche #49), piloté par le
 * snapshot via `useJunimoMood` :
 *  - `idle` : repos (petit rebond) — défaut ;
 *  - `run` : une conversation est active → il court (foulée + lignes de vitesse) ;
 *  - `eat` : des tokens viennent d'être consommés → il porte un jeton à la bouche ;
 *  - `play` : variation occasionnelle d'idle → il jongle avec un jeton ;
 *  - `celebrate` : un chat vient de se terminer → pose bras levés, animée ;
 *  - `bored` : rien depuis un moment → il s'assoit, bâille et regarde autour.
 * Chaque mood a son propre nombre de frames (`moodFrameCount`).
 */
export type JunimoMood = "idle" | "run" | "eat" | "play" | "celebrate" | "bored";

/** Nombre de frames par mood (0..n-1, jouées en boucle par `JunimoSprite`). */
const MOOD_FRAME_COUNT: Record<JunimoMood, number> = {
  idle: JUNIMO_FRAME_COUNT,
  run: 4,
  eat: 4,
  play: 4,
  celebrate: 3,
  bored: 4,
};

/** Nombre de frames à jouer pour un mood donné. */
export function moodFrameCount(mood: JunimoMood): number {
  return MOOD_FRAME_COUNT[mood];
}

export type JunimoColorId =
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "coral"
  | "amber"
  | "teal"
  | "orange"
  | "slate"
  | "mint";
export type JunimoAccessoryId =
  | "none"
  | "hat"
  | "bow"
  | "glasses"
  | "flower"
  | "antenna"
  | "crown"
  | "scarf"
  | "cap";

export interface JunimoShapeDef {
  id: JunimoShapeId;
  label: string;
}
export interface JunimoColorDef {
  id: JunimoColorId;
  label: string;
  /** Representative hex (the base tone) — handy for editor swatches. */
  swatch: string;
}
export interface JunimoAccessoryDef {
  id: JunimoAccessoryId;
  label: string;
}

export const JUNIMO_SHAPES: readonly JunimoShapeDef[] = [
  { id: "classic", label: "Classique" },
  { id: "round", label: "Rond" },
  { id: "star", label: "Étoile" },
  { id: "square", label: "Carré" },
  { id: "drop", label: "Goutte" },
  { id: "ghost", label: "Fantôme" },
];

/** Base HSL per color — the ramp (highlight/base/shade/outline) is derived. */
interface HSL {
  h: number;
  s: number;
  l: number;
}
const COLOR_HSL: Record<JunimoColorId, HSL> = {
  // vert Stardew vif (réf. Florian) : base ≈ #37be37 (cible #3dbf3d) — la rampe
  // dérivée donne un highlight pomme clair et une calotte vert foncé profond
  green: { h: 120, s: 55, l: 48 },
  blue: { h: 210, s: 56, l: 54 },
  purple: { h: 268, s: 44, l: 58 },
  pink: { h: 330, s: 64, l: 63 },
  coral: { h: 8, s: 68, l: 58 },
  amber: { h: 42, s: 76, l: 54 },
  teal: { h: 176, s: 48, l: 44 },
  orange: { h: 24, s: 76, l: 54 },
  slate: { h: 214, s: 16, l: 52 },
  mint: { h: 150, s: 46, l: 60 },
};

const COLOR_LABELS: Record<JunimoColorId, string> = {
  green: "Vert",
  blue: "Bleu",
  purple: "Violet",
  pink: "Rose",
  coral: "Corail",
  amber: "Ambre",
  teal: "Sarcelle",
  orange: "Orange",
  slate: "Ardoise",
  mint: "Menthe",
};

export type RGBA = readonly [number, number, number, number];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function hslToRgb(h: number, s: number, l: number): RGBA {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
    255,
  ];
}

function rgbToHex([r, g, b]: RGBA): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** The four body tones derived from a base HSL. */
export interface ColorRamp {
  highlight: RGBA;
  base: RGBA;
  shade: RGBA;
  outline: RGBA;
}

export function rampFor(id: JunimoColorId): ColorRamp {
  const { h, s, l } = COLOR_HSL[id];
  return {
    highlight: hslToRgb(h, clamp(s - 8, 0, 100), clamp(l + 15, 0, 96)),
    base: hslToRgb(h, s, l),
    shade: hslToRgb(h, clamp(s + 4, 0, 100), clamp(l - 15, 0, 100)),
    outline: hslToRgb(h, clamp(s + 8, 0, 100), clamp(l - 32, 0, 100)),
  };
}

export const JUNIMO_COLORS: readonly JunimoColorDef[] = (
  Object.keys(COLOR_HSL) as JunimoColorId[]
).map((id) => ({
  id,
  label: COLOR_LABELS[id],
  swatch: rgbToHex(rampFor(id).base),
}));

export const JUNIMO_ACCESSORIES: readonly JunimoAccessoryDef[] = [
  { id: "none", label: "Aucun" },
  { id: "hat", label: "Chapeau" },
  { id: "bow", label: "Nœud" },
  { id: "glasses", label: "Lunettes" },
  { id: "flower", label: "Fleur" },
  { id: "antenna", label: "Antenne" },
  { id: "crown", label: "Couronne" },
  { id: "scarf", label: "Écharpe" },
  { id: "cap", label: "Casquette" },
];

// Couleurs littérales (non concernées par le palette-swap #32).
// Yeux : deux carrés quasi-noirs PLEINS (trait obligatoire « yeux carrés »,
// la référence n'a pas de point de lumière). Joues : rose doux, identique
// quelle que soit la couleur du corps (comme un blush).
const EYE_DARK: RGBA = [30, 26, 30, 255];
const CHEEK: RGBA = [244, 146, 168, 255];

// Jeton mangé/joué par le junimo (moods eat/play) : petit cube doré avec une
// arête d'ombre bas/droite — littéral, insensible au palette-swap #32.
const TOKEN_FILL: RGBA = [247, 206, 92, 255];
const TOKEN_EDGE: RGBA = [176, 132, 40, 255];
// Étincelles de célébration + « Zzz » d'ennui : littéraux, mêmes quelle que
// soit la couleur du corps.
const SPARKLE: RGBA = [250, 224, 130, 255];
const ZZZ_COL: RGBA = [128, 136, 158, 255];
// Lignes de vitesse (mood run), tracées derrière le corps.
const MOTION: RGBA = [150, 158, 172, 235];

// --- Pixel roles used inside the body role-grid ------------------------------
const R_EMPTY = 0;
const R_OUTLINE = 1;
const R_SHADE = 2;
const R_BASE = 3;
const R_HIGHLIGHT = 4;

/** Per-shape geometry so eyes/feet/accessories land consistently. */
interface ShapeMetrics {
  cx: number;
  cy: number;
  minY: number;
  maxY: number;
  minX: number;
  maxX: number;
  eyeY: number;
  eyeDx: number;
  footY: number;
  footDx: number;
  /** true apex of the silhouette — a hat must cover everything above this */
  headTopY: number;
  /** head surface where the flower's stem lands (off-center, x ≈ cx+3) */
  flowerY: number;
  /** rangée des joues roses (juste sous les yeux) */
  cheekY: number;
  /** rangée de la bouche (sous les joues) */
  mouthY: number;
  /** rangée d'attache des bras (nubs de repos / racine des bras levés) */
  armY: number;
}

type Silhouette = (x: number, y: number, m: ShapeMetrics) => boolean;

// Dimensions du corps classique (réutilisées en partie par `round`).
// La référence est plus large que haute : trapèze arrondi, haut plat,
// nettement évasé vers la base.
const CLASSIC_RX = 11.5; // demi-largeur À LA BASE (le haut est plus étroit)
const CLASSIC_RY = 9.5; // demi-hauteur

// Dimensions des nouvelles formes dérivées (tâche #46) — mêmes constantes
// utilisées par `metricsFor` et par `silhouettes` pour rester synchronisées.
const SQUARE_RX = 10; // demi-largeur du carré à coins arrondis (squircle)
const SQUARE_RY = 9; // demi-hauteur
const SQUARE_N = 5; // exposant de la superellipse (plus grand = coins plus francs)
const DROP_R = 8.5; // rayon du « ventre » arrondi (hémisphère basse)
const DROP_NECK_H = 12; // hauteur du col effilé (de la pointe à l'équateur)
const GHOST_RX = 10; // demi-largeur du dôme et des flancs droits
const GHOST_DOME_R = 10; // rayon du dôme (= GHOST_RX pour un dôme hémisphérique)
const GHOST_SIDE_H = 5; // hauteur des flancs droits sous le dôme
const GHOST_LEG_H = 6; // hauteur de la zone d'ourlet ondulé (jambes/pieds du drap)
const GHOST_LEGS = 3; // nombre de « jambes » de l'ourlet

function metricsFor(shape: JunimoShapeId, bounce: number): ShapeMetrics {
  const G = JUNIMO_GRID;
  const cx = G / 2 - 0.5;
  const cy = G / 2 - 0.5 + bounce;
  switch (shape) {
    case "round": {
      // Variante dérivée : disque plein. Même tête/visage/tige que la classique,
      // seule la silhouette du corps change (cercle parfait au lieu du trapèze).
      const r = 10.5; // un peu sous CLASSIC_RX pour un disque qui respire
      const bodyCy = cy + 0.5;
      const bodyTop = bodyCy - r;
      const bodyBot = bodyCy + r;
      const eyeY = Math.round(bodyTop + (bodyBot - bodyTop) * 0.46);
      return {
        cx,
        cy: bodyCy,
        minX: Math.floor(cx - r),
        maxX: Math.ceil(cx + r),
        minY: Math.round(bodyTop) - 5, // marge pour la tige
        maxY: Math.ceil(bodyBot) + 3,
        eyeY,
        eyeDx: 4,
        footY: Math.round(bodyBot) + 1, // pieds sous la rangée de contour
        footDx: 4,
        headTopY: Math.round(bodyTop),
        flowerY: Math.round(bodyTop),
        cheekY: eyeY + 3,
        mouthY: eyeY + 4,
        armY: eyeY,
      };
    }
    case "star": {
      // Variante dérivée : étoile à 5 branches (pointe en haut). Le visage se
      // pose sur la masse centrale ; la tige coiffe la pointe supérieure.
      const rOut = 12.6;
      const bodyCy = cy + 1;
      // visage remonté sur la masse pleine de l'étoile (sinon joues/bouche
      // débordent sur les branches basses)
      const eyeY = Math.round(bodyCy - 1);
      return {
        cx,
        cy: bodyCy,
        minX: Math.floor(cx - rOut),
        maxX: Math.ceil(cx + rOut),
        minY: Math.round(bodyCy - rOut) - 4,
        maxY: Math.ceil(bodyCy + rOut * 0.85) + 1,
        eyeY,
        eyeDx: 4,
        footY: Math.round(bodyCy + rOut * 0.66),
        footDx: 4,
        // apex de la pointe haute (le corps culmine à bodyCy - rOut)
        headTopY: Math.round(bodyCy - rOut),
        // fleur posée sur le versant haut-droit de la pointe
        flowerY: Math.round(bodyCy - rOut * 0.5),
        cheekY: eyeY + 3,
        mouthY: eyeY + 4,
        armY: eyeY + 1,
      };
    }
    case "square": {
      // Variante dérivée : carré à coins arrondis (squircle). Même tête/visage/
      // tige que la classique ; le haut est quasi plat (comme la classique)
      // grâce à l'exposant élevé de la superellipse.
      const rx = SQUARE_RX;
      const ry = SQUARE_RY;
      const bodyCy = cy + 1;
      const bodyTop = bodyCy - ry;
      const bodyBot = bodyCy + ry;
      const eyeY = Math.round(bodyTop + (bodyBot - bodyTop) * 0.46);
      return {
        cx,
        cy: bodyCy,
        minX: Math.floor(cx - rx),
        maxX: Math.ceil(cx + rx),
        minY: Math.round(bodyTop) - 5,
        maxY: Math.ceil(bodyBot) + 3,
        eyeY,
        eyeDx: 4,
        footY: Math.round(bodyBot) + 2,
        footDx: 4,
        headTopY: Math.round(bodyTop),
        flowerY: Math.round(bodyTop),
        cheekY: eyeY + 3,
        mouthY: eyeY + 4,
        armY: eyeY,
      };
    }
    case "drop": {
      // Variante dérivée : goutte d'eau — ventre arrondi (hémisphère basse,
      // comme `round`) surmonté d'un col effilé qui se referme en pointe
      // fine (raccord tangent : le col rejoint l'équateur du ventre à
      // largeur et pente égales, pas de cassure visible). La tige se pose sur
      // la pointe fine, comme pour la classique/l'étoile.
      const r = DROP_R;
      const beltCy = Math.round(cy + 3); // centre du ventre (cercle)
      const bodyTop = beltCy - DROP_NECK_H; // pointe fine
      const bodyBot = beltCy + r; // bas du ventre
      // yeux légèrement au-dessus de l'équateur, dans le ventre (large)
      const eyeY = beltCy - 1;
      return {
        cx,
        cy: beltCy,
        minX: Math.floor(cx - r),
        maxX: Math.ceil(cx + r),
        minY: bodyTop - 5,
        maxY: Math.ceil(bodyBot) + 3,
        eyeY,
        eyeDx: 4,
        footY: Math.round(bodyBot) + 1,
        footDx: 4,
        headTopY: bodyTop, // pointe fine (sommet de la goutte)
        flowerY: bodyTop,
        cheekY: eyeY + 3,
        mouthY: eyeY + 4,
        armY: eyeY,
      };
    }
    case "ghost": {
      // Variante dérivée : fantôme — dôme arrondi en haut, flancs droits, puis
      // un ourlet ondulé (3 « jambes ») en bas. La tige coiffe l'apex du dôme.
      const domeR = GHOST_DOME_R;
      const bodyCy = cy + 1;
      const bodyTop = bodyCy - domeR; // apex du dôme
      const domeCy = bodyTop + domeR;
      const hemBase = domeCy + GHOST_SIDE_H; // ligne de creux de l'ourlet
      const bodyBot = hemBase + GHOST_LEG_H; // pointe des jambes
      // visage sur les flancs droits, sous l'équateur du dôme (arrondi :
      // toutes les coordonnées de traits doivent être des entiers pixel)
      const eyeY = Math.round(domeCy + 2);
      return {
        cx,
        cy: bodyCy,
        minX: Math.floor(cx - GHOST_RX),
        maxX: Math.ceil(cx + GHOST_RX),
        minY: Math.round(bodyTop) - 5,
        maxY: Math.ceil(bodyBot) + 3,
        eyeY,
        eyeDx: 4,
        footY: Math.round(bodyBot) + 2,
        footDx: 4,
        headTopY: Math.round(bodyTop),
        flowerY: Math.round(bodyTop),
        cheekY: eyeY + 3,
        mouthY: eyeY + 4,
        armY: eyeY,
      };
    }
    case "classic":
    default: {
      // Forme canonique (réf. Florian) : trapèze arrondi à haut plat, plus
      // large à la base, calotte + bande highlight + visage + tige. Le corps
      // est descendu de ~1px pour dégager le haut de la grille (tige coudée).
      const rx = CLASSIC_RX;
      const ry = CLASSIC_RY;
      const bodyCy = cy + 1;
      const bodyTop = bodyCy - ry;
      const bodyBot = bodyCy + ry;
      // yeux légèrement au-dessus du centre (≈46 % de la hauteur du corps)
      const eyeY = Math.round(bodyTop + (bodyBot - bodyTop) * 0.46);
      return {
        cx,
        cy: bodyCy,
        minX: Math.floor(cx - rx),
        maxX: Math.ceil(cx + rx),
        minY: Math.round(bodyTop) - 5, // marge pour la tige coudée
        maxY: Math.ceil(bodyBot) + 3, // marge pour les pieds-nubs
        eyeY,
        eyeDx: 4,
        // la base est plate : les pieds doivent dépasser SOUS la rangée de
        // contour (bodyBot + 1), sinon ils se fondent dans le contour
        footY: Math.round(bodyBot) + 2,
        footDx: 4,
        headTopY: Math.round(bodyTop),
        flowerY: Math.round(bodyTop),
        cheekY: eyeY + 3,
        mouthY: eyeY + 4,
        armY: eyeY,
      };
    }
  }
}

const silhouettes: Record<JunimoShapeId, Silhouette> = {
  round: (x, y, m) => {
    const r = 10.5; // même valeur que dans metricsFor("round")
    const nx = (x - m.cx) / r;
    const ny = (y - m.cy) / r;
    return nx * nx + ny * ny <= 1.0;
  },
  classic: (x, y, m) => {
    // Trapèze arrondi (réf. Florian) : haut PLAT et étroit, épaules qui
    // descendent en s'évasant, base nettement plus large et quasi plate.
    // Construit par profil de demi-largeur rangée par rangée (pas d'ellipse).
    // La tige n'est pas dans la silhouette (dessinée par-dessus, cf. drawStem).
    const ny = (y - m.cy) / CLASSIC_RY; // -1 sommet → +1 base
    if (Math.abs(ny) > 1) return false;
    const t = (ny + 1) / 2; // 0 haut → 1 bas
    // évasement en cloche (sinus) : ≈72 % de la largeur de base au sommet,
    // flancs convexes (pas de ligne droite façon « tente »)
    const halfW = CLASSIC_RX * (0.72 + 0.28 * Math.sin((Math.PI / 2) * t));
    // coins arrondis, plus marqués aux épaules qu'à l'assise
    const corner =
      ny < 0
        ? Math.sqrt(1 - 0.3 * Math.pow(-ny, 3)) // haut plat, épaules douces
        : Math.sqrt(1 - 0.3 * Math.pow(ny, 4)); // base large, coins doux
    return Math.abs(x - m.cx) <= halfW * corner;
  },
  star: (x, y, m) => {
    // Étoile à 5 branches, pointe en haut, via point-in-polygon.
    const rOut = 12.6;
    const rIn = 5.7;
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? rOut : rIn;
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push([m.cx + rad * Math.cos(ang), m.cy + rad * Math.sin(ang)]);
    }
    // sample pixel center
    const px = x + 0.5;
    const py = y + 0.5;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      const intersect =
        yi > py !== yj > py &&
        px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  },
  square: (x, y, m) => {
    // Carré à coins arrondis (squircle) : |dx/rx|^n + |dy/ry|^n <= 1. Un
    // exposant élevé donne des flancs quasi droits et des coins nets mais
    // arrondis (pas de vraie arête vive, cohérent avec le reste du bestiaire).
    const nx = Math.abs(x + 0.5 - m.cx) / SQUARE_RX;
    const ny = Math.abs(y + 0.5 - m.cy) / SQUARE_RY;
    return Math.pow(nx, SQUARE_N) + Math.pow(ny, SQUARE_N) <= 1.0;
  },
  drop: (x, y, m) => {
    // Goutte d'eau : `m.cy` est le CENTRE DU VENTRE (cercle, cf. metricsFor).
    // Sous ce centre : hémisphère basse classique (comme `round`). Au-dessus :
    // col effilé qui rejoint l'équateur avec la même largeur ET la même pente
    // que le cercle (dérivée nulle en t=1 grâce au sinus) — raccord lisse,
    // sans cassure visible entre le col et le ventre.
    const r = DROP_R;
    const dy = y - m.cy;
    if (dy >= 0) {
      if (dy > r) return false;
      const halfW = Math.sqrt(Math.max(0, r * r - dy * dy));
      return Math.abs(x - m.cx) <= halfW;
    }
    const t = 1 + dy / DROP_NECK_H; // 0 à la pointe → 1 à l'équateur
    if (t < 0) return false;
    const halfW = r * Math.sin((t * Math.PI) / 2);
    return Math.abs(x - m.cx) <= halfW;
  },
  ghost: (x, y, m) => {
    // Fantôme : dôme hémisphérique en haut, flancs droits, puis un ourlet
    // ondulé (GHOST_LEGS « jambes » arrondies séparées de creux) en bas.
    const rx = GHOST_RX;
    if (Math.abs(x - m.cx) > rx + 0.5) return false;
    const domeR = GHOST_DOME_R;
    const bodyTop = m.cy - domeR;
    const domeCy = bodyTop + domeR;
    const hemBase = domeCy + GHOST_SIDE_H;
    const bodyBot = hemBase + GHOST_LEG_H;
    if (y < bodyTop || y > bodyBot) return false;
    if (y < domeCy) {
      // dôme : demi-cercle supérieur
      const ny = (y - domeCy) / domeR;
      const halfW = domeR * Math.sqrt(Math.max(0, 1 - ny * ny));
      return Math.abs(x - m.cx) <= halfW;
    }
    if (y <= hemBase) {
      // flancs droits : pleine largeur
      return Math.abs(x - m.cx) <= rx;
    }
    // ourlet ondulé : GHOST_LEGS jambes arrondies, séparées par des creux qui
    // remontent jusqu'à hemBase (pas de « jambe » entre les bosses).
    const segW = (2 * rx) / GHOST_LEGS;
    const relX = x - (m.cx - rx); // 0..2rx
    const legLocal = relX - Math.floor(relX / segW) * segW; // 0..segW
    const legHalfW = segW * 0.38;
    const distFromCenter = Math.abs(legLocal - segW / 2);
    if (distFromCenter > legHalfW) return y <= hemBase; // creux entre deux jambes
    const t = distFromCenter / legHalfW; // 0 centre de jambe → 1 bord de jambe
    const legBottom = hemBase + (bodyBot - hemBase) * Math.sqrt(Math.max(0, 1 - t * t));
    return y <= legBottom;
  },
};

/** Build the body role grid (roles 0..4) for a shape, with 3-tone shading. */
function buildBodyRoles(shape: JunimoShapeId, m: ShapeMetrics): Uint8Array {
  const G = JUNIMO_GRID;
  const body = new Uint8Array(G * G);
  const inShape = silhouettes[shape];

  // pass 1: fill body pixels
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      if (inShape(x, y, m)) body[y * G + x] = 1;
    }
  }

  const roles = new Uint8Array(G * G);

  // Étendue verticale réelle du corps (indépendante des marges tige/pieds de
  // `metrics`) : indispensable pour placer la calotte et la bande highlight au
  // ras du sommet quelle que soit la silhouette.
  let bodyTop = G;
  let bodyBot = 0;
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      if (!body[y * G + x]) continue;
      if (y < bodyTop) bodyTop = y;
      if (y > bodyBot) bodyBot = y;
    }
  }
  const height = Math.max(1, bodyBot - bodyTop);

  // pass 2 : ombrage en trois zones étagées bien lisibles (cf. référence) :
  //  - CALOTTE vert foncé (shade) en dôme sur le dessus du crâne ;
  //  - BANDE HORIZONTALE vert clair (highlight) juste en dessous — la calotte
  //    « drape » d'1 px le long du contour sur ces rangées (effet dôme) ;
  //  - corps vert vif (base) pour tout le reste. Pas de tache, pas d'assise.
  for (let y = 0; y < G; y++) {
    // étendue horizontale du corps sur cette rangée
    let xL = -1;
    let xR = -1;
    for (let x = 0; x < G; x++) {
      if (!body[y * G + x]) continue;
      if (xL < 0) xL = x;
      xR = x;
    }
    if (xL < 0) continue;
    const t = (y - bodyTop) / height; // 0 sommet → 1 bas
    for (let x = xL; x <= xR; x++) {
      if (!body[y * G + x]) continue;
      let role: number;
      if (t <= 0.17) role = R_SHADE; // calotte
      else if (t <= 0.4)
        // bande highlight, bordée par la retombée de la calotte aux épaules
        role = x === xL || x === xR ? R_SHADE : R_HIGHLIGHT;
      else role = R_BASE;
      roles[y * G + x] = role;
    }
  }

  // pass 3: 1px outline around the silhouette
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      if (body[y * G + x]) continue;
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nxp = x + dx;
          const nyp = y + dy;
          if (nxp < 0 || nyp < 0 || nxp >= G || nyp >= G) continue;
          if (body[nyp * G + nxp]) {
            touches = true;
            break;
          }
        }
      }
      if (touches) roles[y * G + x] = R_OUTLINE;
    }
  }

  return roles;
}

// --- Accessory stamps --------------------------------------------------------
// Each stamp is a set of rows drawn with a small local palette. The stamp is
// positioned relative to shape metrics so it sits correctly on every body.

interface Stamp {
  /** static rows, or rows derived from shape metrics (e.g. eye spacing) */
  rows: string[] | ((m: ShapeMetrics) => string[]);
  palette: Record<string, RGBA>;
  /** anchor origin (top-left of the stamp) computed from metrics */
  origin: (m: ShapeMetrics) => { ox: number; oy: number };
}

const HAT_DARK: RGBA = [38, 40, 52, 255];
const HAT_HI: RGBA = [72, 76, 96, 255];
const HAT_BAND: RGBA = [214, 150, 50, 255];
const BOW_RED: RGBA = [214, 68, 68, 255];
const BOW_DARK: RGBA = [150, 38, 44, 255];
const BOW_HI: RGBA = [240, 120, 120, 255];
const FRAME: RGBA = [56, 58, 72, 255];
const PETAL: RGBA = [238, 118, 170, 255];
const FLOWER_MID: RGBA = [247, 206, 92, 255];
const STEM: RGBA = [96, 164, 84, 255];
const ANTENNA_BALL: RGBA = [235, 92, 122, 255];
const ANTENNA_STALK: RGBA = [64, 68, 84, 255];
const CROWN_GOLD: RGBA = [247, 197, 68, 255];
const CROWN_GOLD_DARK: RGBA = [196, 146, 32, 255];
const CROWN_JEWEL: RGBA = [196, 60, 90, 255];
const SCARF_RED: RGBA = [206, 84, 64, 255];
const SCARF_DARK: RGBA = [150, 54, 40, 255];
const SCARF_STRIPE: RGBA = [240, 200, 170, 255];
const CAP_MAIN: RGBA = [66, 120, 196, 255];
const CAP_BRIM: RGBA = [40, 78, 132, 255];

const ACCESSORY_STAMPS: Record<Exclude<JunimoAccessoryId, "none">, Stamp> = {
  hat: {
    // top hat: crown + gold band + wide brim
    rows: [
      ".HKKKKKKH.",
      ".KKKKKKKK.",
      ".KKKKKKKK.",
      ".KKHHHHKK.",
      ".BBBBBBBB.",
      "KKKKKKKKKK",
      "KKKKKKKKKK",
    ],
    palette: { K: HAT_DARK, H: HAT_HI, B: HAT_BAND },
    // clamp so the crown never clips out of the 32px canvas (tall star apex);
    // the crown rows still cover everything above the brim
    origin: (m) => ({ ox: Math.round(m.cx) - 4, oy: Math.max(0, m.headTopY - 4) }),
  },
  bow: {
    // bow tie centered on the lower body
    rows: [
      "RR.....RR",
      "RRR.H.RRR",
      "RRRRKRRRR",
      "RRR.H.RRR",
      "RR.....RR",
    ],
    palette: { R: BOW_RED, K: BOW_DARK, H: BOW_HI },
    origin: (m) => ({ ox: Math.round(m.cx) - 4, oy: m.footY - 4 }),
  },
  glasses: {
    // Two thin rounded frames, one around each 2×2 eye, joined by a bridge.
    // Lenses stay transparent so the eyes show through. Width depends on the
    // shape's eye spacing (eyeDx), so the rows are generated from metrics.
    rows: (m) => {
      const d = m.eyeDx;
      const w = 2 * d + 4; // two 4-wide frames + gap between them
      const blank = () => ".".repeat(w).split("");
      const r0 = blank();
      const r1 = blank();
      const r2 = blank();
      const r3 = blank();
      for (const off of [0, 2 * d]) {
        // rounded 4×4 frame outline (corners left empty)
        r0[off + 1] = "F";
        r0[off + 2] = "F";
        r1[off] = "F";
        r1[off + 3] = "F";
        r2[off] = "F";
        r2[off + 3] = "F";
        r3[off + 1] = "F";
        r3[off + 2] = "F";
      }
      // bridge across the nose, on the upper eye row
      for (let x = 4; x < 2 * d; x++) r1[x] = "F";
      return [r0, r1, r2, r3].map((r) => r.join(""));
    },
    palette: { F: FRAME },
    origin: (m) => ({ ox: Math.round(m.cx) - m.eyeDx - 2, oy: m.eyeY - 1 }),
  },
  flower: {
    // little flower tucked on the head, top-right, with a short stem
    rows: [
      ".P.",
      "PMP",
      ".P.",
      ".G.",
      ".G.",
    ],
    palette: { P: PETAL, M: FLOWER_MID, G: STEM },
    origin: (m) => ({ ox: Math.round(m.cx) + 3, oy: m.flowerY - 2 }),
  },
  antenna: {
    // Petite antenne (bille + tige fine) plantée sur le sommet, décalée à
    // droite pour ne jamais chevaucher la tige (centrée, coudée vers la
    // gauche — cf. `drawStem`).
    rows: [
      ".BB.",
      ".BB.",
      "..S.",
      "..S.",
      "..S.",
    ],
    palette: { B: ANTENNA_BALL, S: ANTENNA_STALK },
    // même clamp que `hat` pour ne pas sortir du canvas sur les apex hauts
    // (étoile, fantôme).
    origin: (m) => ({ ox: Math.round(m.cx) + 1, oy: Math.max(0, m.headTopY - 5) }),
  },
  crown: {
    // Petite couronne à pointes, posée à cheval sur le sommet de la tête
    // (comme le haut-de-forme, mais bien plus basse).
    rows: [
      "Y.Y.Y.Y.Y",
      "YYYYYYYYY",
      "YYYBYBYYY",
      "DDDDDDDDD",
    ],
    palette: { Y: CROWN_GOLD, B: CROWN_JEWEL, D: CROWN_GOLD_DARK },
    origin: (m) => ({ ox: Math.round(m.cx) - 4, oy: Math.max(0, m.headTopY - 4) }),
  },
  scarf: {
    // Écharpe nouée autour des épaules (rangée d'attache des bras), avec un
    // pan qui pend sur le flanc gauche.
    rows: [
      "SSSSSSSSS",
      "SDSDSDSDS",
      "TT.......",
      "TT.......",
      ".T.......",
    ],
    palette: { S: SCARF_RED, D: SCARF_STRIPE, T: SCARF_DARK },
    origin: (m) => ({ ox: Math.round(m.cx) - 4, oy: m.armY - 1 }),
  },
  cap: {
    // Casquette : calotte arrondie + visière plate qui dépasse sur le côté
    // droit (contrairement au haut-de-forme, symétrique).
    rows: [
      ".CCCC....",
      "CCCCCC...",
      "CCCCCCV..",
      "..VVVVVV.",
    ],
    palette: { C: CAP_MAIN, V: CAP_BRIM },
    origin: (m) => ({ ox: Math.round(m.cx) - 4, oy: Math.max(0, m.headTopY - 4) }),
  },
};

// --- Traits partagés (tige / visage / membres) -------------------------------
// Ces traits sont dessinés par-dessus le corps et positionnés via `metrics` : ils
// sont donc IDENTIQUES d'une forme à l'autre (classic/round/star), seul le corps
// change. Ils utilisent les tons de la rampe (palette-swap #32) sauf yeux/joues
// qui sont des littéraux (un vert n'aurait pas de sens pour un œil).

type PutFn = (x: number, y: number, c: RGBA) => void;

/**
 * Tige coudée sur le dessus de la tête : un pédoncule sombre vertical, un coude
 * vers la gauche, et une pointe vert vif décalée à gauche (trait obligatoire).
 */
function drawStem(put: PutFn, m: ShapeMetrics, ramp: ColorRamp): void {
  const sx = Math.round(m.cx);
  const top = m.headTopY; // première rangée du corps
  // pédoncule sombre (3 px) juste au-dessus de la calotte
  put(sx, top - 1, ramp.outline);
  put(sx, top - 2, ramp.outline);
  put(sx, top - 3, ramp.outline);
  // coude sombre vers la gauche puis pointe verte (base + highlight)
  put(sx - 1, top - 4, ramp.outline);
  put(sx - 1, top - 5, ramp.base);
  put(sx - 2, top - 5, ramp.highlight);
}

/**
 * Expression du visage, pilotée par la machine à états :
 *  - `normal` : yeux ouverts + sourire (défaut, identique à avant #49) ;
 *  - `sleepy` : paupières baissées (yeux réduits à un trait) ;
 *  - `yawn` : paupières baissées + bouche grande ouverte (bâillement bored) ;
 *  - `chew` : bouche fermée qui mâche (petit carré plein, mood eat) ;
 *  - `lookLeft`/`lookRight` : yeux décalés d'1 px (regard, mood bored).
 */
type FaceExpr = "normal" | "sleepy" | "yawn" | "chew" | "lookLeft" | "lookRight";

/**
 * Visage : deux yeux carrés quasi-noirs pleins (2×2, sans reflet comme la
 * référence), deux joues roses sous/derrière les yeux, et une petite bouche
 * sombre centrée. `expr` module yeux + bouche pour les moods (#49).
 */
function drawFace(
  put: PutFn,
  m: ShapeMetrics,
  ramp: ColorRamp,
  expr: FaceExpr = "normal",
): void {
  const cxr = Math.round(m.cx);
  const gaze = expr === "lookLeft" ? -1 : expr === "lookRight" ? 1 : 0;
  const closed = expr === "sleepy" || expr === "yawn";
  // yeux : carrés 2×2 pleins, écartés symétriquement autour du centre ;
  // `closed` les réduit à un trait bas (paupière), `gaze` les décale d'1 px.
  for (const dir of [-1, 1] as const) {
    const ex = cxr + dir * m.eyeDx;
    // colonnes du carré : vers l'intérieur pour rester symétrique
    const x0 = (dir < 0 ? ex - 1 : ex) + gaze;
    if (closed) {
      put(x0, m.eyeY + 1, EYE_DARK);
      put(x0 + 1, m.eyeY + 1, EYE_DARK);
    } else {
      for (let dy = 0; dy < 2; dy++) {
        put(x0, m.eyeY + dy, EYE_DARK);
        put(x0 + 1, m.eyeY + dy, EYE_DARK);
      }
    }
  }
  // joues roses : 2 px sous et légèrement en retrait vers l'extérieur des yeux
  for (const dir of [-1, 1] as const) {
    const ckx = cxr + dir * (m.eyeDx + 1);
    put(ckx, m.cheekY, CHEEK);
    put(ckx - dir, m.cheekY, CHEEK);
  }
  if (expr === "yawn") {
    // bouche grande ouverte : ovale sombre 3×2 avec un intérieur rose
    for (let dx = -1; dx <= 1; dx++) {
      put(cxr + dx, m.mouthY - 1, ramp.outline);
      put(cxr + dx, m.mouthY, ramp.outline);
    }
    put(cxr, m.mouthY, CHEEK);
  } else if (expr === "chew") {
    // bouche fermée qui mâche : petit carré plein 2×2
    for (let dy = -1; dy <= 0; dy++) {
      put(cxr - 1, m.mouthY + dy, ramp.outline);
      put(cxr, m.mouthY + dy, ramp.outline);
    }
  } else {
    // bouche : petit sourire sombre (2 px centraux + 2 coins remontés)
    put(cxr - 1, m.mouthY, ramp.outline);
    put(cxr, m.mouthY, ramp.outline);
    put(cxr - 2, m.mouthY - 1, ramp.outline);
    put(cxr + 1, m.mouthY - 1, ramp.outline);
  }
}

/**
 * Membres. `idle` : deux petits bras-nubs sombres sur les flancs, à hauteur des
 * yeux. `celebrate` : deux bras levés en diagonale au-dessus de la tête (réf. 2,
 * pose de fin de chat). `flankAt` renvoie l'étendue [gauche, droite] du corps à
 * une rangée donnée, pour attacher les bras au bon endroit quelle que soit la
 * silhouette.
 */
function drawArms(
  put: PutFn,
  m: ShapeMetrics,
  ramp: ColorRamp,
  pose: JunimoPose,
  flankAt: (y: number) => [number, number],
): void {
  if (pose === "celebrate") {
    // bras diagonaux épais (2 px) : de l'épaule vers le haut-extérieur,
    // jusqu'au-dessus de la tête, avec une petite « main » arrondie au bout.
    const shoulderY = m.headTopY + 5;
    for (const dir of [-1, 1] as const) {
      const [L, R] = flankAt(shoulderY);
      let ax = dir < 0 ? L : R;
      let ay = shoulderY;
      for (let i = 0; i < 4; i++) {
        put(ax, ay, ramp.outline);
        put(ax, ay + 1, ramp.outline); // épaissit le bras vers le bas
        ax += dir;
        ay -= 1;
      }
      // main : petit bout arrondi (3 px) au sommet du bras
      put(ax, ay, ramp.outline);
      put(ax, ay + 1, ramp.outline);
      put(ax - dir, ay, ramp.outline);
    }
    return;
  }
  // idle : bras-nubs sombres poussés de 2 px au-delà du flanc, 2 px de haut
  for (const dir of [-1, 1] as const) {
    const [L, R] = flankAt(m.armY);
    const edge = dir < 0 ? L : R;
    for (let dy = 0; dy < 2; dy++) {
      put(edge + dir, m.armY + dy, ramp.outline);
      put(edge + dir * 2, m.armY + dy, ramp.outline);
    }
  }
}

/** Deux pieds-nubs sombres sous le corps (masqués sur la frame de rebond). */
function drawFeet(put: PutFn, m: ShapeMetrics, ramp: ColorRamp): void {
  const cxr = Math.round(m.cx);
  for (const dir of [-1, 1] as const) {
    const fx = cxr + dir * m.footDx;
    for (const px of [fx - 1, fx]) {
      put(px, m.footY, ramp.shade);
      put(px, m.footY + 1, ramp.outline);
    }
  }
}

// --- Traits de mood (#49) : jambes de course, jeton, étincelles, Zzz ---------

/**
 * Jambes en foulée alternée (mood run) : les deux pieds-nubs sont décalés
 * horizontalement selon la frame pour simuler la marche/course. Combiné au
 * rebond et aux lignes de vitesse, ça se lit « il court » même à petite taille.
 */
function drawRunLegs(
  put: PutFn,
  m: ShapeMetrics,
  ramp: ColorRamp,
  frame: number,
): void {
  const cxr = Math.round(m.cx);
  // décalage [jambe gauche, jambe droite] par frame : une jambe en avant,
  // l'autre en arrière, puis passage groupé (cycle à 4 temps).
  const offs = [
    [-1, 3],
    [1, 1],
    [3, -1],
    [1, 1],
  ][frame] ?? [0, 0];
  const bases = [cxr - m.footDx, cxr + m.footDx];
  bases.forEach((bx, i) => {
    const lx = bx + offs[i];
    for (const px of [lx, lx + 1]) {
      put(px, m.footY, ramp.shade);
      put(px, m.footY + 1, ramp.outline);
    }
  });
}

/** Petit jeton doré 3×3 (coin bas/droit ombré), origine = coin haut-gauche. */
function drawToken(put: PutFn, x: number, y: number): void {
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 3; dx++) {
      put(x + dx, y + dy, dx === 2 || dy === 2 ? TOKEN_EDGE : TOKEN_FILL);
    }
  }
}

/** Petite étincelle « + » (5 px) centrée sur (x, y). */
function drawSparkle(put: PutFn, x: number, y: number): void {
  put(x, y, SPARKLE);
  put(x - 1, y, SPARKLE);
  put(x + 1, y, SPARKLE);
  put(x, y - 1, SPARKLE);
  put(x, y + 1, SPARKLE);
}

/** Petit « z » 3×3 (sommeil), origine = coin haut-gauche. */
function drawZ(put: PutFn, x: number, y: number): void {
  put(x, y, ZZZ_COL);
  put(x + 1, y, ZZZ_COL);
  put(x + 2, y, ZZZ_COL);
  put(x + 1, y + 1, ZZZ_COL);
  put(x, y + 2, ZZZ_COL);
  put(x + 1, y + 2, ZZZ_COL);
  put(x + 2, y + 2, ZZZ_COL);
}

// --- Assembly ----------------------------------------------------------------

export interface JunimoSpec {
  shape: JunimoShapeId;
  color: JunimoColorId;
  accessory: JunimoAccessoryId;
  /** idle-animation frame (0 = rest). Optional; defaults to 0. */
  frame?: number;
  /** pose (repos / célébration). Optionnel ; défaut `idle`. */
  pose?: JunimoPose;
  /**
   * Mood animé (#49). Optionnel ; défaut `idle`. Quand il est fourni, il pilote
   * le rebond, l'expression, les pieds et les sur-couches (jeton, étincelles…) ;
   * `frame` indexe alors la boucle du mood (`moodFrameCount`). `mood: "celebrate"`
   * force la pose bras levés — `pose` reste utilisable seul pour l'éditeur.
   */
  mood?: JunimoMood;
}

export interface PixelBuffer {
  width: number;
  height: number;
  /** RGBA, row-major, length = width*height*4 */
  data: Uint8ClampedArray;
}

/** Render a junimo to a raw RGBA buffer (pure, no DOM). */
export function buildJunimoPixels(spec: JunimoSpec): PixelBuffer {
  const G = JUNIMO_GRID;
  const mood: JunimoMood = spec.mood ?? "idle";
  const fc = MOOD_FRAME_COUNT[mood];
  // frame normalisée dans la boucle du mood (gère négatif/débordement)
  const frame = (((spec.frame ?? 0) % fc) + fc) % fc;

  // Configuration du mood pour cette frame : rebond vertical, pose des bras,
  // expression du visage et mode des pieds. Les sur-couches (jeton, lignes de
  // vitesse, étincelles, Zzz) sont dessinées plus bas.
  let bounce = 0;
  let pose: JunimoPose = spec.pose ?? "idle";
  let expr: FaceExpr = "normal";
  // "static" = deux pieds-nubs ; "run" = foulée alternée ; "none" = pas de pieds
  // (rebond en l'air, ou assis pour bored).
  let feet: "static" | "run" | "none" = "static";
  switch (mood) {
    case "run":
      bounce = [0, -2, 0, -2][frame];
      feet = "run";
      break;
    case "eat":
      // porte un jeton à la bouche puis mâche sur les 2 dernières frames
      expr = frame >= 2 ? "chew" : "normal";
      break;
    case "play":
      // petit sursaut quand le jeton est au sommet de l'arc
      bounce = frame === 2 ? -1 : 0;
      break;
    case "celebrate":
      pose = "celebrate";
      bounce = [0, -2, -1][frame];
      feet = bounce === 0 ? "static" : "none";
      break;
    case "bored":
      // assis (corps descendu), regarde autour et bâille
      bounce = 1;
      feet = "none";
      expr = ["lookLeft", "lookRight", "yawn", "lookRight"][frame] as FaceExpr;
      break;
    case "idle":
    default:
      bounce = frame === 1 ? -2 : 0;
      feet = frame === 0 ? "static" : "none";
      break;
  }

  const m = metricsFor(spec.shape, bounce);
  const ramp = rampFor(spec.color);
  const roles = buildBodyRoles(spec.shape, m);

  const data = new Uint8ClampedArray(G * G * 4);
  const put: PutFn = (x, y, c) => {
    if (x < 0 || y < 0 || x >= G || y >= G) return;
    const i = (y * G + x) * 4;
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
    data[i + 3] = c[3];
  };

  const roleColor: Record<number, RGBA> = {
    [R_OUTLINE]: ramp.outline,
    [R_SHADE]: ramp.shade,
    [R_BASE]: ramp.base,
    [R_HIGHLIGHT]: ramp.highlight,
  };

  // Étendue horizontale [gauche, droite] du corps (rôle non vide) à une rangée
  // donnée : sert à accrocher les bras au flanc réel de chaque silhouette.
  const flankAt = (y: number): [number, number] => {
    let l = -1;
    let r = -1;
    if (y >= 0 && y < G) {
      for (let x = 0; x < G; x++) {
        if (roles[y * G + x] !== R_EMPTY) {
          if (l < 0) l = x;
          r = x;
        }
      }
    }
    if (l < 0) {
      // rangée hors corps : repli sur le centre
      l = Math.round(m.cx);
      r = l;
    }
    return [l, r];
  };

  // lignes de vitesse (mood run) : quelques tirets derrière le flanc gauche,
  // décalés par frame pour un effet de filé. Dessinées d'abord (arrière-plan).
  if (mood === "run") {
    for (const ry of [m.eyeY, m.cheekY, m.footY - 2]) {
      const [L] = flankAt(ry);
      const shift = (frame % 2) * 2; // scintillement du filé
      const startX = L - 2 - shift;
      for (let dx = 0; dx < 3; dx++) put(startX - dx, ry, MOTION);
    }
  }

  // pieds : nubs statiques, foulée de course, ou rien (rebond en l'air / assis)
  if (feet === "static") drawFeet(put, m, ramp);
  else if (feet === "run") drawRunLegs(put, m, ramp, frame);

  // bras-nubs de repos : sous le corps pour que le corps les recouvre au flanc
  // (effet « collé au corps ») ; en célébration les bras sont dessinés au-dessus.
  if (pose === "idle") drawArms(put, m, ramp, pose, flankAt);

  // corps
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      const r = roles[y * G + x];
      if (r === R_EMPTY) continue;
      put(x, y, roleColor[r]);
    }
  }

  // bras levés (pose celebrate) : au-dessus du corps
  if (pose === "celebrate") drawArms(put, m, ramp, pose, flankAt);

  // tige coudée sur le dessus
  drawStem(put, m, ramp);

  // visage (yeux carrés, joues roses, bouche) — expression selon le mood
  drawFace(put, m, ramp, expr);

  // accessory
  if (spec.accessory !== "none") {
    const stamp = ACCESSORY_STAMPS[spec.accessory];
    const { ox, oy } = stamp.origin(m);
    const rows = typeof stamp.rows === "function" ? stamp.rows(m) : stamp.rows;
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const ch = row[rx];
        const c = stamp.palette[ch];
        if (c) put(ox + rx, oy + ry, c);
      }
    });
  }

  // --- Sur-couches de mood au premier plan (jeton, étincelles, Zzz) ----------
  const cxr = Math.round(m.cx);
  if (mood === "eat") {
    // le jeton descend depuis le flanc droit jusqu'à la bouche, puis disparaît
    // (avalé) sur la dernière frame.
    const path: ({ x: number; y: number } | null)[] = [
      { x: cxr + m.eyeDx + 2, y: m.eyeY }, // tenu sur le côté
      { x: cxr + 2, y: m.eyeY + 2 }, // remonte vers la bouche
      { x: cxr - 1, y: m.mouthY - 2 }, // à la bouche
      null, // avalé
    ];
    const p = path[frame];
    if (p) drawToken(put, p.x, p.y);
  } else if (mood === "play") {
    // le jeton décrit un arc au-dessus de la tête (jonglage)
    const arc = [
      { x: cxr - 1, y: m.armY - 1 }, // près des mains, en bas
      { x: cxr, y: m.headTopY - 3 }, // monte
      { x: cxr + 1, y: m.headTopY - 7 }, // sommet de l'arc
      { x: cxr, y: m.headTopY - 2 }, // redescend
    ][frame];
    drawToken(put, arc.x, arc.y);
  } else if (mood === "celebrate") {
    // étincelles alternées de part et d'autre de la tête
    const top = m.headTopY;
    if (frame === 0) {
      drawSparkle(put, cxr - 8, top + 1);
      drawSparkle(put, cxr + 9, top + 4);
    } else if (frame === 1) {
      drawSparkle(put, cxr - 9, top + 4);
      drawSparkle(put, cxr + 8, top + 1);
    } else {
      drawSparkle(put, cxr - 7, top - 1);
      drawSparkle(put, cxr + 7, top - 1);
    }
  } else if (mood === "bored") {
    // « Zzz » qui montent en escalier au-dessus de la tête, un de plus par frame
    const zx = cxr + 4;
    const zy = m.headTopY - 2;
    const count = Math.min(frame + 1, 3);
    for (let i = 0; i < count; i++) drawZ(put, zx + i * 3, zy - i * 3);
  }

  return { width: G, height: G, data };
}
