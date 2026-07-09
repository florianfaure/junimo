#!/usr/bin/env python3
"""Genere l'icone tray de Junimo : silhouette monochrome noir-sur-transparent
(image "template" macOS, recoloree automatiquement par la barre de menu
claire/sombre). Aucune dependance externe (pas de Pillow) : rendu par
supersampling + primitives geometriques (ellipses/rectangles), encode en PNG
via zlib/struct (stdlib uniquement), comme scripts/gen_assets.py.

Usage :
    python3 scripts/make_tray_icon.py [out.png] [size]

Sans argument, regenere directement les deux tailles standard macOS
(22x22 @1x, 44x44 @2x) dans src-tauri/icons/.
"""
import struct
import sys
import zlib

# Supersampling : chaque pixel final est la moyenne de SS x SS sous-echantillons,
# ce qui donne un contour anti-aliase lisible meme a 22px (icone tray minuscule).
SUPERSAMPLE = 8


def in_ellipse(x: float, y: float, cx: float, cy: float, rx: float, ry: float) -> bool:
    dx = (x - cx) / rx
    dy = (y - cy) / ry
    return dx * dx + dy * dy <= 1.0


def in_rect(x: float, y: float, x0: float, y0: float, x1: float, y1: float) -> bool:
    return x0 <= x <= x1 and y0 <= y <= y1


def silhouette(x: float, y: float, s: float) -> bool:
    """Silhouette du junimo en coordonnees unitaires [0, s). Reconnaissable a
    trois traits : corps rond, deux petites pattes qui depassent en bas,
    une feuille sur une petite antenne au-dessus de la tete."""
    cx = s / 2

    # Corps : blob arrondi, legerement aplati (moins haut que large, comme
    # les junimos de Stardew Valley) plutot qu'un cercle parfait.
    body_cy = s * 0.58
    body_rx = s * 0.30
    body_ry = s * 0.27
    if in_ellipse(x, y, cx, body_cy, body_rx, body_ry):
        # Deux petits yeux perces dans le corps (negative space) pour rester
        # reconnaissable comme un visage, meme a 22px.
        eye_dx = body_rx * 0.42
        eye_cy = body_cy - body_ry * 0.10
        eye_r = s * 0.045
        if in_ellipse(x, y, cx - eye_dx, eye_cy, eye_r, eye_r):
            return False
        if in_ellipse(x, y, cx + eye_dx, eye_cy, eye_r, eye_r):
            return False
        return True

    # Pattes : deux petits pieds qui depassent sous le corps.
    foot_w = s * 0.11
    foot_h = s * 0.075
    foot_y0 = body_cy + body_ry - s * 0.03
    foot_y1 = foot_y0 + foot_h
    left_foot_cx = cx - body_rx * 0.55
    right_foot_cx = cx + body_rx * 0.55
    if in_rect(x, y, left_foot_cx - foot_w / 2, foot_y0, left_foot_cx + foot_w / 2, foot_y1):
        return True
    if in_rect(x, y, right_foot_cx - foot_w / 2, foot_y0, right_foot_cx + foot_w / 2, foot_y1):
        return True

    # Antenne + feuille : tige fine partant du sommet de la tete, terminee
    # par une petite feuille ovale inclinee.
    stem_top = body_cy - body_ry - s * 0.20
    stem_bottom = body_cy - body_ry + s * 0.02
    stem_w = s * 0.045
    if in_rect(x, y, cx - stem_w / 2, stem_top, cx + stem_w / 2, stem_bottom):
        return True

    leaf_cx = cx + s * 0.05
    leaf_cy = stem_top - s * 0.02
    if in_ellipse(x, y, leaf_cx, leaf_cy, s * 0.11, s * 0.06):
        return True

    return False


def render(size: int) -> list:
    """Retourne une matrice RGBA (size x size), noir a alpha variable."""
    pixels = []
    step = 1.0 / SUPERSAMPLE
    for py in range(size):
        row = []
        for px in range(size):
            hits = 0
            for sy in range(SUPERSAMPLE):
                y = py + (sy + 0.5) * step
                for sx in range(SUPERSAMPLE):
                    x = px + (sx + 0.5) * step
                    if silhouette(x, y, size):
                        hits += 1
            alpha = round(255 * hits / (SUPERSAMPLE * SUPERSAMPLE))
            row.append((0, 0, 0, alpha))
        pixels.append(row)
    return pixels


def write_png(path: str, size: int, pixels: list) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter type 0 (none)
        for (r, g, b, a) in row:
            raw += bytes((r, g, b, a))
    idat = zlib.compress(bytes(raw), 9)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")

    with open(path, "wb") as f:
        f.write(png)


def make_png(path: str, size: int) -> None:
    pixels = render(size)
    write_png(path, size, pixels)
    print(f"wrote {path} ({size}x{size})")


if __name__ == "__main__":
    if len(sys.argv) >= 3:
        make_png(sys.argv[1], int(sys.argv[2]))
    else:
        make_png("src-tauri/icons/tray-icon.png", 22)
        make_png("src-tauri/icons/tray-icon@2x.png", 44)
