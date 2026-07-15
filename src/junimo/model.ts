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

// Eye + accessory literal colors (not palette-swapped).
const EYE_SCLERA: RGBA = [244, 238, 222, 255];
const EYE_PUPIL: RGBA = [28, 22, 20, 255];
const EYE_GLINT: RGBA = [255, 255, 255, 255];

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
  /** top of the head where hats/flowers rest */
  headTopY: number;
}

type Silhouette = (x: number, y: number, m: ShapeMetrics) => boolean;

function metricsFor(shape: JunimoShapeId, bounce: number): ShapeMetrics {
  const G = JUNIMO_GRID;
  const cx = G / 2 - 0.5;
  const cy = G / 2 - 0.5 + bounce;
  switch (shape) {
    case "round": {
      const r = 9.7;
      return {
        cx,
        cy,
        minX: Math.floor(cx - r),
        maxX: Math.ceil(cx + r),
        minY: Math.floor(cy - r),
        maxY: Math.ceil(cy + r),
        eyeY: Math.round(cy - 1),
        eyeDx: 4,
        footY: Math.round(cy + r),
        footDx: 4,
        headTopY: Math.round(cy - r),
      };
    }
    case "star": {
      const rOut = 13.2;
      return {
        cx,
        cy: cy + 0.5,
        minX: Math.floor(cx - rOut),
        maxX: Math.ceil(cx + rOut),
        minY: Math.floor(cy - rOut),
        maxY: Math.ceil(cy + rOut * 0.85),
        eyeY: Math.round(cy + 2),
        eyeDx: 3,
        footY: Math.round(cy + rOut * 0.72),
        footDx: 3,
        headTopY: Math.round(cy - rOut * 0.5),
      };
    }
    case "classic":
    default: {
      const rx = 8.7;
      const ry = 10.8;
      return {
        cx,
        cy: cy + 0.4,
        minX: Math.floor(cx - rx),
        maxX: Math.ceil(cx + rx),
        minY: Math.floor(cy + 0.4 - ry) - 3, // room for the sprout
        maxY: Math.ceil(cy + 0.4 + ry),
        eyeY: Math.round(cy + 0.4 - 1),
        eyeDx: 4,
        footY: Math.round(cy + 0.4 + ry),
        footDx: 4,
        headTopY: Math.round(cy + 0.4 - ry),
      };
    }
  }
}

const silhouettes: Record<JunimoShapeId, Silhouette> = {
  round: (x, y, m) => {
    const r = 9.7;
    const nx = (x - m.cx) / r;
    const ny = (y - m.cy) / r;
    return nx * nx + ny * ny <= 1.0;
  },
  classic: (x, y, m) => {
    // Egg-shaped body (narrower at the top) + a little sprout/antenna on top —
    // the signature junimo silhouette.
    const rx = 8.7;
    const ry = 10.8;
    let ny = (y - m.cy) / ry;
    // taper: narrower toward the top (ny < 0), full width at the bottom
    const taper = 1 - 0.16 * Math.max(0, -ny);
    const nx = (x - m.cx) / (rx * taper);
    if (ny > 0) ny *= 1.05; // slightly flatten the base so it "sits"
    if (nx * nx + ny * ny <= 1.0) return true;
    // sprout: 1px stalk just above the head
    const top = Math.round(m.cy - ry);
    return x === Math.round(m.cx) && y >= top - 3 && y < top;
  },
  star: (x, y, m) => {
    // 5-point star, one point up, via point-in-polygon.
    const rOut = 13.2;
    const rIn = 5.9;
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
  const spanY = Math.max(1, m.maxY - m.minY);
  const spanX = Math.max(1, m.maxX - m.minX);

  // pass 2: shade body pixels
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      if (!body[y * G + x]) continue;
      const vy = (y - m.minY) / spanY; // 0 top → 1 bottom
      const vx = (x - m.minX) / spanX; // 0 left → 1 right
      let role: number;
      if (vy >= 0.72) role = R_SHADE;
      else if (vy <= 0.34 && vx <= 0.56) role = R_HIGHLIGHT;
      else role = R_BASE;
      roles[y * G + x] = role;
    }
  }

  // specular: a small bright cluster near the top-left
  const sx = Math.round(m.cx - spanX * 0.24);
  const sy = Math.round(m.minY + spanY * 0.2);
  for (const [dx, dy] of [
    [0, 0],
    [1, 0],
    [0, 1],
  ] as const) {
    const px = sx + dx;
    const py = sy + dy;
    if (px >= 0 && py >= 0 && px < G && py < G && body[py * G + px]) {
      roles[py * G + px] = R_HIGHLIGHT;
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
  rows: string[];
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
const FRAME: RGBA = [40, 40, 50, 255];
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
    origin: (m) => ({ ox: Math.round(m.cx) - 4, oy: m.headTopY - 4 }),
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
    // two round frames + bridge, lenses left transparent over the eyes
    rows: [
      "FFF.F.FFF",
      "F.F.F.F.F",
      "FFF.F.FFF",
    ],
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
    origin: (m) => ({ ox: Math.round(m.cx) + 3, oy: m.headTopY - 2 }),
  },
};

// --- Assembly ----------------------------------------------------------------

export interface JunimoSpec {
  shape: JunimoShapeId;
  color: JunimoColorId;
  accessory: JunimoAccessoryId;
  /** idle-animation frame (0 = rest). Optional; defaults to 0. */
  frame?: number;
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

  const m = metricsFor(spec.shape, bounce);
  const ramp = rampFor(spec.color);
  const roles = buildBodyRoles(spec.shape, m);

  const data = new Uint8ClampedArray(G * G * 4);
  const put = (x: number, y: number, c: RGBA) => {
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

  // feet (drawn first, below body; grounded frame only)
  if (grounded) {
    for (const dir of [-1, 1]) {
      const fx = Math.round(m.cx) + dir * m.footDx;
      for (const ox of [fx - 1, fx]) {
        put(ox, m.footY, ramp.shade);
        put(ox, m.footY + 1, ramp.outline);
      }
    }
  }

  // body
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      const r = roles[y * G + x];
      if (r === R_EMPTY) continue;
      put(x, y, roleColor[r]);
    }
  }

  // eyes: cream sclera (2×2) + pupil (bottom row) + glint
  for (const dir of [-1, 1]) {
    const ex = Math.round(m.cx) + dir * m.eyeDx;
    put(ex, m.eyeY, EYE_SCLERA);
    put(ex - 1, m.eyeY, EYE_SCLERA);
    put(ex, m.eyeY + 1, EYE_PUPIL);
    put(ex - 1, m.eyeY + 1, EYE_PUPIL);
    put(ex - 1, m.eyeY, EYE_GLINT);
  }

  // accessory
  if (spec.accessory !== "none") {
    const stamp = ACCESSORY_STAMPS[spec.accessory];
    const { ox, oy } = stamp.origin(m);
    stamp.rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const ch = row[rx];
        const c = stamp.palette[ch];
        if (c) put(ox + rx, oy + ry, c);
      }
    });
  }

  return { width: G, height: G, data };
}
