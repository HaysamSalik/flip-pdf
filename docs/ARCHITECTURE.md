# Architecture

The parts you cannot guess by reading the code, in the order the data flows.

```
PDF file
  -> pdf-source.js      rasterise page N to a canvas at the display width
  -> page-cache.js      keep the last 14 canvases, prefetch neighbours
  -> renderer-*.js      upload as a texture, draw the spread and the moving sheet
  -> curl.js            compute the sheet's vertices for this frame
  -> flipbook.js        decide what "this frame" is: spread, turn, progress
```

## Book model

`book.js` is pure arithmetic. Spread `s` of a double-page book shows pages
`[2s-1, 2s]`, with page 0 alone on the right of spread 0. The sheet between
spread `s` and `s+1` is sheet `s`: page `2s` on its front, page `2s+1` on its back.

`turn(spread, dir)` returns everything one turn needs:

- `sheet.front`, `sheet.back`: the two faces that move.
- `left`, `right`: the pages that stay visible underneath on each side.

The underlays deserve a note, because they are the part that looks wrong if you
get them backwards. Turning forward from spread `s`, the sheet lifts off the
right page, so:

- the left underlay is still the **current** left page,
- the right underlay is the **next** spread's right page, revealed as the sheet
  lifts.

Turning backward, the sheet comes off the left and lands on the right, so the
roles swap. `test/book.test.mjs` pins all of this, including that a turn never
names a page outside the document.

## The sheet

Coordinates: origin at the spine, `+x` to the right, `+y` up, `+z` toward the
reader, units are CSS pixels.

A turn is one scalar, `p`: 0 means the sheet lies flat on the right page, 1 means
it lies flat on the left. Everything else is derived per frame.

The strip is parameterised by arc length `s` in `[0, pageW]`. Three quantities
drive its shape:

```
phi    = pi * p                      how far the chord has swung
bow    = curl * sin(pi * p)          how much the leaf bends, zero at both ends
spread = 2 * phi * bow               total turning across the leaf
```

The tangent angle at arc length `s` is:

```
theta(s) = (phi - spread/2) + spread * (s / pageW) ^ bias
```

so at `p = 0.35` with `curl = 0.8`, the tangent at the spine is well behind the
chord while the tangent at the free edge is already past vertical: the root
leaves the binding shallowly and the leading edge folds over. That asymmetry is
what separates paper from a rotating card.

Integration walks the arc one segment at a time, stepping `(cos theta, sin theta)`
by the segment length, which preserves total width. Then the whole strip is
rotated by `phi - atan2(zEnd, xEnd)` so the chord lands exactly on `phi`. That
second rotation is what keeps the sheet flat at `p = 0` and `p = 1` even when the
curvature is not circular, and therefore keeps it from jumping when a turn
commits.

`DEFAULTS` in `curl.js`: `segments: 56`, `curl: 0.8`, `bias: 1.15`.

## Renderer

The camera looks straight down `-z` and its field of view is derived from the
fitted page size, so the projection at `z = 0` is exactly the 2D layout the rest
of the code reasons about. It dollies back by up to 34 percent while a sheet is
in the air, which is what keeps the swinging edge inside the frame.

Three draws:

1. The contact shadow under the book: one quad with a squircle alpha mask.
2. Each visible page, as a flat quad at `z = 0`.
3. The sheet, twice. Once with back-face culling and the front texture, once with
   front-face culling, the back texture sampled with `1 - u`, and the normal
   negated. One extra draw of a 4-vertex ribbon along the free edge gives the
   leaf visible thickness.

The sheet carries a `+0.35` z offset so it wins the depth test against the page it
is lying on. That is what allows the sheet to keep being drawn when it is exactly
flat, which removes the frame where the landing page would otherwise be missing.

Shading is half-Lambert relative to a face-on page, so a flat page renders at
exactly 1.0 and only surfaces that turn away lose brightness. The page under the
sheet is darkened in a band derived from the sheet's own horizontal footprint,
which is why the shadow travels with the leaf.

## Animation

`flipbook.js` owns the loop. It is a plain `requestAnimationFrame` that only runs
while something is happening: an animation in flight or a dirty frame.

Release is a critically damped spring integrated in two sub-steps per frame, with
the pointer's progress-per-second as the initial velocity. Critically damped
means no overshoot, which matters because the sheet has no thickness to hide a
bounce. `easing` can replace the spring's landing with any easing function.

Reduced motion skips the animation entirely: the progress jumps and the spread
commits. Dragging still works, because that is direct manipulation.

## Where correctness is pinned

| Invariant | Test |
| --- | --- |
| Spreads never name a page outside the document | `test/book.test.mjs` |
| `turn()` underlays are the right pages, both directions | `test/book.test.mjs` |
| Arc length is preserved within 1 px at every progress | `test/curl.test.mjs` |
| Zero curl is a rigid card | `test/curl.test.mjs` |
| The free edge passes vertical while the root stays shallow | `test/curl.test.mjs` |
| No frame of a turn leaves the landing half blank | `test/e2e.mjs` |
| No horizontal overflow at 320, 390, 768 | `test/e2e.mjs` |
| Error state appears for an unreadable PDF | `test/e2e.mjs` |
