# flip-pdf, for agents

Integration notes for coding agents. If you are adding a flipbook view of a PDF
to a page, read the first two sections and stop. Everything else is reference.

## What it is

`flip-pdf` turns a PDF into a virtual flipbook with a real page-turn animation.
The sheet is curved geometry with preserved arc length, drawn in WebGL (Canvas
2D fallback), not a CSS `rotateY`. It ships as one file with PDF.js bundled in.

Use it when the job is *presenting* a PDF as a book. Do not use it when the job
is *reading* one: pages are rasterised to a canvas, so text is not selectable,
searchable, or accessible to screen readers. For text extraction, show the PDF in
a normal viewer instead.

## The whole integration

```html
<script src="flip-pdf.js" defer></script>

<div data-flip-pdf data-src="/brochure.pdf" style="height: 620px"></div>
```

That is complete. No CSS link, no worker path, no build step. The bundle injects
its own stylesheet and starts its own PDF.js worker from a blob URL.

Rules that break it if ignored:

- **The container needs an explicit height.** The viewer fills it and letterboxes
  the book inside. A zero-height container renders nothing.
- **Width comes from the container, so never set one.** A `col-5`, a card or a
  sidebar is fine; `mode: "auto"` switches to a single page below `720px`, the
  toolbar hides the progress bar under `300px` and the counter under `220px`.
  Do not build your own responsive switching.
- **A height-less container falls back to `240px`.** Lower it with
  `--fp-min-height: 0` when the card is shorter than that.
- **Serve over HTTP.** A `file://` page cannot load the worker module or fetch
  the PDF.
- **Do not wrap it in your own pager.** Arrow keys, drag, click, trackpad and
  thumbnails are already handled. Duplicating them causes double turns.

## Programmatic use

```js
import { Flipbook } from "flip-pdf";

const book = new Flipbook(document.querySelector("#viewer"), { curl: 0.8 });
await book.load("/brochure.pdf");

book.on("pagechange", ({ spread, pages }) => console.log(spread, pages));
await book.next();
```

Via a script tag the class is `window.FlipPdf.Flipbook`.

## API

| Member | Signature | Notes |
| --- | --- | --- |
| `new Flipbook` | `(element, options?)` | Every option is also settable as a `data-*` attribute |
| `load` | `async (source) => this` | URL, `ArrayBuffer`, `Uint8Array`, or `{ url }`. Resolves after page 1 renders |
| `next` / `prev` | `async () => void` | Returns after the turn lands, not when it starts |
| `goToPage` | `async (index) => void` | 0-based page index |
| `goToSpread` | `async (spread) => void` | Queues behind an in-flight turn instead of dropping |
| `on` | `(type, handler) => unsubscribe` | `"*"` receives every event |
| `destroy` | `() => void` | Removes listeners, canvas and chrome |

Events:

| Event | Payload |
| --- | --- |
| `ready` | `{ pages }` |
| `pagechange` | `{ spread, pages }` |
| `warning` | `Error` (e.g. WebGL unavailable, fell back to Canvas 2D) |
| `error` | `Error` |

## Options that matter

| Option | Default | Use it for |
| --- | --- | --- |
| `mode` | `"auto"` | Force `"single"` or `"double"` instead of switching on width |
| `breakpoint` | `720` | Width below which auto picks single |
| `fit` | `0.82` | How much of the stage the flat book occupies |
| `curl` | `0.8` | How far the leaf bows. 0 is a rigid card |
| `duration` | `780` | Milliseconds per turn without a flick |
| `curl` / `spring` / `springOmega` / `easing` | see README | Motion feel. `easing` takes `t => t` |
| `startPage` | `null` | 0-based page to open on |
| `thumbnails` | `true` | Page drawer button |
| `keyboard` | `true` | Arrow keys, space, Home/End |
| `workerSrc` | blob URL | Set this only under a strict CSP (below) |
| `pdfjs` | `{}` | Passed to PDF.js: `password`, `httpHeaders`, `cMapUrl` |

The full table is in [README.md](README.md#options).

## Content Security Policy

The default worker is a blob URL, which needs `worker-src blob:`. If your CSP
forbids that, ship the two companion files and name the worker explicitly:

```html
<link rel="stylesheet" href="flip-pdf.css">
<script src="flip-pdf.js" defer></script>
```

```js
new Flipbook(el, { workerSrc: "/assets/pdf.worker.min.mjs" });
```

The bundle skips its style injection when a `<link href*="flip-pdf">` exists.

## Do not

- Do not copy `pdf.worker.min.mjs` under a different name; PDF.js checks its own
  version against the API and fails on a mismatch.
- Do not fork the shaders to "make the curl simpler". The geometry is pinned by
  tests in `test/curl.test.mjs`; read `docs/ARCHITECTURE.md` first.
- Do not add an animation library. A turn is one scalar; `easing` is the hook.

## Working on this repo

```bash
npm ci
npm run build        # dist/
npm test             # geometry units, no browser
npm start            # build, then serve the demo on :8099
npm run e2e          # real Chrome at 320/390/768/1280, needs the server up
```

`npm run e2e` drives `/usr/bin/google-chrome`; `FP_CHROME` overrides the binary
and `FP_BASE` the origin. The browser suite includes a frame-by-frame probe of a
cover turn, so a regression in the landing frame fails the run.

Verify a change to the page turn with `node tools/frames.mjs 1 1280`, which
writes deterministic turn frames to `test/screenshots/`.

## Licence

MIT. The bundle includes PDF.js, Apache-2.0. Keep both notices in the banner.
