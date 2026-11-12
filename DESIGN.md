# Direction

A reading tool, not a marketing page. The book is the only focal point; the
chrome exists to stay out of the way. The identity comes from paper, ink and
one warm accent, not from decoration.

Dial: ENERGY 1 / RHYTHM 1 / MOTION 2.

- **ENERGY 1.** Calm surface. Flat warm-neutral background, no gradients behind
  the book except a single soft light pool that separates paper from the desk.
- **RHYTHM 1.** One composition: the book, centred, with a floating control bar
  and one optional drawer. Nothing competes with the spread.
- **MOTION 2.** Motion exists for one reason: the page turn. Everything else is
  a 120-160 ms state change. Nothing bounces, floats or fades in on scroll.

## Palette

| Token | Value | Use |
| --- | --- | --- |
| ink | `#1c1917` | body text, icons |
| paper | `#fbfaf7` | page surfaces, control bar |
| desk | `#e8e3da` | viewer background |
| muted | `#5f5850` | secondary text (5.49:1 on desk, AA) |
| accent | `#9a3412` | progress fill, active thumbnail ring (burnt sienna, paper-adjacent) |

No gradient buttons, no glow, no glass.

## Typography

System UI stack for controls (fast, no network font, matches the browser).
Demo headings use a system serif so the page reads as a printed thing. No
display font, no wide-tracked uppercase labels.

## Why these choices

- The page turn is the product, so it is the only animation with weight.
- The control bar is a floating paper slip because it belongs to the book, and
  it disappears visually against the page when unused.
- Accent is used once (progress), not as decoration on every control.
- Page-stack edges at the outer sides are drawn because they tell the reader
  the book has depth before the first turn, not as a texture for its own sake.
