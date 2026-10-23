"""Builds the BX Designs starter templates (layered PSDs with editable text) and their previews
with the BX Designs command-line tool. Usage:

    python tools/make_templates.py <path to photocraft-cli.exe>

Writes templates/<id>.psd and templates/<id>.png (a 480 px wide preview).
"""
import json
import os
import subprocess
import sys

CLI = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "templates")
FONT = "Arial"


def text(x, y, s, size, color="#ffffff", align="center", name=None):
    p = {"x": x, "y": y, "text": s, "size": size, "font": FONT, "color": color, "align": align}
    if name:
        p["name"] = name
    return ("type.create", p)


def shape(kind, rect, fill, name, **extra):
    p = {"kind": kind, "rect": rect, "fill": fill, "name": name}
    p.update(extra)
    return ("shape.create", p)


def gradient(a, b, angle, style="linear"):
    return ("layer.newFillLayer.gradient", {"from": a, "to": b, "angle": angle, "style": style})


def shadow(distance=8, size=16, opacity=45):
    return ("layer.layerStyle.dropShadow", {"distance": distance, "size": size, "opacity": opacity, "color": "#000000"})


TEMPLATES = [
    {
        "id": "instagram-sale-post",
        "title": "Summer Sale Post",
        "category": "Social media",
        "new": {"width": 1080, "height": 1080, "resolution": 72, "background": "white", "name": "Summer Sale Post"},
        "steps": [
            gradient("#5fb94b", "#1e5631", 135),
            shape("ellipse", [640, -160, 620, 620], "#ffffff", "Sun", **{}),
            ("layer.setProps", {"opacity": 0.12}),
            text(540, 430, "SUMMER", 150, name="Headline"),
            shadow(),
            text(540, 590, "SALE", 190, "#f6d743", name="Headline 2"),
            shadow(),
            text(540, 690, "Up to 50% off everything", 44, name="Subtitle"),
            shape("roundedRect", [360, 780, 360, 110], "#ffffff", "Button", radii=55),
            text(540, 852, "SHOP NOW", 44, "#1e5631", name="Button label"),
            text(540, 1020, "yourshop.com", 30, "#e8f5e3", name="Web address"),
        ],
    },
    {
        "id": "youtube-thumbnail",
        "title": "Video Thumbnail",
        "category": "Social media",
        "new": {"width": 1280, "height": 720, "resolution": 72, "background": "black", "name": "Video Thumbnail"},
        "steps": [
            gradient("#20232a", "#3a3f4b", 90),
            shape("rect", [0, 520, 1280, 200], "#f6d743", "Banner"),
            text(80, 300, "TOP 10", 190, align="left", name="Headline"),
            shadow(10, 20, 60),
            text(80, 470, "DESIGN TIPS", 120, "#5fb94b", align="left", name="Headline 2"),
            shadow(10, 20, 60),
            text(80, 650, "Watch before your next project", 54, "#20232a", align="left", name="Subtitle"),
            shape("ellipse", [930, 140, 280, 280], "#5fb94b", "Badge"),
            text(1070, 315, "NEW", 90, name="Badge label"),
        ],
    },
    {
        "id": "event-poster-a4",
        "title": "Event Poster (A4)",
        "category": "Print",
        "new": {"width": 1240, "height": 1754, "resolution": 150, "background": "white", "name": "Event Poster"},
        "steps": [
            gradient("#1e5631", "#0b1f12", 0, "radial"),
            shape("ellipse", [170, 230, 900, 900], "#5fb94b", "Circle"),
            ("layer.setProps", {"opacity": 0.35}),
            text(620, 660, "LIVE", 150, name="Headline"),
            shadow(),
            text(620, 860, "MUSIC NIGHT", 60, "#f6d743", name="Headline 2"),
            text(620, 1250, "SATURDAY 14 JUNE  ·  8 PM", 30, name="Date"),
            text(620, 1330, "The Green Room, Main Street", 24, "#cfe8c7", name="Venue"),
            shape("roundedRect", [440, 1440, 360, 120], "#f6d743", "Ticket button", radii=24),
            text(620, 1520, "TICKETS", 26, "#0b1f12", name="Button label"),
        ],
    },
    {
        "id": "business-card",
        "title": "Business Card",
        "category": "Print",
        "new": {"width": 1050, "height": 600, "resolution": 300, "background": "white", "name": "Business Card"},
        "steps": [
            shape("rect", [0, 0, 300, 600], "#5fb94b", "Side bar"),
            text(150, 345, "BX", 28, name="Initials"),
            text(360, 250, "Your Name", 16, "#1e2a1f", align="left", name="Name"),
            text(360, 320, "Graphic Designer", 9, "#5fb94b", align="left", name="Job title"),
            shape("rect", [360, 360, 520, 4], "#d8e6d3", "Divider"),
            text(360, 440, "+1 555 0100", 7, "#3d4a3e", align="left", name="Phone"),
            text(360, 495, "you@example.com", 7, "#3d4a3e", align="left", name="Email"),
        ],
    },
]


def run(args):
    r = subprocess.run([CLI, *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"photocraft-cli {' '.join(args[:3])}…: {r.stderr.strip() or r.stdout.strip()}")
    return r.stdout


def main():
    os.makedirs(OUT, exist_ok=True)
    catalogue = []
    for t in TEMPLATES:
        psd = os.path.join(OUT, t["id"] + ".psd")
        args = ["run", "--new", json.dumps(t["new"])]
        for cmd, params in t["steps"]:
            args += ["--cmd", cmd, "--params", json.dumps(params)]
        args += ["--out", psd]
        run(args)
        png = os.path.join(OUT, t["id"] + ".png")
        w = t["new"]["width"]
        run(["run", psd, "--cmd", "image.imageSize", "--params", json.dumps({"percent": 480 / w * 100}), "--out", png])
        catalogue.append({k: t[k] for k in ("id", "title", "category")} | {"width": t["new"]["width"], "height": t["new"]["height"]})
        print("made", t["id"])
    with open(os.path.join(OUT, "catalogue.json"), "w", encoding="utf-8") as f:
        json.dump(catalogue, f, indent=2)


main()
