#!/usr/bin/env python3
"""Generate Athom-compliant widget previews (no text, no screenshots)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
ROOT = Path(__file__).resolve().parent

COLORS = {
    "pv": "#E6A817",
    "house": "#7AB31B",
    "grid": "#5B8DEF",
    "battery": "#7AB31B",
    "wallbox": "#8B6CC1",
}


def hex_rgb(color: str) -> tuple[int, int, int]:
    color = color.lstrip("#")
    return tuple(int(color[i : i + 2], 16) for i in (0, 2, 4))


def rgba(color: str, alpha: int) -> tuple[int, int, int, int]:
    r, g, b = hex_rgb(color)
    return r, g, b, alpha


def rounded_rect(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    radius: int,
    *,
    fill: tuple[int, int, int, int] | None = None,
    outline: tuple[int, int, int, int] | None = None,
    width: int = 2,
) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def draw_shadow(base: Image.Image, box: tuple[int, int, int, int], radius: int, blur: int = 18) -> None:
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    shadow = Image.new("RGBA", (w + blur * 2, h + blur * 2), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.rounded_rectangle(
        (blur, blur, blur + w, blur + h),
        radius=radius,
        fill=(0, 0, 0, 55),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(shadow, (x0 - blur, y0 - blur + 8))


def draw_solar_panel(draw: ImageDraw.ImageDraw, cx: int, cy: int, color: str, scale: float = 1.0) -> None:
    w = int(14 * scale)
    h = int(10 * scale)
    # main panel
    draw.rectangle((cx - w//2, cy - h//2, cx + w//2, cy + h//2), fill=rgba(color, 255), outline=(40,40,40,255))
    # grid lines
    for i in range(1, 3):
        draw.line((cx - w//2, cy - h//2 + i*h//3, cx + w//2, cy - h//2 + i*h//3), fill=(40,40,40,255), width=1)
    for i in range(1, 3):
        draw.line((cx - w//2 + i*w//3, cy - h//2, cx - w//2 + i*w//3, cy + h//2), fill=(40,40,40,255), width=1)
    # legs
    draw.line((cx - w//3, cy + h//2, cx - w//3, cy + h//2 + 4*scale), fill=(40,40,40,255), width=1)
    draw.line((cx + w//3, cy + h//2, cx + w//3, cy + h//2 + 4*scale), fill=(40,40,40,255), width=1)


def draw_house(draw: ImageDraw.ImageDraw, cx: int, cy: int, color: str, scale: float = 1.0) -> None:
    w = int(18 * scale)
    h = int(14 * scale)
    roof_h = int(9 * scale)
    # body
    draw.rectangle((cx - w//2, cy - h//4, cx + w//2, cy + h//2), fill=rgba(color, 255), outline=(40,40,40,255))
    # roof
    roof = [
        (cx - w//2 - 2, cy - h//4),
        (cx, cy - h//4 - roof_h),
        (cx + w//2 + 2, cy - h//4),
    ]
    draw.polygon(roof, fill=rgba(color, 255), outline=(40,40,40,255))
    # door
    draw.rectangle((cx - 3*scale, cy + 1, cx + 3*scale, cy + h//2), fill=(40,40,40,255))
    # window
    draw.rectangle((cx - w//3, cy - h//8, cx - w//6, cy + h//8), fill=(255,255,255,255), outline=(40,40,40,255))


def draw_pylon(draw: ImageDraw.ImageDraw, cx: int, cy: int, color: str, scale: float = 1.0) -> None:
    s = scale
    # vertical poles
    draw.line((cx - 2*s, cy - 10*s, cx - 2*s, cy + 10*s), fill=(40,40,40,255), width=max(2, int(1.5*s)))
    draw.line((cx + 2*s, cy - 10*s, cx + 2*s, cy + 10*s), fill=(40,40,40,255), width=max(2, int(1.5*s)))
    # cross bars
    draw.line((cx - 6*s, cy - 6*s, cx + 6*s, cy - 6*s), fill=(40,40,40,255), width=max(2, int(1*s)))
    draw.line((cx - 5*s, cy - 2*s, cx + 5*s, cy - 2*s), fill=(40,40,40,255), width=max(2, int(1*s)))
    draw.line((cx - 4*s, cy + 2*s, cx + 4*s, cy + 2*s), fill=(40,40,40,255), width=max(2, int(1*s)))
    # top
    draw.line((cx - 2*s, cy - 10*s, cx + 2*s, cy - 10*s), fill=(40,40,40,255), width=max(2, int(1.5*s)))
    # wires
    draw.line((cx - 8*s, cy - 8*s, cx - 3*s, cy - 8*s), fill=(80,80,80,255), width=1)
    draw.line((cx + 3*s, cy - 8*s, cx + 8*s, cy - 8*s), fill=(80,80,80,255), width=1)


def draw_battery(draw: ImageDraw.ImageDraw, cx: int, cy: int, color: str, scale: float = 1.0) -> None:
    w = int(14 * scale)
    h = int(20 * scale)
    # body
    rounded_rect(draw, (cx - w//2, cy - h//2, cx + w//2, cy + h//2), int(2*scale), fill=rgba(color, 30), outline=rgba(color, 255), width=max(2, int(1.5*scale)))
    # cap (above body)
    cap_y0 = cy - h//2 - int(3*scale)
    cap_y1 = cy - h//2
    rounded_rect(draw, (cx - w//3, cap_y0, cx + w//3, cap_y1), 1, fill=rgba(color, 255))
    # lines inside
    for i in [-2, 0, 2]:
        draw.line((cx - 4*scale, cy + i*scale, cx + 4*scale, cy + i*scale), fill=rgba(color, 180), width=1)


def draw_wallbox(draw: ImageDraw.ImageDraw, cx: int, cy: int, color: str, scale: float = 1.0) -> None:
    w = int(16 * scale)
    h = int(14 * scale)
    # charger box
    rounded_rect(draw, (cx - w//2, cy - h//2, cx + w//2, cy + h//2), int(2*scale), fill=rgba(color, 40), outline=rgba(color, 255), width=max(2, int(1.5*scale)))
    # cable
    draw.arc((cx, cy - 2*scale, cx + 10*scale, cy + 6*scale), 200, 340, fill=(40,40,40,255), width=max(2, int(1.5*scale)))
    # plug
    draw.rectangle((cx + 8*scale, cy, cx + 12*scale, cy + 4*scale), fill=(40,40,40,255))
    # handle on box
    draw.rectangle((cx - w//2 + 2, cy - 2, cx - w//2 + 5, cy + 2), fill=(255,255,255,255))


def draw_flow_line(
    draw: ImageDraw.ImageDraw,
    p1: tuple[int, int],
    p2: tuple[int, int],
    color: str,
    *,
    active: bool,
) -> None:
    alpha = 220 if active else 70
    width = 4 if active else 2
    draw.line((*p1, *p2), fill=rgba(color, alpha), width=width)


def make_canvas() -> Image.Image:
    return Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))


def palette(dark: bool) -> dict[str, tuple[int, int, int, int]]:
    if dark:
        return {
            "card": (40, 40, 40, 245),
            "card_stroke": (70, 70, 70, 180),
            "label": (120, 120, 120, 255),
            "value": (200, 200, 200, 255),
            "divider": (90, 90, 90, 255),
            "node_fill": (36, 36, 36, 255),
        }
    return {
        "card": (255, 255, 255, 245),
        "card_stroke": (220, 220, 220, 200),
        "label": (190, 190, 190, 255),
        "value": (210, 210, 210, 255),
        "divider": (230, 230, 230, 255),
        "node_fill": (255, 255, 255, 255),
    }


def generate_power_overview(dark: bool) -> Image.Image:
    img = make_canvas()
    draw = ImageDraw.Draw(img)
    pal = palette(dark)

    card = (212, 300, 812, 724)
    draw_shadow(img, card, 28)
    rounded_rect(draw, card, 28, fill=pal["card"], outline=pal["card_stroke"], width=2)

    rows = [
        ("house", 0.55),
        ("pv", 0.48),
        ("grid", 0.38),
        ("battery", 0.42),
        ("wallbox", 0.35),
    ]
    y = 360
    row_h = 58
    for idx, (key, value_frac) in enumerate(rows):
        if idx == 0:
            draw.line((260, y - 18, 764, y - 18), fill=pal["divider"], width=2)

        cy = y + row_h // 2
        dot_r = 7
        color = COLORS[key]
        draw.ellipse((248 - dot_r, cy - dot_r, 248 + dot_r, cy + dot_r), fill=rgba(color, 255))
        rounded_rect(draw, (280, cy - 8, 430, cy + 8), 6, fill=pal["label"])
        value_w = int(480 + (764 - 480) * value_frac)
        rounded_rect(draw, (480, cy - 10, value_w, cy + 10), 6, fill=rgba(color, 90 if dark else 70))
        rounded_rect(draw, (480, cy - 10, value_w, cy + 10), 6, outline=rgba(color, 180), width=2)
        y += row_h

    return img


def generate_live_energy_view(dark: bool) -> Image.Image:
    img = make_canvas()
    draw = ImageDraw.Draw(img)
    pal = palette(dark)

    # Node layout (scaled from widget viewBox)
    ox, oy = 352, 260
    sx, sy = 1.6, 1.55

    def pt(x: float, y: float) -> tuple[int, int]:
        return int(ox + x * sx), int(oy + y * sy)

    nodes = {
        "pv": {"box": (96, 8, 224, 44), "icon": draw_solar_panel, "color": COLORS["pv"]},
        "house": {"box": (120, 108, 200, 166), "icon": draw_house, "color": COLORS["house"]},
        "grid": {"box": (8, 114, 70, 168), "icon": draw_pylon, "color": COLORS["grid"]},
        "battery": {"box": (250, 104, 312, 166), "icon": draw_battery, "color": COLORS["battery"]},
        "wallbox": {"box": (84, 226, 236, 262), "icon": draw_wallbox, "color": COLORS["wallbox"]},
    }

    lines = [
        ("pv", "house", COLORS["pv"], True),
        ("pv", "battery", COLORS["pv"], True),
        ("grid", "house", COLORS["grid"], True),
        ("battery", "house", COLORS["battery"], False),
        ("house", "wallbox", COLORS["wallbox"], True),
        ("pv", "wallbox", COLORS["pv"], False),
    ]

    def center(box: tuple[float, float, float, float]) -> tuple[int, int]:
        x0, y0, x1, y1 = box
        return pt((x0 + x1) / 2, (y0 + y1) / 2)

    line_coords = {
        ("pv", "house"): (pt(160, 44), pt(160, 108)),
        ("pv", "battery"): (pt(214, 26), pt(262, 104)),
        ("grid", "house"): (pt(70, 140), pt(120, 140)),
        ("battery", "house"): (pt(250, 140), pt(200, 140)),
        ("house", "wallbox"): (pt(160, 166), pt(160, 226)),
        ("pv", "wallbox"): (pt(96, 44), pt(96, 226)),
    }

    for key_a, key_b, color, active in lines:
        draw_flow_line(draw, line_coords[(key_a, key_b)][0], line_coords[(key_a, key_b)][1], color, active=active)

    for spec in nodes.values():
        x0, y0, x1, y1 = spec["box"]
        box = (*pt(x0, y0), *pt(x1, y1))
        rounded_rect(
            draw,
            box,
            10,
            fill=pal["node_fill"],
            outline=rgba(spec["color"], 255),
            width=3,
        )
        cx, cy = center(spec["box"])
        spec["icon"](draw, cx - int(14 * sx), cy, spec["color"], scale=1.15)

    return img


def generate_wallbox(dark: bool) -> Image.Image:
    img = make_canvas()
    draw = ImageDraw.Draw(img)
    pal = palette(dark)

    # Two cards side by side representing the two controls
    card_w, card_h = 280, 380
    card1 = (180, 320, 180 + card_w, 320 + card_h)   # left: Laden
    card2 = (564, 320, 564 + card_w, 320 + card_h)   # right: Sonnenmodus

    draw_shadow(img, card1, 24)
    draw_shadow(img, card2, 24)
    rounded_rect(draw, card1, 24, fill=pal["card"], outline=pal["card_stroke"], width=2)
    rounded_rect(draw, card2, 24, fill=pal["card"], outline=pal["card_stroke"], width=2)

    # Left card: charger icon for "Laden"
    draw_wallbox(draw, 320, 510, COLORS["wallbox"], scale=2.0)

    # Right card: sun/panel icon for "Sonnenmodus"
    draw_solar_panel(draw, 704, 510, COLORS["pv"], scale=1.8)

    return img


def main() -> None:
    outputs = {
        ROOT / "e3dc-hkw" / "preview-light.png": generate_live_energy_view(False),
        ROOT / "e3dc-hkw" / "preview-dark.png": generate_live_energy_view(True),
        ROOT / "wallbox" / "preview-light.png": generate_wallbox(False),
        ROOT / "wallbox" / "preview-dark.png": generate_wallbox(True),
    }
    for path, image in outputs.items():
        image.save(path, "PNG")
        print(f"Wrote {path}")


if __name__ == "__main__":
    main()