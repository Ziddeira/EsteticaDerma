#!/usr/bin/env python3
"""Gera a logo vetorial da Estética Derma Solução.

Recria em SVG o letreiro dourado da clínica (anéis entrelaçados, traço
caligráfico horizontal, monograma "Ds" e o nome em arco). Todo texto é
convertido em <path>, então o SVG renderiza igual em qualquer lugar, inclusive
dentro de <img>, sem depender de fontes instaladas.

Uso:
    python3 tools/build_logo.py --fonts <pasta com Parisienne-Regular.ttf e Cinzel[wght].ttf> --out public/assets/brand
"""
import argparse
import math
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

SIZE = 600
CX = CY = SIZE / 2
NAME = "ESTÉTICA DERMA SOLUÇÃO"

GOLD_STOPS = [
    (0.00, "#8C6A1E"),
    (0.22, "#D9B44A"),
    (0.42, "#F7E7A1"),
    (0.58, "#C99A2E"),
    (0.80, "#E8CC72"),
    (1.00, "#7D5C12"),
]


def fmt(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


def monogram(script):
    """Monograma 'Ds' centralizado no emblema; o 's' é ampliado e encaixado
    no bojo do 'D', como no letreiro da clínica."""
    cmap = script.getBestCmap()
    gs = script.getGlyphSet()
    upm = script["head"].unitsPerEm
    out = []
    # (caractere, tamanho, x, linha de base)
    for ch, size, x, base in (("D", 270, CX - 172, CY + 58), ("s", 330, CX + 80, CY + 60)):
        s = size / upm
        pen = SVGPathPen(gs, ntos=fmt)
        gs[cmap[ord(ch)]].draw(TransformPen(pen, (s, 0, 0, -s, x, base)))
        out.append(pen.getCommands())
    return " ".join(out)


def arc_text(serif, text, radius, size, tracking, center_deg=90.0):
    """Texto na parte inferior do círculo, lido da esquerda p/ direita,
    com o topo das letras voltado para o centro."""
    cmap = serif.getBestCmap()
    scale = size / serif["head"].unitsPerEm
    advs = [serif["hmtx"][cmap[ord(c)]][0] * scale for c in text]
    total = sum(advs) + tracking * (len(text) - 1)
    # raio médio da letra para medir o arco (a linha de base fica por fora)
    r_mid = radius - size * 0.35
    out = []
    s = 0.0
    gs = serif.getGlyphSet()
    for ch, adv in zip(text, advs):
        center_s = s + adv / 2
        theta = math.radians(center_deg) + (total / 2 - center_s) / r_mid
        px = CX + radius * math.cos(theta)
        py = CY + radius * math.sin(theta)
        rot = theta - math.pi / 2
        cr, sr = math.cos(rot), math.sin(rot)
        # glifo: origem no centro da base, y para cima -> rotaciona e translada
        a, b = scale * cr, scale * sr
        c, d = scale * sr, -scale * cr
        e = px - (adv / 2) * cr
        f = py - (adv / 2) * sr
        pen = SVGPathPen(gs, ntos=fmt)
        gs[cmap[ord(ch)]].draw(TransformPen(pen, (a, b, c, d, e, f)))
        out.append(pen.getCommands())
        s += adv + tracking
    return " ".join(p for p in out if p)


def ellipse_ring(cx, cy, rx, ry, rot, w_min, w_max, phase, steps=240):
    """Anel caligráfico: espessura varia suavemente ao longo do contorno."""
    outer, inner = [], []
    cr, sr = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    for k in range(steps + 1):
        t = 2 * math.pi * k / steps
        w = w_min + (w_max - w_min) * (0.5 + 0.5 * math.cos(t - math.radians(phase))) ** 2.2
        for sign, bucket in ((1, outer), (-1, inner)):
            x = (rx + sign * w / 2) * math.cos(t)
            y = (ry + sign * w / 2) * math.sin(t)
            bucket.append((cx + x * cr - y * sr, cy + x * sr + y * cr))
    d = "M" + " L".join(f"{fmt(x)} {fmt(y)}" for x, y in outer) + " Z "
    d += "M" + " L".join(f"{fmt(x)} {fmt(y)}" for x, y in reversed(inner)) + " Z"
    return d


def swoosh():
    """Traço horizontal ondulado, afinando nas pontas, com gancho à esquerda."""
    return (
        "M20 238 C8 256 28 274 58 281 C130 297 205 280 270 268 "
        "C330 257 400 252 470 258 C525 263 565 276 592 298 "
        "C562 281 522 270 470 265 C402 259 334 265 272 276 "
        "C204 289 126 306 54 288 C22 280 6 258 20 238 Z"
    )


def build_svg(script, serif, with_name=True, color=None, title="Estética Derma Solução"):
    fill = color or "url(#gold)"
    rings = [
        ellipse_ring(CX, CY, 212, 206, -6, 2.2, 13, 205),
        ellipse_ring(CX + 4, CY - 3, 226, 220, 10, 1.4, 6, 30),
        ellipse_ring(CX - 3, CY + 2, 238, 232, -14, 1.2, 4.5, 320),
    ]
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" role="img" aria-labelledby="t">',
        f"<title id=\"t\">{title}</title>",
    ]
    if not color:
        stops = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in GOLD_STOPS)
        parts.append(
            '<defs><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">'
            f"{stops}</linearGradient></defs>"
        )
    parts.append(f'<g fill="{fill}" fill-rule="nonzero">')
    for d in rings:
        parts.append(f'<path fill-rule="evenodd" d="{d}"/>')
    parts.append(f'<path d="{swoosh()}"/>')
    parts.append(f'<path d="{monogram(script)}"/>')
    if with_name:
        parts.append(f'<path d="{arc_text(serif, NAME, 188, 25, 6.2)}"/>')
    parts.append("</g></svg>")
    return "\n".join(parts) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fonts", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    script = TTFont(args.fonts / "Parisienne-Regular.ttf")
    serif = instantiateVariableFont(TTFont(args.fonts / "Cinzel[wght].ttf"), {"wght": 600})

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "logo.svg").write_text(build_svg(script, serif), encoding="utf-8")
    (args.out / "logo-white.svg").write_text(build_svg(script, serif, color="#FFFFFF"), encoding="utf-8")
    (args.out / "logo-mark.svg").write_text(build_svg(script, serif, with_name=False), encoding="utf-8")
    print("ok:", ", ".join(p.name for p in sorted(args.out.glob("*.svg"))))


if __name__ == "__main__":
    main()
