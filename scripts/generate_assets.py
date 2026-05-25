"""Generate all Trixie Wallet icon + splash assets from the sparkle design."""
import os
import cairosvg
from PIL import Image

OUT = "/home/claude/assets"
os.makedirs(OUT, exist_ok=True)

# Brand colors
PINK = "#ff007f"
PINK_DARK = "#1a0010"  # for iOS dark mode variant
DARK_GRAY = "#1c1c1e"  # for iOS tinted variant base
WHITE = "#ffffff"


def sparkle_path(cx, cy, size, include_companion=True, companion_offset=(0.75, -0.55), companion_scale=0.28):
    """Build the sparkle SVG path data, scaled around (cx, cy).

    The main sparkle is a 4-pointed twinkle built from two crossing pinched diamonds.
    `size` is the full bounding-box radius from center to tip.
    """
    s = size
    # Main sparkle: 4 cubic curves from each point through the "pinch" area
    main = (
        f"M {cx} {cy - s} "
        f"C {cx + 0.16*s} {cy - 0.30*s}, {cx + 0.30*s} {cy - 0.16*s}, {cx + s} {cy} "
        f"C {cx + 0.30*s} {cy + 0.16*s}, {cx + 0.16*s} {cy + 0.30*s}, {cx} {cy + s} "
        f"C {cx - 0.16*s} {cy + 0.30*s}, {cx - 0.30*s} {cy + 0.16*s}, {cx - s} {cy} "
        f"C {cx - 0.30*s} {cy - 0.16*s}, {cx - 0.16*s} {cy - 0.30*s}, {cx} {cy - s} Z"
    )

    companion = ""
    if include_companion:
        ocx = cx + companion_offset[0] * s
        ocy = cy + companion_offset[1] * s
        cs = s * companion_scale
        companion = (
            f"M {ocx} {ocy - cs} "
            f"C {ocx + 0.16*cs} {ocy - 0.30*cs}, {ocx + 0.30*cs} {ocy - 0.16*cs}, {ocx + cs} {ocy} "
            f"C {ocx + 0.30*cs} {ocy + 0.16*cs}, {ocx + 0.16*cs} {ocy + 0.30*cs}, {ocx} {ocy + cs} "
            f"C {ocx - 0.16*cs} {ocy + 0.30*cs}, {ocx - 0.30*cs} {ocy + 0.16*cs}, {ocx - cs} {ocy} "
            f"C {ocx - 0.30*cs} {ocy - 0.16*cs}, {ocx - 0.16*cs} {ocy - 0.30*cs}, {ocx} {ocy - cs} Z"
        )

    return main, companion


