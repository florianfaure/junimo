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

export type JunimoShapeId = "classic" | "round" | "star";
/**
 * Pose du junimo. `idle` = posture de repos (petits bras-nubs sur les flancs) ;
 * `celebrate` = bras levés en diagonale au-dessus de la tête (réf. 2 de Florian,
 * consommée par la machine à états de la tâche #49). La pose ne change que les
 * membres : le visage, la tige et le corps restent identiques.
 */
export type JunimoPose = "idle" | "celebrate";
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
export type JunimoAccessoryId = "none" | "hat" | "bow" | "glasses" | "flower";

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
];

/** Base HSL per color — the ramp (highlight/base/shade/outline) is derived. */
interface HSL {
  h: number;
  s: number;
  l: number;
}
const COLOR_HSL: Record<JunimoColorId, HSL> = {
  green: { h: 128, s: 45, l: 47 },
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
];

// Couleurs littérales (non concernées par le palette-swap #32).
// Yeux : deux carrés quasi-noirs (trait obligatoire « yeux carrés ») avec un
// point de lumière blanc pour garder le regard vivant. Joues : rose doux,
// identique quelle que soit la couleur du corps (comme un blush).
const EYE_DARK: RGBA = [30, 26, 30, 255];
const EYE_GLINT: RGBA = [255, 255, 255, 255];
const CHEEK: RGBA = [244, 146, 168, 255];

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

// Rayons du corps classique (réutilisés par la variante `round`). Un corps
// légèrement plus haut que large donne la silhouette « œuf arrondi ».
const CLASSIC_RX = 9.3;
const CLASSIC_RY = 9.9;

function metricsFor(shape: JunimoShapeId, bounce: number): ShapeMetrics {
  const G = JUNIMO_GRID;
  const cx = G / 2 - 0.5;
  const cy = G / 2 - 0.5 + bounce;
  switch (shape) {
    case "round": {
      // Variante dérivée : disque plein. Même tête/visage/tige que la classique,
      // seule la silhouette du corps change (cercle parfait au lieu de l'œuf).
      const r = CLASSIC_RX; // rayon aligné sur la largeur de la classique
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
        maxY: Math.ceil(bodyBot) + 2,
        eyeY,
        eyeDx: 4,
        footY: Math.round(bodyBot),
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
    case "classic":
    default: {
      // Forme canonique (réf. Florian) : corps arrondi, un peu plus large en
      // bas, calotte + visage + tige. Le corps est descendu de ~1px pour
      // dégager le haut de la grille (calotte + tige coudée).
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
        maxY: Math.ceil(bodyBot) + 2, // marge pour les pieds-nubs
        eyeY,
        eyeDx: 4,
        footY: Math.round(bodyBot),
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
    const r = CLASSIC_RX;
    const nx = (x - m.cx) / r;
    const ny = (y - m.cy) / r;
    return nx * nx + ny * ny <= 1.0;
  },
  classic: (x, y, m) => {
    // Corps arrondi « en œuf » : à peine plus étroit en haut, un peu renflé en
    // bas — la silhouette signature du junimo de la référence. La tige n'est
    // plus dans la silhouette (elle est dessinée par-dessus, cf. drawStem).
    const rx = CLASSIC_RX;
    const ry = CLASSIC_RY;
    let ny = (y - m.cy) / ry;
    // léger fuselage vers le haut (ny < 0), pleine largeur en bas
    const taper = 1 - 0.12 * Math.max(0, -ny);
    // léger renflement du bas (ny > 0) pour un corps « plus large en bas »
    const widen = 1 + 0.05 * Math.max(0, ny);
    const nx = (x - m.cx) / (rx * taper * widen);
    if (ny > 0) ny *= 1.03; // aplatit très légèrement l'assise
    return nx * nx + ny * ny <= 1.0;
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
  const width = Math.max(1, m.maxX - m.minX);

  // Ellipse de highlight « front » : tache claire large sous la calotte,
  // centrée en haut, qui s'élargit vers le bas (cf. bande L de la référence).
  const hiCy = bodyTop + height * 0.34;
  const hiRx = width * 0.44;
  const hiRy = height * 0.24;

  // pass 2 : ombrage rôle par rôle
  //  - calotte vert foncé (shade) sur le dôme supérieur
  //  - bande/tache vert clair (highlight) juste en dessous, au centre
  //  - corps vert vif (base) au milieu
  //  - fine assise vert foncé (shade) tout en bas pour poser le volume
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      if (!body[y * G + x]) continue;
      const t = (y - bodyTop) / height; // 0 sommet → 1 bas
      const dxh = (x - m.cx) / hiRx;
      const dyh = (y - hiCy) / hiRy;
      const inHighlight = dxh * dxh + dyh * dyh <= 1.0;
      let role: number;
      if (t <= 0.16) role = R_SHADE; // calotte
      else if (inHighlight && t <= 0.55) role = R_HIGHLIGHT;
      else if (t >= 0.86) role = R_SHADE; // assise
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
 * Visage : deux yeux carrés quasi-noirs (2×2 + point de lumière), deux joues
 * roses sous/derrière les yeux, et une petite bouche sombre centrée.
 */
function drawFace(put: PutFn, m: ShapeMetrics, ramp: ColorRamp): void {
  const cxr = Math.round(m.cx);
  // yeux : carrés 2×2, écartés symétriquement autour du centre
  for (const dir of [-1, 1] as const) {
    const ex = cxr + dir * m.eyeDx;
    // colonnes du carré : vers l'intérieur pour rester symétrique
    const x0 = dir < 0 ? ex - 1 : ex;
    for (let dy = 0; dy < 2; dy++) {
      put(x0, m.eyeY + dy, EYE_DARK);
      put(x0 + 1, m.eyeY + dy, EYE_DARK);
    }
    // point de lumière en haut-intérieur (garde le regard vivant)
    put(dir < 0 ? x0 + 1 : x0, m.eyeY, EYE_GLINT);
  }
  // joues roses : 2 px sous et légèrement en retrait vers l'extérieur des yeux
  for (const dir of [-1, 1] as const) {
    const ckx = cxr + dir * (m.eyeDx + 1);
    put(ckx, m.cheekY, CHEEK);
    put(ckx - dir, m.cheekY, CHEEK);
  }
  // bouche : petit sourire sombre (2 px centraux + 2 coins remontés)
  put(cxr - 1, m.mouthY, ramp.outline);
  put(cxr, m.mouthY, ramp.outline);
  put(cxr - 2, m.mouthY - 1, ramp.outline);
  put(cxr + 1, m.mouthY - 1, ramp.outline);
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

// --- Assembly ----------------------------------------------------------------

export interface JunimoSpec {
  shape: JunimoShapeId;
  color: JunimoColorId;
  accessory: JunimoAccessoryId;
  /** idle-animation frame (0 = rest). Optional; defaults to 0. */
  frame?: number;
  /** pose (repos / célébration). Optionnel ; défaut `idle`. */
  pose?: JunimoPose;
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
  const frame =
    (((spec.frame ?? 0) % JUNIMO_FRAME_COUNT) + JUNIMO_FRAME_COUNT) %
    JUNIMO_FRAME_COUNT;
  const bounce = frame === 1 ? -2 : 0;
  const grounded = frame === 0;
  const pose: JunimoPose = spec.pose ?? "idle";

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

  // pieds-nubs (sous le corps, dessinés d'abord ; masqués en rebond)
  if (grounded) drawFeet(put, m, ramp);

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

  // visage (yeux carrés, joues roses, bouche)
  drawFace(put, m, ramp);

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

  return { width: G, height: G, data };
}
