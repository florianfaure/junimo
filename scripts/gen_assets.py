#!/usr/bin/env python3
"""Genere les assets pixel-art de Junimo (spritesheet + bordure 9-slice)
sans dependance externe (pas de Pillow, pas d'IA) : chaque pixel est pose
a la main dans une matrice puis encode en PNG via zlib/struct (stdlib).
"""
import struct
import zlib
import os
from pathlib import Path

# Chemin portable : dossier `src/assets/sprites` du repo, resolu relativement
# a ce script (fonctionne depuis n'importe quel clone, sans dependre du home
# ni de l'emplacement du repo sur le disque).
OUT_SPRITES = str(Path(__file__).resolve().parent.parent / "src" / "assets" / "sprites")
os.makedirs(OUT_SPRITES, exist_ok=True)


def write_png(path, width, height, pixels):
    """pixels: list of rows, each row a list of (r,g,b,a) tuples, len == width."""
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter: none
        for (r, g, b, a) in row:
            raw += bytes((r, g, b, a))
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))


TRANSPARENT = (0, 0, 0, 0)


def new_canvas(w, h):
    return [[TRANSPARENT for _ in range(w)] for _ in range(h)]


def set_px(canvas, x, y, color):
    h = len(canvas)
    w = len(canvas[0])
    if 0 <= x < w and 0 <= y < h:
        canvas[y][x] = color


# --- Palette junimo (accent vert Stardew) ---
BODY = (63, 174, 73, 255)       # #3fae49 vert principal
BODY_HI = (128, 214, 108, 255)  # highlight haut
BODY_SHADE = (36, 110, 46, 255)  # ombre bas
OUTLINE = (18, 46, 22, 255)     # contour tres sombre
FOOT = (32, 79, 38, 255)        # pattes
EYE_WHITE = (242, 229, 201, 255)  # #f2e5c9 creme
EYE_PUPIL = (25, 18, 12, 255)


def draw_junimo_frame(size, bounce, squash, feet_out):
    """size: dimension carree (16 ou 24). bounce: offset vertical (px, negatif = monte).
    squash: 0 = rond normal, 1 = ecrase (atterrissage). feet_out: bool, pattes visibles."""
    c = new_canvas(size, size)
    cx = size / 2 - 0.5
    cy = size / 2 - 0.5 + bounce
    rx = size * 0.30 + (0.06 * size if squash else 0)
    ry = size * 0.30 - (0.06 * size if squash else 0)

    for y in range(size):
        for x in range(size):
            nx = (x - cx) / rx
            ny = (y - cy) / ry
            d = nx * nx + ny * ny
            if d <= 1.0:
                # ombre en bas, highlight en haut-gauche
                if ny > 0.35:
                    col = BODY_SHADE
                elif nx < -0.25 and ny < -0.15:
                    col = BODY_HI
                else:
                    col = BODY
                set_px(c, x, y, col)
            elif d <= 1.22:
                set_px(c, x, y, OUTLINE)

    # yeux (2 points blancs + pupille), positionnes relatifs au centre du corps
    eye_y = int(round(cy - ry * 0.15))
    eye_dx = max(2, int(round(rx * 0.45)))
    for ex in (int(round(cx)) - eye_dx, int(round(cx)) + eye_dx):
        set_px(c, ex, eye_y, EYE_WHITE)
        set_px(c, ex, eye_y + 1, EYE_PUPIL)

    # pattes : deux petits rectangles sombres sous le corps
    if feet_out:
        foot_y = int(round(cy + ry)) + 1
        foot_dx = max(2, int(round(rx * 0.5)))
        for fx in (int(round(cx)) - foot_dx, int(round(cx)) + foot_dx):
            set_px(c, fx, foot_y, FOOT)
            set_px(c, fx - 1 if fx - 1 >= 0 else fx, foot_y, FOOT)
    return c


def build_spritesheet(size, frames_spec, path):
    frames = [draw_junimo_frame(size, **spec) for spec in frames_spec]
    w = size * len(frames)
    h = size
    sheet = new_canvas(w, h)
    for i, frame in enumerate(frames):
        for y in range(size):
            for x in range(size):
                sheet[y][i * size + x] = frame[y][x]
    write_png(path, w, h, sheet)
    print(f"wrote {path} ({w}x{h})")


# 4 frames idle bounce : repos -> compression (atterrissage) -> saut (monte) -> redescente
FRAMES = [
    {"bounce": 0, "squash": False, "feet_out": True},
    {"bounce": 0, "squash": True, "feet_out": True},
    {"bounce": -2, "squash": False, "feet_out": False},
    {"bounce": -1, "squash": False, "feet_out": True},
]

build_spritesheet(24, FRAMES, os.path.join(OUT_SPRITES, "junimo.png"))


# --- Bordure 9-slice pixel (tuile 48x48, coins nets, degrade brun -> or) ---
def build_border_tile(size, path):
    c = new_canvas(size, size)
    edge = max(3, size // 4)  # epaisseur du cadre en pixels (doit matcher border-image-slice en CSS)
    GOLD = (217, 142, 43, 255)      # #d98e2b
    GOLD_HI = (240, 178, 90, 255)
    BROWN = (138, 78, 42, 255)       # #8a4e2a
    BROWN_DARK = (79, 43, 22, 255)
    BG = (0, 0, 0, 0)

    for y in range(size):
        for x in range(size):
            dist = min(x, y, size - 1 - x, size - 1 - y)
            if dist >= edge:
                set_px(c, x, y, BG)
                continue
            if dist == 0:
                col = BROWN_DARK
            elif dist < edge * 0.4:
                col = GOLD_HI if (x + y) % 2 == 0 else GOLD
            elif dist < edge * 0.75:
                col = GOLD
            else:
                col = BROWN
            set_px(c, x, y, col)

    # coins nets : petites encoches pixel pour casser l'arrondi
    notch = max(1, edge // 3)
    for (ox, oy) in [(0, 0), (size - notch, 0), (0, size - notch), (size - notch, size - notch)]:
        for yy in range(oy, oy + notch):
            for xx in range(ox, ox + notch):
                set_px(c, xx, yy, BG)

    write_png(path, size, size, c)
    print(f"wrote {path} ({size}x{size})")


build_border_tile(48, os.path.join(OUT_SPRITES, "panel-border.png"))
