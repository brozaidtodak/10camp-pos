#!/usr/bin/env python3
"""Remap off-brand purple/blue/teal colors to 10 CAMP Sunset Bronze scale.
Brand palette (per official PDF): Sunset Bronze #CD7C32, Tropical Black #101010,
Cloudy White (warm-cream override) #FAF6EF. Status colors (green/red/amber) untouched.
Run: python3 scripts/brand_color_migrate.py [--apply]
"""
import re, sys, io

APPLY = "--apply" in sys.argv
FILES = ["index.html", "app.js", "design-tokens.css", "style.css"]

# hex map: off-brand -> bronze shade matched by tone (dark->dark, light->light)
HEX = {
    # purple / indigo
    "#4c1d95": "#5a3413", "#5b21b6": "#7c4a1a", "#6d28d9": "#a05f22",
    "#7c3aed": "#a05f22", "#9333ea": "#b86a26", "#a855f7": "#cd7c32",
    "#8b5cf6": "#cd7c32", "#6366f1": "#cd7c32", "#818cf6": "#e89348",
    "#a78bfa": "#e89348", "#c4b5fd": "#fdba74", "#ddd6fe": "#fed7aa",
    "#ede9fe": "#ffedd5", "#f3e8ff": "#fff8f0", "#faf5ff": "#fff8f0",
    # blue / sky
    "#1e40af": "#7c4a1a", "#1d4ed8": "#a05f22", "#2563eb": "#b86a26",
    "#3b82f6": "#cd7c32", "#0ea5e9": "#cd7c32", "#0284c7": "#b86a26",
    "#0891b2": "#b86a26", "#60a5fa": "#e89348", "#93c5fd": "#fdba74",
    "#bfdbfe": "#fed7aa", "#dbeafe": "#ffedd5", "#eff6ff": "#fff8f0",
    # teal / cyan (safety)
    "#14b8a6": "#cd7c32", "#0d9488": "#b86a26", "#2dd4bf": "#e89348",
    "#06b6d4": "#cd7c32", "#22d3ee": "#e89348",
    # p1_594 — indigo/purple/pink/sky yang masih tinggal (audit 2026-06-10)
    "#3730a3": "#7c4a1a", "#4f46e5": "#a05f22", "#4338ca": "#7c4a1a",
    "#e0e7ff": "#fff8f0", "#c7d2fe": "#ffedd5", "#eef2ff": "#fff8f0",
    "#818cf8": "#e89348", "#6b21a8": "#7c4a1a", "#86198f": "#7c4a1a",
    "#ec4899": "#cd7c32", "#fae8ff": "#fff8f0",
    "#0369a1": "#a05f22", "#eef4fd": "#fff8f0", "#e0f2fe": "#fff8f0",
    "#bae6fd": "#fed7aa", "#f0f9ff": "#fff8f0",
    # NOTA: #0f172a (slate near-black) SENGAJA tak dipetakan — hampir hitam, bukan
    # warna terang luap; petakan ke #101010 boleh jadi hitam-atas-hitam (teks halimunan).
}
# rgba map: (r,g,b) off-brand -> bronze rgb (keep alpha)
RGBA = {
    (59, 130, 246): (205, 124, 50),   # 3b82f6 -> cd7c32
    (139, 92, 246): (205, 124, 50),   # 8b5cf6 -> cd7c32
    (168, 85, 247): (205, 124, 50),   # a855f7 -> cd7c32
    (37, 99, 235): (184, 106, 38),    # 2563eb -> b86a26
    (55, 48, 163): (124, 74, 26),     # 3730a3 -> 7c4a1a
    (79, 70, 229): (160, 95, 34),     # 4f46e5 -> a05f22
    (99, 102, 241): (205, 124, 50),   # 6366f1 -> cd7c32
    (236, 72, 153): (205, 124, 50),   # ec4899 -> cd7c32
}

def migrate(text):
    n = 0
    # hex (case-insensitive). Match #rrggbb not followed by another hex digit.
    def hex_sub(m):
        nonlocal n
        key = m.group(0).lower()
        if key in HEX:
            n += 1
            return HEX[key]
        return m.group(0)
    text = re.sub(r"#[0-9a-fA-F]{6}\b", hex_sub, text)
    # rgba/rgb
    def rgba_sub(m):
        nonlocal n
        r, g, b = int(m.group(2)), int(m.group(3)), int(m.group(4))
        if (r, g, b) in RGBA:
            n += 1
            nr, ng, nb = RGBA[(r, g, b)]
            return f"{m.group('fn')}({nr}, {ng}, {nb}"
        return m.group(0)
    text = re.sub(r"(?P<fn>rgba?)\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})", rgba_sub, text)
    return text, n

# Baris ROADMAP_DATA (cth `{ id:'p1_386', label:'...#7C3AED...' }`) ada hex dalam teks
# SEJARAH — JANGAN tukar (akan korup rekod). Langkau baris yang nampak macam entri roadmap.
ROADMAP_LINE = re.compile(r"id:\s*'p\d|num:\s*'PHASE")

total = 0
for f in FILES:
    src = io.open(f, encoding="utf-8").read()
    if f == "index.html":
        out_lines, n = [], 0
        for line in src.splitlines(keepends=True):
            if ROADMAP_LINE.search(line):
                out_lines.append(line)  # lindungi teks roadmap
            else:
                nl, c = migrate(line); out_lines.append(nl); n += c
        new = "".join(out_lines)
    else:
        new, n = migrate(src)
    total += n
    print(f"  {f:24s} {n:4d} replacements")
    if APPLY and n:
        io.open(f, "w", encoding="utf-8").write(new)
print(f"  {'TOTAL':24s} {total:4d}")
print("APPLIED" if APPLY else "DRY-RUN (no files changed). Re-run with --apply to write.")
