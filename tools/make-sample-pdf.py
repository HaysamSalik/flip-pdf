#!/usr/bin/env python3
"""Build demo/sample-generated.pdf: a short, project-owned booklet.

The demo uses demo/sample.pdf. This exists so the repository always has one
generated fixture it owns outright, for anyone who does not want to rely on the
third-party sample.

The content is original prose about paper and bookbinding, so the demo has real
text to flip through instead of lorem ipsum.
"""
from pathlib import Path

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A5
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

OUT = Path(__file__).resolve().parent.parent / "demo" / "sample-generated.pdf"
W, H = A5
INK = HexColor("#1c1917")
MUTED = HexColor("#6b645c")
ACCENT = HexColor("#9a3412")
RULE = HexColor("#d6cfc4")
PAPER = HexColor("#fbfaf7")

MARGIN = 18 * mm
LEAD = 6.4 * mm


def wrap(c, text, font, size, width):
    words = text.split()
    lines, line = [], ""
    for word in words:
        probe = f"{line} {word}".strip()
        if c.stringWidth(probe, font, size) <= width:
            line = probe
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def page(c, bg=PAPER):
    c.setFillColor(bg)
    c.rect(0, 0, W, H, stroke=0, fill=1)


def body(c, text, y, size=9.5, color=INK, font="Times-Roman", indent=0):
    c.setFillColor(color)
    c.setFont(font, size)
    for line in wrap(c, text, font, size, W - 2 * MARGIN - indent):
        c.drawString(MARGIN + indent, y, line)
        y -= LEAD
    return y


def heading(c, text, page_no=None, kicker=None):
    y = H - MARGIN - 4 * mm
    if kicker:
        c.setFillColor(ACCENT)
        c.setFont("Helvetica", 6.5)
        c.drawString(MARGIN, y + 6 * mm, kicker.upper())
    c.setFillColor(INK)
    c.setFont("Times-Bold", 19)
    c.drawString(MARGIN, y - 4 * mm, text)
    c.setStrokeColor(RULE)
    c.setLineWidth(0.6)
    c.line(MARGIN, y - 8.5 * mm, W - MARGIN, y - 8.5 * mm)
    if page_no is not None:
        c.setFont("Times-Roman", 8)
        c.setFillColor(MUTED)
        c.drawCentredString(W / 2, MARGIN - 5 * mm, str(page_no))


def spread_diagram(c, x, y, w, h):
    """Two pages meeting at a hinge, with a lifting leaf."""
    half = w / 2
    c.setFillColor(HexColor("#f1ece3"))
    c.setStrokeColor(HexColor("#c9c0b2"))
    c.setLineWidth(0.7)
    c.rect(x, y, half - 1.2, h, stroke=1, fill=1)
    c.rect(x + half + 1.2, y, half - 1.2, h, stroke=1, fill=1)
    c.setFillColor(HexColor("#b8ae9e"))
    c.rect(x + half - 1.2, y, 2.4, h, stroke=0, fill=1)

    # A leaf lifted away from the right page.
    c.setStrokeColor(ACCENT)
    c.setLineWidth(1.1)
    p = c.beginPath()
    p.moveTo(x + half, y + h)
    cx, cy = x + half + half * 0.62, y + h * 0.72
    p.curveTo(cx, y + h * 1.34, cx + 24, y + h * 1.18, x + w - 4, y + h * 1.02)
    p.lineTo(x + w - 4, y + h * -0.02)
    p.moveTo(x + w - 4, y + h * 1.02)
    c.drawPath(p, stroke=1, fill=0)

    c.setStrokeColor(HexColor("#a8a094"))
    c.setLineWidth(0.6)
    c.setDash(3, 3)
    c.line(x + half, y + h, x + w - 4, y + h)
    c.setDash()

    c.setFont("Helvetica", 6.5)
    c.setFillColor(MUTED)
    c.drawCentredString(x + half / 2, y - 5 * mm, "free half")
    c.drawCentredString(x + half + half / 2, y - 5 * mm, "bound half")


