#!/usr/bin/env node
/**
 * Génère l'icône tray de Junimo à partir de la silhouette classique définie
 * dans `src/junimo/model.ts` (tâche #45) — plus de forme dessinée à la main
 * (l'ancien `scripts/make_tray_icon.py` codait un blob ellipse+pattes qui ne
 * correspondait plus à la référence de Florian, cf. tâche #50).
 *
 * Réutilise directement `buildJunimoPixels` sur la grille native 32×32 du
 * modèle : la silhouette embarquée dans le tray est donc BIT-À-BIT la même
 * que celle affichée dans l'éditeur/le header, jamais une resynthèse à part.
 *
 * Sorties (toutes committées, voir `docs/specs/2026-07-15-ui-v3-polish.md`
 * section 10) :
 *   - src-tauri/icons/tray-icon.svg   → source vectorielle (1 <rect> par
 *     run de pixels opaques contigus sur une ligne), pour référence/design.
 *   - src-tauri/icons/tray-icon.png   → 32×32, EMBARQUÉE par tray.rs
 *     (`include_bytes!`). Voir la note sur la résolution ci-dessous.
 *   - src-tauri/icons/tray-icon@1x.png → 16×16, sous-échantillonnée par
 *     moyenne de blocs 2×2. Fournie pour respecter la convention @1x/@2x
 *     demandée, mais PAS chargée par le binaire (voir note).
 *   - src-tauri/icons/tray-anim-{0..3}.png → 4 frames (32×32) de l'animation
 *     de fin de chat (tâche #50 partie 2), embarquées par tray.rs.
 *
 * Note sur la résolution — pourquoi UNE seule image est réellement utilisée :
 * la crate `tray-icon` (sous-jacente à Tauri, v0.24.1) fixe la hauteur
 * affichée de l'icône de la barre de menu à 18pt QUELLE QUE SOIT la taille du
 * bitmap fourni (`icon_height: f64 = 18.0` dans
 * `set_icon_for_ns_status_item_button`, platform_impl/macos/mod.rs) — il n'y
 * a ni sélection @1x/@2x automatique, ni NSImage multi-représentation : un
 * seul PNG est chargé (`Image::from_bytes`) et son bitmap est redimensionné
 * à l'affichage. La pixelisation Retina observée avant #50 venait du fichier
 * 22×22 embarqué (22px < 36px = 18pt × facteur d'échelle 2 d'un écran
 * Retina), pas d'une histoire de fichier @2x manquant. La correction est
 * donc : embarquer un bitmap plus dense (32×32, mieux que les 22×22
 * précédents et proche des 36px nécessaires à un Retina standard) plutôt que
 * de fournir deux fichiers que l'API ne saurait pas choisir. Le fichier
 * `@1x` 16×16 est généré pour la traçabilité (et une éventuelle future
 * version de Tauri/tray-icon qui supporterait le multi-résolution) mais reste
 * un artefact non consommé — voir le commentaire équivalent dans tray.rs.
 *
 * Usage (Node ≥ 22, type-stripping natif, comme gen_junimo_preview.ts) :
 *   node scripts/gen_tray_icon.ts
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { buildJunimoPixels, JUNIMO_GRID, type JunimoSpec } from "../src/junimo/model.ts";

const G = JUNIMO_GRID; // 32 — grille native du modèle, reprise telle quelle.

// --- Encodeur PNG minimal (mêmes helpers que gen_junimo_preview.ts) ---------

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
  return concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}

// --- Masque de silhouette (template macOS : noir plein + alpha) ------------

/** 1 bit par pixel : `true` si le pixel appartient à la silhouette (n'importe
 * quel rôle dessiné par `buildJunimoPixels` — corps, tige, visage...), peu
 * importe sa couleur : le tray n'affiche qu'un masque alpha noir/transparent
 * (image "template", recolorée par macOS en clair/sombre). */
function maskFromSpec(spec: JunimoSpec): boolean[] {
  const { data } = buildJunimoPixels(spec);
  const mask = new Array<boolean>(G * G);
  for (let i = 0; i < G * G; i++) mask[i] = data[i * 4 + 3] > 0;
  return mask;
}

/** Rend un masque en PNG "template" : noir plein (0,0,0) sous le masque,
 * transparent ailleurs — pas d'anti-aliasing à la résolution native (pixel
 * art), fidèle à la grille du modèle. */
