#!/usr/bin/env python3
"""Generate exact-scale printable paper cipher wheel prototypes.

The wheel performs C = (P + K) mod 26, where A=0 and Z=25.
It is a physical lookup aid only; it does not generate or distribute keys.
"""

from __future__ import annotations

import math
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, LETTER, landscape
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas


MM = 72.0 / 25.4
INK = colors.HexColor("#111111")
MID = colors.HexColor("#666666")
LIGHT = colors.HexColor("#D8D8D8")
PALE = colors.HexColor("#F3F3F3")
ACCENT = colors.HexColor("#1769AA")
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def mm(value: float) -> float:
    return value * MM


def centered_text(
    canvas: Canvas,
    text: str,
    x: float,
    y: float,
    font: str = "Helvetica",
    size: float = 10,
    color=INK,
) -> None:
    canvas.setFillColor(color)
    canvas.setFont(font, size)
    canvas.drawCentredString(x, y, text)


def draw_cut_circle(canvas: Canvas, cx: float, cy: float, radius: float) -> None:
    canvas.saveState()
    canvas.setStrokeColor(INK)
    canvas.setLineWidth(0.8)
    canvas.setDash(5, 3)
    canvas.circle(cx, cy, radius, stroke=1, fill=0)
    canvas.restoreState()


def draw_hole(canvas: Canvas, cx: float, cy: float) -> None:
    canvas.saveState()
    canvas.setStrokeColor(INK)
    canvas.setLineWidth(0.7)
    canvas.circle(cx, cy, mm(1.5), stroke=1, fill=0)
    canvas.line(cx - mm(3), cy, cx + mm(3), cy)
    canvas.line(cx, cy - mm(3), cx, cy + mm(3))
    centered_text(canvas, "PUNCH", cx, cy - mm(7), "Helvetica-Bold", 5.5, MID)
    canvas.restoreState()


def polar(cx: float, cy: float, radius: float, index: int) -> tuple[float, float]:
    angle = math.radians(90 - index * (360.0 / 26.0))
    return cx + radius * math.cos(angle), cy + radius * math.sin(angle)


def draw_base(canvas: Canvas, cx: float, cy: float) -> None:
    outer = mm(72)
    draw_cut_circle(canvas, cx, cy, outer)

    canvas.saveState()
    canvas.setStrokeColor(LIGHT)
    canvas.setLineWidth(0.45)
    for i in range(26):
        angle = math.radians(90 - i * (360.0 / 26.0))
        x1 = cx + mm(50.5) * math.cos(angle)
        y1 = cy + mm(50.5) * math.sin(angle)
        x2 = cx + mm(71) * math.cos(angle)
        y2 = cy + mm(71) * math.sin(angle)
        canvas.line(x1, y1, x2, y2)
    canvas.restoreState()

    for i, letter in enumerate(ALPHABET):
        nx, ny = polar(cx, cy, mm(67), i)
        lx, ly = polar(cx, cy, mm(57.5), i)
        centered_text(canvas, f"{i:02d}", nx, ny - 2.2, "Helvetica", 6.7, MID)
        centered_text(canvas, letter, lx, ly - 4.0, "Helvetica-Bold", 12.5, INK)

    centered_text(canvas, "KEY NUMBER", cx, cy + mm(35), "Helvetica-Bold", 8, MID)
    centered_text(canvas, "OUTER LETTER = ENCRYPTED", cx, cy + mm(28), "Helvetica-Bold", 8.5, INK)
    centered_text(canvas, "BASE", cx, cy - mm(28), "Helvetica-Bold", 8, MID)
    draw_hole(canvas, cx, cy)


