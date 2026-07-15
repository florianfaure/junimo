#!/usr/bin/env node
/**
 * Renders a contact sheet of every junimo combination to a PNG, so the
 * pixel-art can be reviewed outside a browser. Reuses the DOM-free model from
 * `src/junimo/model.ts` — the same code the app renders to <canvas>.
 *
 * Usage (Node >= 22, native TS type-stripping):
 *   node scripts/gen_junimo_preview.ts [out.png] [scale]
 *
 * Default output: junimo-preview.png (git-ignored), scale 4.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import {
  buildJunimoPixels,
  JUNIMO_SHAPES,
  JUNIMO_COLORS,
  JUNIMO_ACCESSORIES,
  JUNIMO_GRID,
  type JunimoSpec,
} from "../src/junimo/model.ts";

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function concat(arrs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
function chunk(tag: string, data: Uint8Array): Uint8Array {
  const t = Uint8Array.from(tag, (ch) => ch.charCodeAt(0));
  const body = concat([t, data]);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(body));
  return concat([len, body, crc]);
}
function encodePng(w: number, h: number, rgba: Uint8ClampedArray): Uint8Array {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = w * 4 + 1;
  const raw = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: none
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * stride + 1);
  }
  return concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

const G = JUNIMO_GRID;
const scale = Number(process.argv[3] ?? 4);
const cell = G * scale;
const pad = 6;

const shapes = JUNIMO_SHAPES.map((s) => s.id);
const colors = JUNIMO_COLORS.map((c) => c.id);
const accs = JUNIMO_ACCESSORIES.filter((a) => a.id !== "none").map((a) => a.id);

// Bande « poses » : par forme, on montre repos frame 0, rebond (frame 1) et
// célébration (bras levés) — de quoi valider les poses de la tâche #45/#49.
const poseSpecs: JunimoSpec[] = shapes.flatMap((shape) => [
  { shape, color: "green", accessory: "none", frame: 0 },
  { shape, color: "green", accessory: "none", frame: 1 },
  { shape, color: "green", accessory: "none", pose: "celebrate" },
]);

const cols = Math.max(colors.length, poseSpecs.length, accs.length);
// shapes×colors, accessoires×couleurs (cycle de formes), 1 bande poses, puis
// la matrice complète forme × accessoire (tâche #46 : vérifie que CHAQUE
// accessoire se pose correctement sur CHAQUE forme, pas seulement sur celle
// que le cycle de couleurs lui associait plus haut).
const rows = shapes.length + accs.length + 1 + shapes.length;
const W = pad + cols * (cell + pad);
const H = pad + rows * (cell + pad);
const sheet = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) {
  sheet[i * 4] = 24;
  sheet[i * 4 + 1] = 26;
  sheet[i * 4 + 2] = 30;
  sheet[i * 4 + 3] = 255;
}

function draw(spec: JunimoSpec, dx: number, dy: number) {
  const { width, height, data } = buildJunimoPixels(spec);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      if (data[si + 3] === 0) continue;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const di = ((dy + y * scale + sy) * W + (dx + x * scale + sx)) * 4;
          sheet[di] = data[si];
          sheet[di + 1] = data[si + 1];
          sheet[di + 2] = data[si + 2];
          sheet[di + 3] = 255;
        }
      }
    }
  }
}

let row = 0;
for (const shape of shapes) {
  colors.forEach((color, ci) => {
    draw({ shape, color, accessory: "none" }, pad + ci * (cell + pad), pad + row * (cell + pad));
  });
  row++;
}
for (const accessory of accs) {
  colors.forEach((color, ci) => {
    const shape = shapes[ci % shapes.length];
    draw({ shape, color, accessory }, pad + ci * (cell + pad), pad + row * (cell + pad));
  });
  row++;
}
poseSpecs.forEach((spec, ci) => {
  draw(spec, pad + ci * (cell + pad), pad + row * (cell + pad));
});
row++;

// Matrice complète forme × accessoire (une couleur fixe, "green") : une
// rangée par forme, une colonne par accessoire — permet de vérifier d'un
// coup d'œil que chaque accessoire tombe juste sur chaque silhouette (haut
// plat de la classique, pointe de l'étoile/goutte, dôme du fantôme...).
for (const shape of shapes) {
  accs.forEach((accessory, ci) => {
    draw(
      { shape, color: "green", accessory },
      pad + ci * (cell + pad),
      pad + row * (cell + pad),
    );
  });
  row++;
}

const out = process.argv[2] ?? "junimo-preview.png";
writeFileSync(out, encodePng(W, H, sheet));
console.log(`wrote ${out} (${W}x${H}, scale ${scale})`);