function renderTemplatePng(mask: boolean[], size: number): Uint8Array {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4 + 3] = mask[i] ? 255 : 0; // R/G/B restent à 0 (noir)
  }
  return encodePng(size, size, rgba);
}

/** Sous-échantillonne un masque `size×size` en `size/factor` par moyenne de
 * blocs (anti-aliasing simple), toujours rendu en template noir+alpha. */
function downsampleTemplatePng(mask: boolean[], size: number, factor: number): Uint8Array {
  const outSize = size / factor;
  const rgba = new Uint8ClampedArray(outSize * outSize * 4);
  for (let oy = 0; oy < outSize; oy++) {
    for (let ox = 0; ox < outSize; ox++) {
      let hits = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const sx = ox * factor + dx;
          const sy = oy * factor + dy;
          if (mask[sy * size + sx]) hits++;
        }
      }
      const alpha = Math.round((255 * hits) / (factor * factor));
      rgba[(oy * outSize + ox) * 4 + 3] = alpha;
    }
  }
  return encodePng(outSize, outSize, rgba);
}

/** Source vectorielle : un <rect> par run horizontal de pixels opaques
 * contigus (compact, et strictement fidèle au masque — pas de simplification
 * géométrique qui pourrait dévier de la silhouette #45). */
function svgFromMask(mask: boolean[], size: number): string {
  const rects: string[] = [];
  for (let y = 0; y < size; y++) {
    let runStart = -1;
    for (let x = 0; x <= size; x++) {
      const on = x < size && mask[y * size + x];
      if (on && runStart < 0) runStart = x;
      if (!on && runStart >= 0) {
        rects.push(`<rect x="${runStart}" y="${y}" width="${x - runStart}" height="1"/>`);
        runStart = -1;
      }
    }
  }
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!-- Généré par scripts/gen_tray_icon.ts — NE PAS ÉDITER À LA MAIN.`,
    `     Silhouette junimo classique (tâche #45), pose de repos.`,
    `     Un <rect> par run horizontal de pixels opaques : source vectorielle`,
    `     du masque "template" macOS (noir plein + alpha), fidèle pixel pour`,
    `     pixel à la grille 32×32 de src/junimo/model.ts. -->`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges">`,
    `<g fill="#000000">`,
    ...rects,
    `</g>`,
    `</svg>`,
    ``,
  ].join("\n");
}

// --- Génération --------------------------------------------------------------

const restSpec: JunimoSpec = { shape: "classic", color: "green", accessory: "none", pose: "idle", frame: 0 };
const restMask = maskFromSpec(restSpec);

writeFileSync("src-tauri/icons/tray-icon.svg", svgFromMask(restMask, G));
console.log("wrote src-tauri/icons/tray-icon.svg (32x32 vector source)");

writeFileSync("src-tauri/icons/tray-icon.png", renderTemplatePng(restMask, G));
console.log(`wrote src-tauri/icons/tray-icon.png (${G}x${G}, embarquée par tray.rs)`);

writeFileSync("src-tauri/icons/tray-icon@1x.png", downsampleTemplatePng(restMask, G, 2));
console.log(`wrote src-tauri/icons/tray-icon@1x.png (${G / 2}x${G / 2}, référence — non chargée par le binaire)`);

// Animation de fin de chat (~2 s, 4 frames swap via `set_icon`, voir
// tray.rs::play_end_of_chat_animation) : petite célébration bras-levés puis
// retour à la pose de repos, réutilisant telles quelles les poses "celebrate"
// et le rebond idle déjà définis dans model.ts (tâche #45/#49) — aucune
// pose n'est réinventée ici.
const animSpecs: JunimoSpec[] = [
  { shape: "classic", color: "green", accessory: "none", pose: "celebrate", frame: 0 },
  { shape: "classic", color: "green", accessory: "none", pose: "celebrate", frame: 1 },
  { shape: "classic", color: "green", accessory: "none", pose: "celebrate", frame: 0 },
  restSpec,
];
animSpecs.forEach((spec, i) => {
  const mask = maskFromSpec(spec);
  const path = `src-tauri/icons/tray-anim-${i}.png`;
  writeFileSync(path, renderTemplatePng(mask, G));
  console.log(`wrote ${path} (${G}x${G})`);
});