def arc_diagram(c, x, y, w, h):
    c.setStrokeColor(HexColor("#c9c0b2"))
    c.setLineWidth(0.7)
    c.line(x, y, x + w, y)
    c.setStrokeColor(ACCENT)
    c.setLineWidth(1.2)
    for i, (sx, sy, ex, ey, cx, cy) in enumerate(
        [
            (x, y, x + w * 0.92, y + h * 0.16, x + w * 0.55, y + h * 0.62),
            (x, y, x + w * 0.86, y + h * 0.52, x + w * 0.58, y + h * 0.94),
            (x, y, x + w * 0.58, y + h * 0.86, x + w * 0.42, y + h * 1.22),
        ]
    ):
        p = c.beginPath()
        p.moveTo(sx, sy)
        p.curveTo(cx, cy, cx, cy, ex, ey)
        c.drawPath(p, stroke=1, fill=0)

    c.setFillColor(HexColor("#f1ece3"))
    c.setStrokeColor(HexColor("#b8ae9e"))
    c.setLineWidth(0.7)
    c.rect(x + w * 0.94, y + h * 0.10, w * 0.06, h * 0.9, stroke=1, fill=1)
    c.setFont("Helvetica", 6.5)
    c.setFillColor(MUTED)
    c.drawString(x, y - 4 * mm, "hinge")
    c.drawRightString(x + w, y - 4 * mm, "free edge")


def table(c, rows, y, page_no):
    c.setFont("Helvetica", 7)
    c.setFillColor(MUTED)
    c.drawString(MARGIN, y, "POSITION ON THE LEAF")
    c.drawRightString(W - MARGIN, y, "ARC TRAVELLED")
    y -= 3 * mm
    c.setStrokeColor(RULE)
    c.setLineWidth(0.6)
    c.line(MARGIN, y, W - MARGIN, y)
    for label, value in rows:
        y -= 6.2 * mm
        c.setFont("Times-Roman", 9.5)
        c.setFillColor(INK)
        c.drawString(MARGIN, y, label)
        c.setFont("Helvetica", 8.5)
        c.drawRightString(W - MARGIN, y, value)
        c.setStrokeColor(HexColor("#e6e0d5"))
        c.line(MARGIN, y - 2 * mm, W - MARGIN, y - 2 * mm)
    return y


def cover(c, total):
    page(c)
    c.setFillColor(ACCENT)
    c.rect(MARGIN, H - MARGIN - 2 * mm, 22 * mm, 1.6 * mm, stroke=0, fill=1)
    c.setFillColor(INK)
    c.setFont("Times-Bold", 30)
    c.drawString(MARGIN, H - MARGIN - 22 * mm, "The Anatomy")
    c.drawString(MARGIN, H - MARGIN - 34 * mm, "of a Page Turn")
    c.setFillColor(MUTED)
    c.setFont("Times-Italic", 12)
    c.drawString(MARGIN, H - MARGIN - 46 * mm, "A short guide to how paper moves")
    spread_diagram(c, MARGIN, MARGIN + 30 * mm, W - 2 * MARGIN, 46 * mm)
    c.setFont("Helvetica", 7)
    c.setFillColor(MUTED)
    c.drawString(MARGIN, MARGIN, f"PDF FLIPBOOK · SAMPLE DOCUMENT · {total} PAGES")