def build_svg(viewbox_size, bg_color, sparkle_color, sparkle_size_ratio,
              include_companion=True, companion_opacity=0.9, bg_transparent=False,
              companion_color=None):
    """Build the full SVG. viewbox is square. sparkle is centered."""
    vb = viewbox_size
    cx = cy = vb / 2
    s = vb * sparkle_size_ratio / 2
    main, comp = sparkle_path(cx, cy, s, include_companion=include_companion)

    bg = "" if bg_transparent else f'<rect width="{vb}" height="{vb}" fill="{bg_color}"/>'
    comp_fill = companion_color or sparkle_color
    comp_svg = f'<path d="{comp}" fill="{comp_fill}" fill-opacity="{companion_opacity}"/>' if include_companion else ""

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb} {vb}" width="{vb}" height="{vb}">
{bg}
<path d="{main}" fill="{sparkle_color}"/>
{comp_svg}
</svg>'''


def render(svg, out_path, size, flatten_to_color=None):
    """Render an SVG string to a PNG at the given pixel size.
    If flatten_to_color is given, the alpha channel is removed and composited
    over that color (used for iOS icon.png which must not have transparency).
    """
    cairosvg.svg2png(
        bytestring=svg.encode("utf-8"),
        write_to=out_path,
        output_width=size,
        output_height=size,
    )
    if flatten_to_color:
        img = Image.open(out_path).convert("RGBA")
        bg = Image.new("RGB", img.size, flatten_to_color)
        bg.paste(img, mask=img.split()[3])
        bg.save(out_path, "PNG", optimize=True)
    else:
        # Re-save with optimization
        img = Image.open(out_path)
        img.save(out_path, "PNG", optimize=True)
    return out_path


# ============================================================
# 1. iOS primary icon — 1024x1024, solid pink bg, no transparency
# ============================================================
svg = build_svg(
    viewbox_size=1024,
    bg_color=PINK,
    sparkle_color=WHITE,
    sparkle_size_ratio=0.52,  # main sparkle takes ~52% of canvas width
    include_companion=True,
    companion_opacity=0.9,
)
render(svg, f"{OUT}/icon.png", 1024, flatten_to_color=(255, 0, 127))
print("✓ icon.png")

# ============================================================
# 2. iOS dark mode icon — darker bg, brand-pink sparkle
# ============================================================
svg = build_svg(
    viewbox_size=1024,
    bg_color=PINK_DARK,
    sparkle_color=PINK,  # pink sparkle on near-black
    sparkle_size_ratio=0.52,
    include_companion=True,
    companion_opacity=0.85,
    companion_color="#ff4da0",  # slightly lighter pink for companion to keep it visible
)
render(svg, f"{OUT}/icon-dark.png", 1024, flatten_to_color=(26, 0, 16))
print("✓ icon-dark.png")

# ============================================================
# 3. iOS tinted mode icon — grayscale, white sparkle on dark gray
# ============================================================
svg = build_svg(
    viewbox_size=1024,
    bg_color=DARK_GRAY,
    sparkle_color=WHITE,
    sparkle_size_ratio=0.52,
    include_companion=True,
    companion_opacity=0.75,
)
render(svg, f"{OUT}/icon-tinted.png", 1024, flatten_to_color=(28, 28, 30))
print("✓ icon-tinted.png")

# ============================================================
# 4. Android adaptive — foreground (transparent, mark inside safe zone)
# Safe zone is ~66% of 1024 = ~672px. Make sparkle smaller (40%) to sit comfortably inside.
# ============================================================
svg = build_svg(
    viewbox_size=1024,
    bg_color="",
    sparkle_color=WHITE,
    sparkle_size_ratio=0.40,  # smaller to fit safe zone with breathing room
    include_companion=True,
    companion_opacity=0.9,
    bg_transparent=True,
)
render(svg, f"{OUT}/android-icon-foreground.png", 1024)
print("✓ android-icon-foreground.png")

# ============================================================
# 5. Android adaptive — background (solid pink fill)
# Shipped as a file in case the OEM ignores backgroundColor config
# ============================================================
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><rect width="1024" height="1024" fill="{PINK}"/></svg>'
render(svg, f"{OUT}/android-icon-background.png", 1024, flatten_to_color=(255, 0, 127))
print("✓ android-icon-background.png")

# ============================================================
# 6. Android monochrome — simplified, main sparkle only, white on transparent
# ============================================================
svg = build_svg(
    viewbox_size=1024,
    bg_color="",
    sparkle_color=WHITE,
    sparkle_size_ratio=0.45,  # slightly larger since there's no companion
    include_companion=False,
    bg_transparent=True,
)
render(svg, f"{OUT}/android-icon-monochrome.png", 1024)
print("✓ android-icon-monochrome.png")

# ============================================================
# 7. Notification icon — simplified, thicker, white on transparent
# Shipped at 256x256 even though Android only needs 96x96 at xxhdpi
# ============================================================
svg = build_svg(
    viewbox_size=256,
    bg_color="",
    sparkle_color=WHITE,
    sparkle_size_ratio=0.65,  # bigger to be legible at notification size
    include_companion=False,
    bg_transparent=True,
)
render(svg, f"{OUT}/notification-icon.png", 256)
print("✓ notification-icon.png")

# ============================================================
# 8. Splash icon — final frame of the animated splash
# Used by expo-splash-screen before JS animation takes over
# Transparent background — splash bg color is set via app.json (#ff007f)
# ============================================================
svg = build_svg(
    viewbox_size=1024,
    bg_color="",
    sparkle_color=WHITE,
    sparkle_size_ratio=0.52,
    include_companion=True,
    companion_opacity=0.9,
    bg_transparent=True,
)
render(svg, f"{OUT}/splash-icon.png", 1024)
print("✓ splash-icon.png")

# ============================================================
# 9. Favicon for web build — small, simple, pink bg with white sparkle
# ============================================================
svg = build_svg(
    viewbox_size=96,
    bg_color=PINK,
    sparkle_color=WHITE,
    sparkle_size_ratio=0.56,
    include_companion=False,  # too small for the companion to read
    bg_transparent=False,
)
render(svg, f"{OUT}/favicon.png", 96, flatten_to_color=(255, 0, 127))
print("✓ favicon.png")

print("\nAll assets generated in:", OUT)