def draw_rotor(canvas: Canvas, cx: float, cy: float) -> None:
    radius = mm(49)
    canvas.saveState()
    canvas.setFillColor(colors.white)
    canvas.circle(cx, cy, radius, stroke=0, fill=1)
    canvas.restoreState()
    draw_cut_circle(canvas, cx, cy, radius)

    canvas.saveState()
    canvas.setStrokeColor(LIGHT)
    canvas.setLineWidth(0.4)
    for i in range(26):
        angle = math.radians(90 - i * (360.0 / 26.0))
        x1 = cx + mm(32) * math.cos(angle)
        y1 = cy + mm(32) * math.sin(angle)
        x2 = cx + mm(48) * math.cos(angle)
        y2 = cy + mm(48) * math.sin(angle)
        canvas.line(x1, y1, x2, y2)
    canvas.restoreState()

    # The KEY arrow is printed on the moving dial and points outward.
    canvas.saveState()
    canvas.setFillColor(ACCENT)
    canvas.setStrokeColor(ACCENT)
    pointer = canvas.beginPath()
    pointer.moveTo(cx, cy + mm(48))
    pointer.lineTo(cx - mm(6), cy + mm(36))
    pointer.lineTo(cx + mm(6), cy + mm(36))
    pointer.close()
    canvas.drawPath(pointer, stroke=1, fill=1)
    centered_text(canvas, "KEY", cx, cy + mm(38.5), "Helvetica-Bold", 5.7, colors.white)
    canvas.restoreState()

    for i, letter in enumerate(ALPHABET):
        letter_radius = mm(31) if letter == "A" else mm(41)
        lx, ly = polar(cx, cy, letter_radius, i)
        centered_text(canvas, letter, lx, ly - 4.2, "Helvetica-Bold", 12.5, INK)

    centered_text(canvas, "INNER LETTER = PAPER TEXT", cx, cy + mm(18), "Helvetica-Bold", 7.5, INK)
    centered_text(canvas, "TURN THE BLUE KEY ARROW", cx, cy + mm(11), "Helvetica-Bold", 7.2, MID)
    centered_text(canvas, "TO THE NEXT STAMP NUMBER", cx, cy + mm(5), "Helvetica-Bold", 7.2, MID)
    centered_text(canvas, "ROTATING WHEEL", cx, cy - mm(17), "Helvetica-Bold", 7.2, MID)
    draw_hole(canvas, cx, cy)


def draw_scale(canvas: Canvas, x: float, y: float) -> None:
    length = mm(100)
    canvas.saveState()
    canvas.setStrokeColor(INK)
    canvas.setLineWidth(1)
    canvas.line(x, y, x + length, y)
    canvas.line(x, y - mm(2), x, y + mm(2))
    canvas.line(x + length, y - mm(2), x + length, y + mm(2))
    centered_text(canvas, "This line must measure exactly 100 mm", x + length / 2, y + mm(3), "Helvetica", 7.5)
    canvas.restoreState()


def draw_page_one(canvas: Canvas, page_size: tuple[float, float]) -> None:
    width, height = landscape(page_size)
    canvas.setPageSize((width, height))

    centered_text(canvas, "PAPER CIPHER WHEEL - REAL PRINT TEMPLATE", width / 2, height - mm(12), "Helvetica-Bold", 15)
    centered_text(
        canvas,
        "Print at 100% / Actual Size. Do not use Fit to Page.",
        width / 2,
        height - mm(20),
        "Helvetica-Bold",
        9,
    )

    base_cx = mm(78)
    rotor_cx = width - mm(58)
    cy = height / 2 - mm(2)
    draw_base(canvas, base_cx, cy)
    draw_rotor(canvas, rotor_cx, cy)

    canvas.setStrokeColor(INK)
    canvas.setLineWidth(0.6)
    canvas.line(mm(155), mm(17), mm(155), height - mm(28))

    centered_text(canvas, "ASSEMBLY", rotor_cx, height - mm(35), "Helvetica-Bold", 9)
    steps = [
        "1. Cut out both dashed circles.",
        "2. Stack them with the center marks matched.",
        "3. Join the centers with a brass paper fastener.",
    ]
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica", 7.8)
    y = height - mm(42)
    for step in steps:
        canvas.drawCentredString(rotor_cx, y, step)
        y -= mm(6)

    draw_scale(canvas, width - mm(118), mm(11))
    canvas.showPage()


def wrap_lines(text: str, max_chars: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if len(candidate) <= max_chars:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_instruction_box(
    canvas: Canvas,
    x: float,
    y: float,
    width: float,
    height: float,
    title: str,
    lines: list[str],
) -> None:
    canvas.saveState()
    canvas.setStrokeColor(INK)
    canvas.setLineWidth(0.7)
    canvas.roundRect(x, y, width, height, mm(2), stroke=1, fill=0)
    canvas.setFillColor(PALE)
    canvas.roundRect(x, y + height - mm(11), width, mm(11), mm(2), stroke=0, fill=1)
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawString(x + mm(4), y + height - mm(7.3), title)
    canvas.setFont("Helvetica", 8.2)
    ty = y + height - mm(17)
    for line in lines:
        canvas.drawString(x + mm(4), ty, line)
        ty -= mm(5.3)
    canvas.restoreState()


def draw_stamp_strip(
    canvas: Canvas,
    x: float,
    y: float,
    width: float,
    label: str,
    values: list[str] | None = None,
) -> None:
    label_width = mm(22)
    cell_width = (width - label_width) / 26
    cell_height = mm(10)
    canvas.saveState()
    canvas.setStrokeColor(INK)
    canvas.setLineWidth(0.45)
    canvas.rect(x, y, label_width, cell_height, stroke=1, fill=0)
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 7)
    canvas.drawCentredString(x + label_width / 2, y + mm(3.5), label)
    for i in range(26):
        cell_x = x + label_width + i * cell_width
        canvas.rect(cell_x, y, cell_width, cell_height, stroke=1, fill=0)
        canvas.setFont("Helvetica", 4.8)
        canvas.setFillColor(MID)
        canvas.drawCentredString(cell_x + cell_width / 2, y + mm(7.2), str(i + 1))
        if values and i < len(values) and values[i]:
            canvas.setFont("Helvetica-Bold", 7.1)
            canvas.setFillColor(INK)
            canvas.drawCentredString(cell_x + cell_width / 2, y + mm(2.3), values[i])
    canvas.restoreState()