PAGES = [
    (
        "The fold",
        "Bound reading",
        [
            "A book is a stack of leaves joined along one edge. Everything that makes a page turn feel like a page turn follows from that single constraint: one edge cannot move, so the other must travel.",
            "Paper is not a hinge, though. It bends, and the bend is what separates a book from a sheaf of cards. Where the leaf is held the curvature is high and the surface almost vertical; a few centimetres out it flattens into a shallow slope and then into nothing at all.",
            "Grain matters here. Machine-made paper is laid down with its fibres aligned along one direction, and a leaf folds more cleanly across the grain than along it. A well-made book has its grain parallel to the spine, which is why the page bows sideways rather than buckling along its length.",
        ],
    ),
    (
        "The arc",
        "Bound reading",
        [
            "Hold a leaf by its free edge and let it swing. Every point on the leaf traces a circle about the spine, and each circle has a different radius. The point nearest the spine barely moves at all. The free corner travels the whole width of the page.",
            "That difference in travel is the reason a turn looks the way it does. The sheet does not rotate as a rigid door. The hinge end stays almost still while the far end accelerates, so the leaf is never flat: it is always a surface of changing curvature between a fixed edge and a moving one.",
            "If you animate a page as a rigid plane you get a plank swinging from a hinge. Real paper is softer than that, and the softening is entirely in the curvature.",
        ],
    ),
    (
        "Weight and air",
        "Bound reading",
        [
            "A leaf of ordinary book paper weighs a few grams. At the scale of a page turn that is enough to matter: the sheet is light enough that air resistance shapes the motion rather than merely slowing it.",
            "Push a leaf slowly and it bows away from your hand, because the leading edge is being dragged through still air while the middle is free to bulge. Push it quickly and the bulge deepens, then breaks: the leaf flutters, catches, and settles.",
            "This is why a page turn never ends abruptly. The sheet arrives, overshoots by a degree or two, and rocks back. A flipbook animation that stops dead at the end of the arc reads as mechanical, however accurate its geometry.",
        ],
    ),
    (
        "The pause",
        "Bound reading",
        [
            "Watch a reader turn a page and you will see the same thing every time: the leaf rises, pauses at the top of its arc, and only then falls away. The pause is not hesitation. It is the moment the sheet is balanced on the point where its own weight stops pulling it back.",
            "A digital page turn reproduces that pause for the same reason a physical one has it. Without a moment of near-stillness at the apex, the eye cannot tell which direction the sheet is travelling, and the motion reads as a slide rather than a turn.",
            "The pause is short. In a comfortable turn it is under a tenth of a second, and it is more obvious in the curve of the motion than in the timeline.",
        ],
    ),
    (
        "The sound",
        "Bound reading",
        [
            "Paper makes noise when it moves, and the noise is not incidental. A leaf leaving a stack releases a small amount of static and stored elastic energy, which is heard as a soft click as the sheet separates.",
            "The landing is quieter than the departure, which is the opposite of what most people expect. The sheet arrives already slowed by air, and it settles against a surface that is moving in the same direction.",
            "None of this is reproducible in a browser, and none of it needs to be. What matters for an animation is tempo: a turn that accelerates into the apex and decelerates out of it sounds right even when it is silent.",
        ],
    ),
    (
        "Why the curl matters",
        "Bound reading",
        [
            "The visual signature of a page turn is a highlight that moves across the leaf. It is the light catching the curved part of the sheet, and it is the single strongest cue that the surface is bending rather than sliding.",
            "A flat rotating plane has a constant normal, so it is lit uniformly and reads as a card. Introduce curvature and the normal rotates across the surface: one side of the bend faces the light, the other turns away, and the eye reads depth without being told there is any.",
            "This is the one place where a little shading buys more realism than more geometry. Sixty segments of a curved sheet will beat a thousand segments of a flat one.",
        ],
    ),
    (
        "Reading speed",
        "Bound reading",
        [
            "The eye does not read during the turn. It stops at the end of one page and starts again at the top of the next, which means the animation is competing with nothing: it only has to be short enough that the reader does not notice waiting and clear enough that the reader knows the page changed.",
            "Two hundred milliseconds is too fast to read as a turn. A second is long enough to be an interruption. The comfortable range sits between four and seven hundred milliseconds, and the upper half of that range feels calmer while the lower half feels quicker without feeling abrupt.",
            "Readers who turn pages constantly prefer the fast end. Readers who are reading carefully barely notice either.",
        ],
    ),
    (
        "Thickness",
        "Bound reading",
        [
            "A closed book is a wedge. The fore-edge is thinner than the spine because the leaves fan out slightly towards the binding, and the cover boards extend a millimetre or two past the text block.",
            "In a viewer there is no wedge, only a page. How much of the stack you draw is a choice about how much the reader should be reminded that this is a book at all. Draw too much and the edges become texture; draw none and the page floats.",
            "The compromise most tools settle on is a shadow along the spine and nothing else. It suggests depth without committing to a number of leaves that the document does not actually have.",
        ],
    ),
    (
        "What is lost",
        "Bound reading",
        [
            "A screen cannot reproduce the smell, the weight, or the sound of paper, and a page turn on a screen is not a substitute for one. It is a reading of the gesture: the parts of the motion that the eye uses to understand what happened.",
            "Those parts are few. A curved surface, a moving highlight, a moment of stillness, and a landing. Everything else, from the exact fibre of the paper to the stiffness of the board, is decoration that the eye will not miss if it is absent.",
            "Which is a useful thing to remember when building one. The animation is finished when the eye stops asking questions, not when the model is complete.",
        ],
    ),
]


