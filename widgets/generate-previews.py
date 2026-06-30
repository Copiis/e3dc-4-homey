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


def draw_sun(draw: ImageDraw.ImageDraw, cx: int, cy: int, color: str, scale: float = 1.0) -> None:
    r = int(7 * scale)
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=rgba(color, 255))
    for angle in range(0, 360, 45):
        import math

        rad = math.radians(angle)
        x1 = cx + int(math.cos(rad) * (r + 4 * scale))
        y1 = cy + int(math.sin(rad) * (r + 4 * scale))
        x2 = cx + int(math.cos(rad) * (r + 9 * scale))
        y2 = cy + int(math.sin(rad) * (r + 9 * scale))
        draw.line((x1, y1, x2, y2), fill=rgba(color, 255), width=max(2, int(2 * scale)))


def draw_house(draw: ImageDraw.ImageDraw, cx: int, cy: int, color: str, scale: float = 1.0) -> None:
    w = int(18 * scale)
    h = int(14 * scale)
    roof_h = int(10 * scale)
    base = [
        (cx - w // 2, cy + h // 2),
        (cx + w // 2, cy + h // 2),
        (cx + w // 2, cy - h // 4),
        (cx - w // 2, cy - h // 4),
    ]
    roof = [
        (cx - w // 2 - 2, cy - h // 4),
        (cx, cy - h // 4 - roof_h),
        (cx + w // 2 + 2, cy - h // 4),
    ]
    draw.polygon(base, fill=rgba(color, 255))
    draw.polygon(roof, fill=rgba(color, 255))


def draw_lightning(draw: ImageDraw.ImageDraw, cx: int, cy: int, color: str, scale: float = 1.0) -> None:
    s = scale
    pts = [
        (cx + 2 * s, cy - 12 * s),
        (cx - 4 * s, cy + 1 * s),
        (cx + 1 * s, cy + 1 * s),
        (cx - 2 * s, cy + 12 * s),
        (cx + 5 * s, cy - 2 * s),
        (cx, cy - 2 * s),
    ]
    draw.polygon(pts, fill=rgba(color, 255))


def draw_battery(draw: ImageDraw.ImageDraw, cx: int, cy: int, color: str, scale: float = 1.0) -> None:
    w = int(16 * scale)
    h = int(22 * scale)
    cap_w = int(8 * scale)
    cap_h = int(4 * scale)
    body = (cx - w // 2, cy - h // 2 + cap_h, cx + w // 2, cy + h // 2)
    cap = (cx - cap_w // 2, cy - h // 2, cx + cap_w // 2, cy - h // 2 + cap_h)
    rounded_rect(draw, body, int(4 * scale), fill=rgba(color, 40), outline=rgba(color, 255), width=max(2, int(2 * scale)))
    rounded_rect(draw, cap, int(2 * scale), fill=rgba(color, 255))


def draw_car(draw: ImageDraw.ImageDraw, cx: int, cy: int, color: str, scale: float = 1.0) -> None:
    w = int(24 * scale)
    h = int(12 * scale)
    body = (cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2)
    rounded_rect(draw, body, int(5 * scale), fill=rgba(color, 40), outline=rgba(color, 255), width=max(2, int(2 * scale)))
    wheel_r = int(3 * scale)
    for wx in (cx - w // 3, cx + w // 3):
        draw.ellipse(
            (wx - wheel_r, cy + h // 2 - 1, wx + wheel_r, cy + h // 2 + wheel_r * 2 - 1),
            fill=rgba(color, 255),
        )


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
        "pv": {"box": (96, 8, 224, 44), "icon": draw_sun, "color": COLORS["pv"]},
        "house": {"box": (120, 108, 200, 166), "icon": draw_house, "color": COLORS["house"]},
        "grid": {"box": (8, 114, 70, 168), "icon": draw_lightning, "color": COLORS["grid"]},
        "battery": {"box": (250, 104, 312, 166), "icon": draw_battery, "color": COLORS["battery"]},
        "wallbox": {"box": (84, 226, 236, 262), "icon": draw_car, "color": COLORS["wallbox"]},
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


def main() -> None:
    outputs = {
        ROOT / "power-overview" / "preview-light.png": generate_power_overview(False),
        ROOT / "power-overview" / "preview-dark.png": generate_power_overview(True),
        ROOT / "live-energy-view" / "preview-light.png": generate_live_energy_view(False),
        ROOT / "live-energy-view" / "preview-dark.png": generate_live_energy_view(True),
    }
    for path, image in outputs.items():
        image.save(path, "PNG")
        print(f"Wrote {path}")


if __name__ == "__main__":
    main()