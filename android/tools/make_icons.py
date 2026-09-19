#!/usr/bin/env python3
"""Draws the launcher icon.

There is no image library in the build environment, and an icon is a few
rectangles, so the PNG is written directly: a header, one zlib-compressed
scanline per row, and a CRC per chunk. That keeps the icon reproducible from
source instead of a binary blob nobody can regenerate.

The mark is a dark tile with three light bars, which reads as a filled form at
launcher size and stays legible when the system rounds or masks it.
"""

import struct
import zlib
from pathlib import Path

# Density buckets Android asks for, as (folder, pixels).
SIZES = [
    ("mipmap-mdpi", 48),
    ("mipmap-hdpi", 72),
    ("mipmap-xhdpi", 96),
    ("mipmap-xxhdpi", 144),
    ("mipmap-xxxhdpi", 192),
]

BACKGROUND = (15, 23, 42)      # slate-900, the app's dark surface
BAR = (226, 232, 240)          # slate-200
ACCENT = (59, 130, 246)        # blue-500, the accent used in the theme


def chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def render(size: int) -> bytes:
    # Bars are expressed as fractions so every density gets the same drawing.
    bars = [
        (0.22, 0.28, 0.78, 0.36, BAR),
        (0.22, 0.44, 0.62, 0.52, BAR),
        (0.22, 0.60, 0.72, 0.68, ACCENT),
    ]

    scale = size / 100.0
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r, g, b = BACKGROUND
            for x0, y0, x1, y1, colour in bars:
                if x0 * scale <= x < x1 * scale and y0 * scale <= y < y1 * scale:
                    r, g, b = colour
                    break
            row += bytes((r, g, b))
        rows.append(row)

    # Each scanline is prefixed with its filter type; 0 means "no filter".
    raw = b"".join(b"\x00" + bytes(row) for row in rows)
    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def main() -> None:
    root = Path(__file__).resolve().parent.parent / "app" / "src" / "main" / "res"
    for folder, size in SIZES:
        target = root / folder
        target.mkdir(parents=True, exist_ok=True)
        (target / "ic_launcher.png").write_bytes(render(size))
        (target / "ic_launcher_round.png").write_bytes(render(size))
        print(f"{folder}/ic_launcher.png  {size}x{size}")


if __name__ == "__main__":
    main()