def content(c, title, kicker, paragraphs, page_no, diagram=None):
    page(c)
    heading(c, title, page_no, kicker)
    y = H - MARGIN - 22 * mm
    if diagram == "arc":
        arc_diagram(c, MARGIN, MARGIN + 52 * mm, W - 2 * MARGIN, 34 * mm)
        y -= 4 * mm
    for para in paragraphs:
        y = body(c, para, y)
        y -= 3.2 * mm
    if diagram == "arc":
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 6.5)
        c.drawCentredString(W / 2, MARGIN + 46 * mm, "the leaf at three points in the turn")


def build():
    c = canvas.Canvas(str(OUT), pagesize=A5)
    c.setTitle("The Anatomy of a Page Turn")
    c.setAuthor("flip-pdf sample")
    c.setSubject("Sample document for the flip-pdf demo")

    total = 1 + len(PAGES) + 1 + 1
    cover(c, total)
    c.showPage()

    page_no = 2
    for index, (title, kicker, paras) in enumerate(PAGES):
        diagram = "arc" if index == 1 else None
        content(c, title, kicker, paras, page_no, diagram)
        c.showPage()
        page_no += 1

        # A mid-book table page keeps the spread contents from being uniform.
        if index == 2:
            page(c)
            heading(c, "Travel at four points", page_no, "Bound reading")
            y = H - MARGIN - 24 * mm
            y = body(
                c,
                "Measured on a leaf 148 mm wide, turning through 180 degrees. The values are arc length travelled by each point, not straight-line distance.",
                y,
            )
            y -= 5 * mm
            table(
                c,
                [
                    ("At the hinge", "0 mm"),
                    ("A quarter out", "39 mm"),
                    ("Halfway out", "78 mm"),
                    ("At the free edge", "155 mm"),
                ],
                y,
                page_no,
            )
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 6.5)
            c.drawString(MARGIN, MARGIN - 2 * mm, "A point at the hinge does not travel; the free edge travels furthest.")
            c.showPage()
            page_no += 1

    # Closing page.
    page(c, HexColor("#1c1917"))
    c.setFillColor(HexColor("#fbfaf7"))
    c.setFont("Times-Bold", 16)
    c.drawString(MARGIN, H - MARGIN - 10 * mm, "Colophon")
    c.setFont("Times-Roman", 9.5)
    y = H - MARGIN - 24 * mm
    for para in [
        "This booklet was generated to demonstrate a page-turning PDF viewer. Its sixteen pages exist so there is something to turn.",
        "Set in the system serif and the system sans, printed at A5, with diagrams drawn as vector paths so the pages stay sharp at any zoom.",
    ]:
        y = body(c, para, y, color=HexColor("#d8d2c8"))
        y -= 3.5 * mm
    c.setFillColor(ACCENT)
    c.rect(MARGIN, MARGIN, 16 * mm, 1.4 * mm, stroke=0, fill=1)
    c.showPage()

    c.save()
    print(f"wrote {OUT}")


if __name__ == "__main__":
    build()
