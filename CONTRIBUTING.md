# Contributing

Thanks for taking a look. This is a small library with a deliberately narrow
scope, so the most useful contributions are usually bug reports with a
reproduction and fixes to the page-turn geometry.

## Before you start

For anything larger than a typo, open an issue first. A change that rewrites the
curl model or the renderer is much easier to discuss before it exists than after.

## Getting set up

```
git clone <your-fork>
cd flip-pdf
npm install
npm start
```

`npm start` builds `dist/` and serves the demo on
<http://127.0.0.1:8099/demo/>. Open that URL, not the file on disk: browsers
block module scripts and PDF fetches on `file://`, which is exactly what a PDF
viewer needs.

## Running the checks

```
npm test        # geometry units, no browser, about half a second
npm run e2e     # real Chrome at 320/390/768/1280, about twenty seconds
npm run build   # dist/, and it fails if the CSS budget is exceeded
```

Both suites must pass before a pull request is merged. `npm run e2e` needs the
server from `npm start` (or `npm run serve`) already running.

The end-to-end script drives the system Chrome at `/usr/bin/google-chrome`. Set
`FP_CHROME` to point at another binary, and `FP_BASE` at another origin.

## Where the code lives

| Path | What it does |
| --- | --- |
| `src/curl.js` | Sheet geometry. Pure maths, no DOM, fully covered by `test/curl.test.mjs` |
| `src/book.js` | Which pages sit on which spread, and which sheet a turn moves |
| `src/renderer-webgl.js` | Shaders, textures, camera, the moving shadow |
| `src/renderer-2d.js` | Canvas 2D fallback, same geometry, projected per strip |
| `src/page-cache.js` | Rasterised pages, least-recently-used, with prefetch |
| `src/flipbook.js` | DOM, gestures, animation loop, chrome |
| `src/pdf-source.js` | The only file that talks to PDF.js |
| `tools/frames.mjs` | Renders the sheet at fixed progress values so you can judge the curl |
| `build.mjs` | Two self-contained builds, plus optional companion assets |

The build embeds two things into the bundle: the PDF.js worker (started from a
blob URL) and the stylesheet (injected once). That is why integration is a single
script tag. `dist/pdf.worker.min.mjs` and `dist/flip-pdf.css` are still
written for callers with a strict CSP who would rather serve them, but nothing in
the default path depends on them.

`docs/ARCHITECTURE.md` explains the geometry, which is the part that is not
obvious from reading the code.

## Changing the look of the turn

Judging a page turn from a screenshot of a whole spread is unreliable, so there
is a tool for it:

```
npm start                                        # in one shell
node tools/frames.mjs 1 1280                     # in another
```

It writes frames at progress 0.12 through 0.88 to `/tmp/opencode/frames/`.
Compare frames at the same progress before and after a change, at the same
viewport width, or you will end up tuning against noise.

Two dials matter:

- `curl` (default 0.8) is how far the leaf bows. 0 is a rigid card; near 1 the
  free edge folds right over.
- `bias` (default 1.15) is where the curvature sits. 1 is a circular arc, higher
  values concentrate the bend at the free edge.

If a change makes the sheet reach past the page edge, or makes the far strip
darker than the near strip, it is probably wrong.

## What a good pull request looks like

- One concern per pull request.
- A test that fails before the change and passes after, for anything in
  `src/curl.js`, `src/book.js` or `src/page-cache.js`. Those files exist to be
  tested.
- For visual changes, before and after frames from `tools/frames.mjs` at a
  stated progress value.
- No new runtime dependency. The plugin ships with none beyond PDF.js, and that
  is deliberate: the animation is one scalar, so it does not need an animation
  library.
- No change to the public surface without a note in `CHANGELOG.md`.

## Things to leave alone

- Do not relicense, and do not add code you copied from a commercial product.
  The implementation is a clean-room build on top of PDF.js.
- Do not commit `node_modules/`, `dist/` or build output. `dist/` is generated
  by `npm run build` and ignored on purpose.
- Do not remove the honest limitations from the README (no text selection, no
  annotation layer). Users need to know them before they adopt this.

## Reporting a bug

Use the issue template and include: the browser and version, the renderer
reported by the viewer (`webgl` or `canvas2d`), roughly what page sizes and how
many, and what you expected the sheet to do instead of what it did. If it is
visual, a frame from `tools/frames.mjs` is worth ten paragraphs.

## Licence

By contributing you agree that your work is released under the MIT licence in
`LICENSE`.
