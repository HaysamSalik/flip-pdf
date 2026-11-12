# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html), with
the usual 0.x caveat that the public surface may still move.

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-11-12

First public release.

### Added

- `Flipbook` component: PDF to page-turning book, WebGL renderer with a Canvas 2D
  fallback, PDF.js bundled for rasterising.
- Page turn built on a real arc. Arc length is preserved as the sheet swings, the
  tangent at the spine lags the chord, and the free edge folds past vertical, so
  the leaf foreshortens and bows instead of rotating as a flat card. The chord is
  pinned to the swing angle so the page still lands flat.
- A visible cut edge along the free edge, extruded 1.4 px.
- Lighting from the sheet's own normal, with half-Lambert shading so a page that
  turns away darkens gradually instead of going flat grey.
- Cast shadow on the page underneath, tracked to the sheet's horizontal
  footprint, plus a soft contact shadow under the book.
- Double-page spreads with single-page mode below 720 px, and automatic
  recentring when only one half of a spread has a page.
- Interaction: drag or swipe with velocity carried into a critically damped
  spring, click either half to step, arrow keys, Space, Home and End, and
  horizontal trackpad scroll.
- Chrome: progress bar, page counter, page thumbnails in a drawer, fullscreen.
- `prefers-reduced-motion: reduce` changes pages with no animation.
- `data-flip-pdf` auto-initialisation, so a script tag and one element is enough.
- Bounded page cache with prefetch, and in-flight de-duplication so a page is
  never rasterised twice.
- `maxBytes` option, a ceiling on cached page pixels. A page on a large
  high-DPR screen can exceed 20 MB, so a page count alone let the cache reach
  hundreds of megabytes.
- `styles` option, `"auto"` by default, to control stylesheet injection.
- Screenshots of the spread, a page mid-turn, the thumbnail drawer and single
  page mode, in `docs/screenshots/` and embedded in the README.
- `AGENTS.md`, an integration guide for coding agents, and `llms.txt`, the
  machine-readable index.
- Demo turning a ten page A4 document of full-bleed artwork, and
  `tools/frames.mjs` for judging the curl at fixed progress values.
- 26 geometry unit tests and 40 browser checks.

### Changed

- Integration is one file. The PDF.js worker is embedded in the bundle and
  started from a blob URL, and the stylesheet is injected once on first use, so
  there is no `<link>` to add and no worker path to configure. The separate
  `flip-pdf.css` and `pdf.worker.min.mjs` are still published for strict CSPs
  and for callers who want their own asset pipeline.
- Bundle size is now checked on every build. It fails above 620 kB gzipped.
- Thumbnails render straight from the PDF at 96 px instead of pulling full-size
  pages through the page cache. Opening the drawer no longer evicts the pages
  the reader is about to turn to, and 24 thumbnails cost about 100 kB.
- `tools/make-sample-pdf.py` writes `demo/sample-generated.pdf` rather than
  overwriting the demo file, so a generated fixture can never replace it.
- Default turn duration is 780 ms with ease-in-out easing: the leaf accelerates
  under the hand and decelerates as it lands.

### Fixed

- The moving sheet was dropped one frame before the turn committed while the
  static pages still held the pre-turn spread, leaving the landing half blank for
  about 50 ms at the end of every turn.
- Turns started without waiting for the destination page texture, so a large PDF
  could arrive as a white placeholder. Turns now start synchronously when the
  pages are cached and otherwise wait a bounded 260 ms.
- A sheet rendered flat white because its UV buffer was uploaded before the UVs
  were written.
- Non-finite turn progress produced NaN vertices and killed the whole draw call.
- Pointer capture threw on a pointer that was no longer active, which left a turn
  dangling and blocked every later turn.
- `goToSpread` resolved when a turn started rather than when it finished, so
  chained navigation silently dropped steps.
- Release velocity was always zero, so a flick never carried its speed.
- Single-page mode centred a lone page with the inverted sign, pushing it halfway
  off screen.
- The book shadow bound a null texture and painted a solid dark plate over the
  stage.
- A stalled frame stretched a release: the spring integrator advanced at most
  50 ms per delivered frame, so a long frame moved the page 50 ms instead of the
  time that actually passed. It now advances by the real elapsed time in fixed
  substeps.

### Known limitations

- Pages are rasterised, so text is not selectable or searchable.
- No annotation or form layer: links and fields inside the PDF are not live.
- Safari has not been tested. Chrome and Firefox are the tested targets.

[Unreleased]: https://github.com/HaysamSalik/flip-pdf/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/HaysamSalik/flip-pdf/releases/tag/v0.1.0