def draw_page_two(canvas: Canvas, page_size: tuple[float, float]) -> None:
    width, height = landscape(page_size)
    canvas.setPageSize((width, height))
    margin = mm(12)
    usable = width - 2 * margin

    centered_text(canvas, "USE THE WHEEL", width / 2, height - mm(13), "Helvetica-Bold", 15)
    centered_text(canvas, "Plaintext stays on paper. Only encrypted letters go into the phone.", width / 2, height - mm(21), "Helvetica", 9)

    box_gap = mm(6)
    box_width = (usable - box_gap) / 2
    box_height = mm(47)
    top_y = height - mm(74)
    draw_instruction_box(
        canvas,
        margin,
        top_y,
        box_width,
        box_height,
        "SEND - paper text to encrypted text",
        [
            "1. Use the next unused number on your stamp strip.",
            "2. Turn the blue KEY arrow to that number.",
            "3. Find your paper letter on the INNER wheel.",
            "4. Copy the matching OUTER letter to the phone.",
            "5. Cross out that stamp number. Repeat.",
        ],
    )
    draw_instruction_box(
        canvas,
        margin + box_width + box_gap,
        top_y,
        box_width,
        box_height,
        "READ - encrypted text to paper text",
        [
            "1. Use Bob's matching unused stamp number.",
            "2. Turn the blue KEY arrow to that number.",
            "3. Find the received letter on the OUTER ring.",
            "4. Copy the matching INNER letter onto paper.",
            "5. Cross out that stamp number. Repeat.",
        ],
    )

    test_y = top_y - mm(25)
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawString(margin, test_y + mm(15), "TRY IT - HI must become KJ")
    sample = ["03", "01", "20", "04", "17"] + [""] * 21
    draw_stamp_strip(canvas, margin, test_y, usable, "TEST", sample)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(margin, test_y - mm(4), "First try: paper H I      key 03 01      encrypted result K J")
    canvas.drawString(margin, test_y - mm(9), "Longer check: paper H E L L O      key 03 01 20 04 17      result K F F P F")

    strips_top = test_y - mm(27)
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawString(margin, strips_top + mm(13), "BLANK 26-NUMBER STAMP STRIPS - numbers must be 00 through 25")
    for row in range(5):
        draw_stamp_strip(canvas, margin, strips_top - row * mm(13), usable, f"STAMP {row + 1}")

    rule_y = mm(12)
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(margin, rule_y + mm(10), "NON-NEGOTIABLE SECURITY RULES")
    canvas.setFont("Helvetica", 7.4)
    rules = [
        "A stamp must be truly random, Alice and Bob must hold matching copies, and every number may be used only once.",
        "For 2-10 stamps, run the whole message through the wheel once per stamp. Bob reverses each pass on paper.",
        "This wheel only performs the letter math. It does not safely create, share, authenticate, or store the stamps.",
    ]
    for i, rule in enumerate(rules):
        canvas.drawString(margin, rule_y + mm(5) - i * mm(4.3), f"- {rule}")

    canvas.showPage()


def build_pdf(output_path: Path, page_size: tuple[float, float]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas = Canvas(str(output_path), pagesize=landscape(page_size), pageCompression=1)
    canvas.setTitle("Paper Cipher Wheel - Exact Scale Printable Prototype")
    canvas.setAuthor("Sibyl prototype")
    draw_page_one(canvas, page_size)
    draw_page_two(canvas, page_size)
    canvas.save()


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    output_dir = root / "output" / "pdf"
    build_pdf(output_dir / "paper_cipher_wheel_v2_us_letter.pdf", LETTER)
    build_pdf(output_dir / "paper_cipher_wheel_v2_a4.pdf", A4)
    print(output_dir / "paper_cipher_wheel_v2_us_letter.pdf")
    print(output_dir / "paper_cipher_wheel_v2_a4.pdf")


if __name__ == "__main__":
    main()
