/**
 * composeJunimo — framework-agnostic junimo compositor.
 *
 * Turns a {shape, color, accessory} spec into a crisp pixel-art <canvas>
 * (nearest-neighbor scaling, no smoothing). The heavy lifting lives in the
 * DOM-free `model.ts`; this file is the thin canvas layer consumed by the UI
 * and the junimo editor (task #33 uses this interface as-is).
 *
 * @example
 * import { composeJunimo, JUNIMO_COLORS } from "./junimo/compose.ts";
 * const canvas = composeJunimo({ shape: "classic", color: "green", accessory: "hat" });
 * document.body.appendChild(canvas);
 */

import { buildJunimoPixels, JUNIMO_GRID, type JunimoSpec } from "./model.ts";

export interface ComposeOptions {
  /** Integer pixel scale (nearest-neighbor). Default 1 (native 32×32). */
  scale?: number;
}

/** Compose a junimo into an HTMLCanvasElement. */
export function composeJunimo(
  spec: JunimoSpec,
  options: ComposeOptions = {},
): HTMLCanvasElement {
  const scale = Math.max(1, Math.floor(options.scale ?? 1));
  const { width, height, data } = buildJunimoPixels(spec);

  const base = document.createElement("canvas");
  base.width = width;
  base.height = height;
  const bctx = base.getContext("2d");
  if (!bctx) throw new Error("2D canvas context unavailable");
  const img = bctx.createImageData(width, height);
  img.data.set(data);
  bctx.putImageData(img, 0, 0);

  if (scale === 1) {
    base.style.imageRendering = "pixelated";
    return base;
  }

  const out = document.createElement("canvas");
  out.width = width * scale;
  out.height = height * scale;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("2D canvas context unavailable");
  octx.imageSmoothingEnabled = false;
  octx.drawImage(base, 0, 0, out.width, out.height);
  out.style.imageRendering = "pixelated";
  return out;
}

/** Compose a junimo and return a PNG data URL (handy for <img src>). */
export function composeJunimoDataURL(
  spec: JunimoSpec,
  options: ComposeOptions = {},
): string {
  return composeJunimo(spec, options).toDataURL("image/png");
}

export { JUNIMO_GRID };
export {
  JUNIMO_FRAME_COUNT,
  JUNIMO_SHAPES,
  JUNIMO_COLORS,
  JUNIMO_ACCESSORIES,
  buildJunimoPixels,
  rampFor,
} from "./model.ts";
export type {
  JunimoSpec,
  JunimoShapeId,
  JunimoColorId,
  JunimoAccessoryId,
  JunimoPose,
  JunimoShapeDef,
  JunimoColorDef,
  JunimoAccessoryDef,
  ColorRamp,
  PixelBuffer,
  RGBA,
} from "./model.ts";
