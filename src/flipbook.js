/**
 * The component: DOM, layout, gestures, animation loop and chrome.
 *
 * Turn progress `p` is the sheet's position: 0 lies flat on the right, 1 lies
 * flat on the left. A forward turn runs 0 -> 1, a backward turn 1 -> 0. In
 * single-page mode both directions only use 0 -> 0.5 (or 0.5 -> 0), because at
 * 0.5 the sheet stands edge-on and the page swap that follows is invisible.
 */
import { BookModel, spreadLabel } from "./book.js";
import { PageCache } from "./page-cache.js";
import { openDocument, configurePdfJs } from "./pdf-source.js";
import { WebGLRenderer } from "./renderer-webgl.js";
import { Canvas2DRenderer } from "./renderer-2d.js";
import { clamp } from "./gl.js";
import stylesheet from "#fp-css";

let stylesInstalled = false;

/**
 * Inject the viewer's own CSS once. Integration is one script tag, and the
 * stylesheet travels with it, so a missing <link> cannot leave a broken layout.
 * Callers who serve the CSS themselves get it skipped automatically.
 */
export function installStyles(doc = typeof document !== "undefined" ? document : null) {
  if (stylesInstalled || !doc) return;
  const linked = doc.querySelector('link[href*="flip-pdf"]');
  if (linked) {
    stylesInstalled = true;
    return;
  }
  const style = doc.createElement("style");
  style.dataset.flipPdfStyle = "";
  style.textContent = stylesheet;
  (doc.head || doc.documentElement).append(style);
  stylesInstalled = true;
}

// A leaf of paper has mass: it accelerates under the hand and decelerates as it
// lands, which is what separates it from a UI transition.
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const DEFAULTS = {
  mode: "auto",
  breakpoint: 720,
  fit: 0.82,
  workerSrc: undefined,
  renderer: "auto",
  maxTextureWidth: 2048,
  cacheSize: 14,
  duration: 780,
  spring: true,
  springOmega: 11,
  curl: 0.8,
  easing: undefined,
  dragDistance: 0.55,
  wheel: "horizontal",
  thumbnails: true,
  keyboard: true,
  startPage: null,
  /** "auto" injects the stylesheet unless a <link> already provides it. */
  styles: "auto",
  /** Cap on rasterised page pixels held in memory, in bytes. */
  maxBytes: 96 * 1024 * 1024,
  label: "Flipbook",
  exportable: false,
  pageLabel: (page, count) => `Page ${page} of ${count}`,
};

const ICONS = {
  prev: '<path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  next: '<path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  grid: '<path d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  expand: '<path d="M9 5H5v4M15 5h4v4M9 19H5v-4M15 19h4v-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
};

const icon = (name) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

let workerSrcResolver = () => undefined;

/** Lets the entry point tell the component where the bundled worker lives. */
export function setWorkerSrcResolver(resolver) {
  workerSrcResolver = resolver;
}

export class Flipbook {
  constructor(element, options = {}) {
    if (!element) throw new Error("Flipbook needs a container element");
    this.el = element;
    this.options = { ...DEFAULTS, ...options };
    configurePdfJs({
      workerSrc: this.options.workerSrc ?? workerSrcResolver(),
      ...this.options.pdfjs,
    });

    this.listeners = new Set();
    this.spread = 0;
    this.turn = null;
    this.book = null;
    this.cache = null;
    this.source = null;
    this.renderer = null;
    this.destroyed = false;
    this.ready = false;

    this._raf = 0;
    this._anim = null;
    this._drag = null;
    this._lastWheel = 0;
    this._wheelAcc = 0;
    this._dirty = true;

    if (this.options.styles !== false) installStyles(this.el.ownerDocument);
    this._build();
    this._bind();
  }

  // ---------------------------------------------------------------- public

  on(type, handler) {
    this.listeners.add({ type, handler });
    return () => this.listeners.delete({ type, handler });
  }

  _emit(type, detail) {
    for (const listener of this.listeners) {
      if (listener.type === type || listener.type === "*") {
        try {
          listener.handler(detail);
        } catch (error) {
          console.error("[flip-pdf] listener failed", error);
        }
      }
    }
  }

  async load(source) {
    this._lastSource = source;
    this._setStatus("loading", "Loading document");
    try {
      this.source = await openDocument(source, this.options.pdfjs);
      if (this.destroyed) return this;

      const size = await this.source.size(0);
      this.aspect = size.width / size.height || 0.72;

      this.book = new BookModel(this.source.numPages, { mode: this._mode() });
      if (this.options.startPage !== null && this.options.startPage !== undefined) {
        this.spread = clamp(this.book.spreadOfPage(this.options.startPage), 0, this.book.lastSpread);
      }
      this.cache = new PageCache(this.source, {
        capacity: this.options.cacheSize,
        maxWidth: this.options.maxTextureWidth,
        maxBytes: this.options.maxBytes,
      });
      // A page that finished rasterising after the last frame needs a repaint.
      this.cache.on((event) => {
        if (event.type !== "load") return;
        this._dirty = true;
        this._schedule();
        this._markThumbs();
      });

      await this._ensureFirstSpread();

      this._createRenderer();
      this._measure(true);
      this._setStatus(null);
      this.ready = true;
      this._sync();

      this._emit("ready", { pages: this.source.numPages });
      this._prefetch();
      this._schedule();
      return this;
    } catch (error) {
      this._setStatus("error", error?.message || "Could not read this PDF");
      this._emit("error", error);
      throw error;
    }
  }

  next() {
    return this._turnTo(1);
  }

  prev() {
    return this._turnTo(-1);
  }

  goToPage(page) {
    if (!this.book) return Promise.resolve();
    const target = this.book.spreadOfPage(page);
    return this.goToSpread(target);
  }

  async goToSpread(target) {
    if (!this.book) return;
    // A jump requested while a turn is in flight waits for it instead of
    // being dropped, so callers can chain navigation without racing.
    if (this._anim || this.turn) await this._whenIdle();
    if (!this.book) return;
    const clamped = clamp(Math.round(target), 0, this.book.lastSpread);
    if (clamped === this.spread) return;
    const dir = clamped > this.spread ? 1 : -1;
    // One spread at a time keeps the motion honest; loops instead of jumping.
    const steps = Math.abs(clamped - this.spread);
    for (let i = 0; i < steps; i++) {
      await this._turnTo(dir, i > 0);
    }
  }

  /** Resolves once no turn or animation is running. */
  _whenIdle() {
    if (!this._anim && !this.turn) return Promise.resolve();
    return new Promise((resolve) => {
      const poll = () => {
        if (this.destroyed || (!this._anim && !this.turn)) resolve();
        else setTimeout(poll, 40);
      };
      setTimeout(poll, 40);
    });
  }

  get pageCount() {
    return this.source?.numPages ?? 0;
  }

  get currentPages() {
    return this.book?.spreadPages(this.spread) ?? [null, null];
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._unbind();
    this.renderer?.destroy();
    this.cache?.clear();
    this.source?.destroy().catch(() => {});
    this.el.innerHTML = "";
    this.el.classList.remove("fp-host");
  }

  // ------------------------------------------------------------------ DOM

  _mode() {
    if (this.options.mode === "double" || this.options.mode === "single") return this.options.mode;
    const width = this.el.clientWidth || 0;
    return width > 0 && width < this.options.breakpoint ? "single" : "double";
  }

  _build() {
    this.el.classList.add("fp-host");
    this.el.innerHTML = "";

    const root = document.createElement("div");
    root.className = "fp";
    root.setAttribute("role", "group");
    root.setAttribute("aria-roledescription", "flipbook");
    root.setAttribute("aria-label", this.options.label);
    if (this.options.keyboard) root.tabIndex = 0;

    const stage = document.createElement("div");
    stage.className = "fp-stage";

    const canvas = document.createElement("canvas");
    canvas.className = "fp-canvas";
    canvas.setAttribute("aria-hidden", "true");

    const status = document.createElement("div");
    status.className = "fp-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = true;

    const live = document.createElement("p");
    live.className = "fp-sr";
    live.setAttribute("aria-live", "polite");

    stage.append(canvas, status, live);

    const bar = document.createElement("div");
    bar.className = "fp-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Flipbook controls");

    const prev = this._button("fp-prev", "Previous page", icon("prev"));
    const next = this._button("fp-next", "Next page", icon("next"));

    const readout = document.createElement("div");
    readout.className = "fp-readout";
    const progress = document.createElement("div");
    progress.className = "fp-progress";
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", "100");
    progress.setAttribute("aria-valuenow", "0");
    progress.setAttribute("aria-label", "Reading progress");
    const fill = document.createElement("span");
    fill.className = "fp-progress-fill";
    progress.append(fill);

    const counter = document.createElement("span");
    counter.className = "fp-counter";
    counter.textContent = "";

    readout.append(progress, counter);

    bar.append(prev, readout, next);

    if (this.options.thumbnails) {
      const thumbs = this._button("fp-thumbs", "Page thumbnails", icon("grid"));
      thumbs.setAttribute("aria-expanded", "false");
      thumbs.setAttribute("aria-controls", `fp-thumbs-${this._uid()}`);
      bar.append(thumbs);
      this.thumbsButton = thumbs;
    }

    const full = this._button("fp-full", "Enter fullscreen", icon("expand"));
    bar.append(full);

    const panel = document.createElement("div");
    panel.className = "fp-drawer";
    panel.id = `fp-thumbs-${this._uid()}`;
    panel.hidden = true;
    panel.setAttribute("aria-label", "Page thumbnails");
    const grid = document.createElement("div");
    grid.className = "fp-thumbs-grid";
    panel.append(grid);

    root.append(stage, bar, panel);
    this.el.append(root);

    this.nodes = { root, stage, canvas, status, live, bar, prev, next, progress, fill, counter, full, panel, grid };
  }

  _uid() {
    if (!this._id) this._id = Math.random().toString(36).slice(2, 9);
    return this._id;
  }

  _button(className, label, markup) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `fp-btn ${className}`;
    button.innerHTML = markup;
    button.setAttribute("aria-label", label);
    return button;
  }

  _bind() {
    const { root, stage, prev, next, full } = this.nodes;

    this._onPrev = () => this.prev();
    this._onNext = () => this.next();
    this._onFull = () => this._toggleFullscreen();

    prev.addEventListener("click", this._onPrev);
    next.addEventListener("click", this._onNext);
    full.addEventListener("click", this._onFull);
    this.thumbsButton?.addEventListener("click", () => this._toggleDrawer());

    this._onKey = (event) => this._handleKey(event);
    root.addEventListener("keydown", this._onKey);

    this._onPointerDown = (event) => this._pointerDown(event);
    this._onPointerMove = (event) => this._pointerMove(event);
    this._onPointerUp = (event) => this._pointerUp(event);
    stage.addEventListener("pointerdown", this._onPointerDown);
    stage.addEventListener("pointermove", this._onPointerMove);
    stage.addEventListener("pointerup", this._onPointerUp);
    stage.addEventListener("pointercancel", this._onPointerUp);
    stage.addEventListener("lostpointercapture", this._onPointerUp);

    this._onWheel = (event) => this._wheel(event);
    stage.addEventListener("wheel", this._onWheel, { passive: false });

    this._onFsChange = () => this._syncFullscreen();
    document.addEventListener("fullscreenchange", this._onFsChange);

    this._onResize = () => this._measure();
    this.resizeObserver = new ResizeObserver(this._onResize);
    this.resizeObserver.observe(this.el);
  }

  _unbind() {
    const { stage, prev, next, full, root } = this.nodes;
    prev.removeEventListener("click", this._onPrev);
    next.removeEventListener("click", this._onNext);
    full.removeEventListener("click", this._onFull);
    stage.removeEventListener("pointerdown", this._onPointerDown);
    stage.removeEventListener("pointermove", this._onPointerMove);
    stage.removeEventListener("pointerup", this._onPointerUp);
    stage.removeEventListener("pointercancel", this._onPointerUp);
    stage.removeEventListener("lostpointercapture", this._onPointerUp);
    stage.removeEventListener("wheel", this._onWheel);
    root.removeEventListener("keydown", this._onKey);
    document.removeEventListener("fullscreenchange", this._onFsChange);
    this.resizeObserver?.disconnect();
  }

  // --------------------------------------------------------------- render

  _createRenderer() {
    const { canvas } = this.nodes;
    const want = this.options.renderer;
    const canUseWebGL = WebGLRenderer.isSupported();
    try {
      this.renderer =
        want === "canvas2d" || !canUseWebGL
          ? new Canvas2DRenderer(canvas, { fit: this.options.fit })
          : new WebGLRenderer(canvas, {
              fit: this.options.fit,
              maxTexture: this.options.maxTextureWidth,
              curl: this.options.curl,
              preserveDrawingBuffer: this.options.exportable,
            });
      this.backend = this.renderer instanceof WebGLRenderer ? "webgl" : "canvas2d";
    } catch (error) {
      this.renderer = new Canvas2DRenderer(canvas, { fit: this.options.fit, curl: this.options.curl });
      this.backend = "canvas2d";
      this._emit("warning", error);
    }
    this.renderer.setCache(this.cache);
  }

  _measure(force = false) {
    if (!this.book || !this.renderer) return;
    const { stage } = this.nodes;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (width < 2 || height < 2) return;

    const mode = this._mode();
    if (mode !== this.book.mode) {
      this.book = new BookModel(this.source.numPages, { mode });
      this.spread = Math.min(this.spread, this.book.lastSpread);
      force = true;
    }

    const cols = this.book.isSingle ? 1 : 2;
    const fit = this.options.fit;
    // Single mode only ever swings between standstill and 90 degrees, so the
    // sheet never crosses left of the spine and needs no extra width.
    const sweep = cols;

    const pageH = Math.min(height * fit, (width * fit) / (this.aspect * sweep));
    const pageW = pageH * this.aspect;

    this.metrics = { pageW, pageH, cols };
    this.renderer.setLayout({
      pageW,
      pageH,
      cols,
      fitWidth: pageW * sweep,
      centerX: 0,
      curl: this.options.curl,
    });

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.resize(width, height, dpr);
    this.cache.setTargetWidth(pageW * dpr);
    if (force) {
      this._sync();
      this._prefetch();
    }
    this._dirty = true;
    this._schedule();
  }

  _schedule() {
    if (this._raf || this.destroyed) return;
    this._raf = requestAnimationFrame(this._frame);
  }

  _frame = (time) => {
    this._raf = 0;
    if (this.destroyed) return;
    let animating = false;
    if (this._anim) animating = this._step(time);
    this._draw();
    if (animating || this._dirty) this._schedule();
  };

  _draw() {
    if (!this.renderer || !this.book) return;
    this.renderer.draw({
      spreadPages: this.book.spreadPages(this.spread),
      turn: this.turn,
      centerX: this._centerX(),
    });
    this._dirty = false;
  }

  /**
   * Where the middle of the visible paper sits, in book coordinates. A lone
   * page (the cover, the last page, or every page in single mode) is shifted
   * so it lands in the middle of the stage instead of hugging the spine.
   */
  _centerForSpread(spread) {
    const [left, right] = this.book.spreadPages(spread);
    const half = (this.metrics?.pageW ?? 0) / 2;
    if (left !== null && right !== null) return 0;
    // A page on the right half spans 0..pageW, so its centre is +half; a page
    // on the left half spans -pageW..0, so its centre is -half.
    if (right !== null) return half;
    if (left !== null) return -half;
    return 0;
  }

  _centerX() {
    const turn = this.turn;
    if (!turn) return this._centerForSpread(this.spread);
    const from = this._centerForSpread(turn.from);
    const to = this._centerForSpread(turn.to);
    const t = turn.dir > 0 ? turn.progress : 1 - turn.progress;
    return from + (to - from) * t;
  }

  // ---------------------------------------------------------------- turns

  async _ensureFirstSpread() {
    const first = [0, 1, 2, 3].filter((i) => i < this.source.numPages);
    await Promise.all(first.map((i) => this.cache.ensure(i).catch(() => {})));
  }

  _prefetch() {
    if (!this.book || !this.cache) return;
    const pages = new Set();
    for (let s = this.spread - 2; s <= this.spread + 3; s++) {
      const spread = this.book.spreadPages(s);
      if (!spread) continue;
      for (const page of spread) if (page !== null) pages.add(page);
    }
    this.cache.prefetch([...pages]);
  }

  _turnTo(dir, quiet = false, budget = 260) {
    if (!this.book || this.turn || this._anim) return Promise.resolve(false);
    const spec = this.book.turn(this.spread, dir);
    if (!spec) return Promise.resolve(false);

    const single = this.book.isSingle;
    const p0 = single ? (dir > 0 ? 0 : 0.5) : dir > 0 ? 0 : 1;
    const p1 = single ? (dir > 0 ? 0.5 : 0) : dir > 0 ? 1 : 0;

    const begin = () => {
      this.turn = { ...spec, progress: p0, p0, p1 };
      // Register before starting: an instant turn finishes inside _animateTo.
      const done = new Promise((resolve) => {
        (this._turnWaiters ||= []).push(resolve);
      });
      this._animateTo(p1, quiet);
      return done;
    };

    // Start at once when the pages are already rasterised, which is the common
    // case. Otherwise wait a short, bounded time: starting immediately would
    // flip a blank sheet, and waiting without a limit would make the button
    // feel dead on a heavy document.
    const needed = [spec.sheet.front, spec.sheet.back, spec.left, spec.right].filter((p) => p !== null);
    if (needed.every((page) => this.cache.getFresh(page))) return Promise.resolve(begin());

    const pages = Promise.all(needed.map((page) => this.cache.ensure(page).catch(() => {})));
    const timeout = new Promise((resolve) => setTimeout(resolve, Math.max(0, budget)));
    return Promise.race([pages, timeout]).then(begin);
  }

  _animateTo(target, instant = false, velocity = 0) {
    const from = this.turn?.progress ?? 0;
    const distance = Math.abs(target - from);
    if (distance < 0.0005 && Math.abs(velocity) < 0.05) {
      this._finishTurn();
      return;
    }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const spring = this.options.spring && !instant && !reduce && velocity !== 0;

    if (reduce || instant) {
      this._anim = null;
      this.turn.progress = target;
      this._finishTurn();
      return;
    }

    if (spring) {
      // Carries the finger's velocity into the release, so a flick keeps going
      // and a slow drag settles back. Critically damped: no overshoot, which
      // matters because the sheet has no thickness to hide a bounce.
      this._anim = {
        kind: "spring",
        from,
        to: target,
        x: from - target,
        v: velocity,
        omega: this.options.springOmega,
        elapsed: 0,
      };
      this._schedule();
      return;
    }

    const duration = clamp(this.options.duration * distance, 190, this.options.duration);
    this._anim = { kind: "tween", from, to: target, start: 0, duration };
    this._schedule();
  }

  _step(time) {
    const anim = this._anim;
    if (!anim) return false;

    if (anim.kind === "spring") {
      return this._stepSpring(anim, time);
    }

    if (!anim.start) anim.start = time;
    const t = anim.duration === 0 ? 1 : clamp((time - anim.start) / anim.duration, 0, 1);
    const ease = this.options.easing;
    const eased = typeof ease === "function" ? clamp(ease(t), 0, 1) : easeInOutCubic(t);
    this.turn.progress = anim.from + (anim.to - anim.from) * eased;
    this._dirty = true;
    if (t >= 1) {
      this._anim = null;
      this._finishTurn();
      return false;
    }
    return true;
  }

  _stepSpring(anim, time) {
    if (!anim.last) anim.last = time;
    // Two fixed sub-steps keep the integrator stable when a frame runs long
    // (tab switch, layout thrash) without making the motion frame-rate
    // dependent.
    const dt = Math.min(0.05, Math.max(0, (time - anim.last) / 1000));
    anim.last = time;
    anim.elapsed += dt;
    const h = dt > 0 ? dt / 2 : 1 / 120;
    const { omega } = anim;
    for (let i = 0; i < (dt > 0 ? 2 : 1); i++) {
      const a = -omega * omega * anim.x - 2 * omega * anim.v;
      anim.v += a * h;
      anim.x += anim.v * h;
    }

    this.turn.progress = clamp(anim.to + anim.x, 0, 1);
    this._dirty = true;

    const settled = Math.abs(anim.x) < 0.004 && Math.abs(anim.v) < 0.06;
    // Critically damped travel from a full page always settles well inside
    // this; the cap only exists so a pathological frame cannot stall the turn.
    const expired = anim.elapsed > 1.6;
    if (settled || expired) {
      this.turn.progress = anim.to;
      this._anim = null;
      this._finishTurn();
      return false;
    }
    return true;
  }

  _finishTurn() {
    const waiters = this._turnWaiters;
    this._turnWaiters = [];
    for (const resolve of waiters ?? []) resolve();
    if (!this.turn) return;
    const finished = this.turn;
    const reached = Math.abs(finished.progress - finished.p1) < 0.001;
    this.turn = null;

    if (reached) {
      this.spread = finished.to;
      this._sync();
      this._emit("pagechange", {
        spread: this.spread,
        pages: this.book.spreadPages(this.spread),
      });
      this._prefetch();
    }
    this._dirty = true;
    this._schedule();
  }

  // ------------------------------------------------------------- gestures

  _pointerDown(event) {
    if (!this.ready || event.button > 0) return;
    if (this._anim) return;
    const { stage } = this.nodes;
    // Capture throws when the pointer is no longer active (and for synthetic
    // events); the drag works without it, so never let it break the gesture.
    try {
      stage.setPointerCapture?.(event.pointerId);
    } catch {
      /* pointer already gone */
    }
    this._drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      time: event.timeStamp,
      dx: 0,
      active: false,
      dir: 0,
      startProgress: 0,
    };
  }

  _pointerMove(event) {
    const drag = this._drag;
    if (!drag || drag.id !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.active) {
      if (Math.abs(dx) < 7 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      const dir = dx < 0 ? 1 : -1;
      const single = this.book.isSingle;
      const p0 = single ? (dir > 0 ? 0 : 0.5) : dir > 0 ? 0 : 1;
      const p1 = single ? (dir > 0 ? 0.5 : 0) : dir > 0 ? 1 : 0;
      const spec = this.book.turn(this.spread, dir);
      if (!spec) return;
      drag.active = true;
      drag.dir = dir;
      drag.p0 = p0;
      drag.p1 = p1;
      drag.distance = Math.max(80, this.metrics.pageW * this.options.dragDistance);
      this.turn = { ...spec, progress: p0, p0, p1 };
      this._dirty = true;
      this._schedule();
    }

    const previous = Math.abs(drag.dx);
    drag.dx = dx;
    const span = Math.abs(drag.p1 - drag.p0) || 1;
    const travel = clamp(Math.abs(dx) / drag.distance, 0, 1);
    const sign = drag.dir > 0 ? 1 : -1;
    // Forward: dragging left increases progress. Backward: dragging right
    // decreases it. Both map to "the sheet follows the finger".
    this.turn.progress = clamp(drag.p0 + sign * travel * span, 0, 1);

    // Progress per second, measured between pointer events and smoothed so one
    // jittery sample cannot throw the release.
    const dtMs = Math.max(8, event.timeStamp - (drag.lastTime ?? drag.time));
    const rate = (sign * (Math.abs(dx) - previous) * span * 1000) / (dtMs * drag.distance);
    drag.velocity = drag.velocity == null ? rate : drag.velocity * 0.45 + rate * 0.55;
    drag.lastTime = event.timeStamp;

    this._dirty = true;
    this._schedule();
  }

  _pointerUp(event) {
    const drag = this._drag;
    if (!drag || drag.id !== event.pointerId) return;
    this._drag = null;
    try {
      this.nodes.stage.releasePointerCapture?.(event.pointerId);
    } catch {
      /* nothing captured */
    }

    if (!drag.active) {
      const dt = event.timeStamp - drag.time;
      if (Math.abs(drag.startY - event.clientY) > 12) return;
      if (dt > 600) return;
      const rect = this.nodes.stage.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      if (x < 0.5) this.prev();
      else this.next();
      return;
    }

    const span = Math.abs(drag.p1 - drag.p0) || 1;
    const travelled = Math.abs(this.turn.progress - drag.p0) / span;

    // Progress per second at the moment of release, so the sheet keeps the
    // speed the finger gave it instead of always running a fixed duration.
    // A finger that stopped before lifting has no velocity to carry.
    const stale = event.timeStamp - (drag.lastTime ?? drag.time) > 140;
    const velocity = stale ? 0 : clamp(drag.velocity ?? 0, -6, 6);
    const toward = velocity * (drag.p1 - drag.p0) > 0;

    if (travelled > 0.28 || (toward && Math.abs(velocity) > 1.2)) {
      this._animateTo(drag.p1, false, velocity);
    } else {
      this._animateTo(drag.p0, false, velocity);
    }
  }

  _wheel(event) {
    if (!this.ready || this._anim) return;
    const mode = this.options.wheel;
    if (mode === "off") return;
    const fullscreen = document.fullscreenElement === this.nodes.root;
    if (mode !== "always" && !fullscreen && Math.abs(event.deltaY) > Math.abs(event.deltaX)) return;

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    this._wheelAcc += delta;
    if (event.cancelable && Math.abs(delta) > 4) event.preventDefault();

    const now = event.timeStamp;
    if (now - this._lastWheel < 380) return;
    if (Math.abs(this._wheelAcc) < 26) return;
    this._wheelAcc = 0;
    this._lastWheel = now;
    if (delta > 0) this.next();
    else this.prev();
  }

  _handleKey(event) {
    if (!this.ready) return;

    if (event.key === "Escape") {
      if (!this.nodes.panel.hidden) {
        this._closeDrawer();
        this.nodes.root.focus();
        event.preventDefault();
      }
      return;
    }

    // Only the viewer itself turns pages; buttons keep their own key handling.
    if (event.target !== this.nodes.root) return;

    const key = event.key;
    let handled = true;
    switch (key) {
      case "ArrowRight":
      case "PageDown":
      case " ":
        this.next();
        break;
      case "ArrowLeft":
      case "PageUp":
        this.prev();
        break;
      case "Home":
        this.goToSpread(0);
        break;
      case "End":
        this.goToSpread(this.book?.lastSpread ?? 0);
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  }

  // ----------------------------------------------------------------- chrome

  _sync() {
    if (!this.book) return;
    const spread = this.book.spreadPages(this.spread);
    const label = spreadLabel(spread);
    const total = this.source.numPages;

    this.nodes.counter.textContent = total ? `${label} / ${total}` : "";
    const percent = this.book.lastSpread === 0 ? 100 : Math.round((this.spread / this.book.lastSpread) * 100);
    this.nodes.fill.style.inlineSize = `${percent}%`;
    this.nodes.progress.setAttribute("aria-valuenow", String(percent));
    this.nodes.live.textContent = `${this.options.pageLabel(label, total)}`;

    const canPrev = this.spread > 0;
    const canNext = this.spread < this.book.lastSpread;
    this.nodes.prev.disabled = !canPrev;
    this.nodes.next.disabled = !canNext;

    this._markThumbs();
  }

  _setStatus(kind, message) {
    const node = this.nodes.status;
    if (!kind) {
      node.hidden = true;
      node.textContent = "";
      node.dataset.state = "";
      return;
    }
    node.hidden = false;
    node.dataset.state = kind;
    node.textContent = message || "";
    if (kind === "error") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "fp-btn fp-retry";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => {
        if (this._lastSource) this.load(this._lastSource);
      });
      node.append(retry);
    }
  }

  _toggleDrawer(force) {
    const panel = this.nodes.panel;
    const open = force ?? panel.hidden;
    panel.hidden = !open;
    this.thumbsButton?.setAttribute("aria-expanded", String(open));
    if (open) {
      this._buildThumbs();
      panel.querySelector("button")?.focus();
    }
  }

  _closeDrawer() {
    if (!this.nodes.panel.hidden) this._toggleDrawer(false);
  }

  _buildThumbs() {
    if (!this.book || this.nodes.grid.childElementCount) return;
    const total = this.source.numPages;
    for (let i = 0; i < total; i++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fp-thumb";
      button.dataset.page = String(i);
      button.setAttribute("aria-label", `Page ${i + 1}`);
      const inset = document.createElement("span");
      inset.className = "fp-thumb-img";
      const num = document.createElement("span");
      num.className = "fp-thumb-n";
      num.textContent = String(i + 1);
      button.append(inset, num);
      button.addEventListener("click", () => {
        this.goToPage(i);
        this._closeDrawer();
        this.nodes.root.focus();
      });
      this.nodes.grid.append(button);
    }
    this._markThumbs();
    this._paintThumbs();
  }

  /**
   * Thumbnails are rendered straight from the PDF at 96 px, not taken from the
   * page cache. Pulling full-size pages through the cache for a 24 page drawer
   * would evict the pages the reader is about to turn to, and a 20 MB page
   * makes a pointless JPEG.
   */
  _thumbUrl(page) {
    this.thumbUrls ??= new Map();
    const cached = this.thumbUrls.get(page);
    if (cached) return cached;
    const job = this.source
      .render(page, 96, { maxPixels: 192 })
      .then((raster) => raster.canvas.toDataURL("image/jpeg", 0.72))
      .catch(() => null);
    this.thumbUrls.set(page, job);
    return job;
  }

  _paintThumbs() {
    if (this.nodes.panel.hidden || !this.source) return;
    const queue = [...this.nodes.grid.children].filter((b) => !b.dataset.painted);
    let cursor = 0;

    // Three at a time: PDF.js renders on its own worker, so a couple of small
    // renders overlap usefully without flooding it or the main thread.
    const drain = async () => {
      while (cursor < queue.length) {
        if (this.destroyed || this.nodes.panel.hidden) return;
        const button = queue[cursor++];
        const url = await this._thumbUrl(Number(button.dataset.page));
        if (!url || button.dataset.painted || this.destroyed) continue;
        const img = new Image();
        img.decoding = "async";
        img.alt = "";
        img.src = url;
        button.querySelector(".fp-thumb-img").append(img);
        button.dataset.painted = "1";
      }
    };
    Promise.all([drain(), drain(), drain()]);
  }

  _markThumbs() {
    if (!this.book || !this.nodes.grid.childElementCount) return;
    const [left, right] = this.currentPages;
    for (const button of this.nodes.grid.children) {
      const page = Number(button.dataset.page);
      const active = page === left || page === right;
      button.classList.toggle("is-current", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    }
  }

  _toggleFullscreen() {
    const root = this.nodes.root;
    if (document.fullscreenElement === root) {
      document.exitFullscreen?.();
    } else {
      root.requestFullscreen?.().catch(() => {});
    }
  }

  _syncFullscreen() {
    const active = document.fullscreenElement === this.nodes.root;
    this.nodes.full.setAttribute("aria-label", active ? "Exit fullscreen" : "Enter fullscreen");
    this.nodes.root.classList.toggle("is-fullscreen", active);
    this._measure(true);
  }
}

/**
 * Replace `[data-flip-pdf]` placeholders with a flipbook. `data-src` is the PDF
 * URL; every other `data-*` attribute maps to an option (kebab-case).
 */
export function autoInit(scope = document) {
  const nodes = scope.querySelectorAll("[data-flip-pdf]");
  const books = [];
  for (const node of nodes) {
    if (node.dataset.fpReady) continue;
    node.dataset.fpReady = "1";
    const options = {};
    for (const [key, value] of Object.entries(node.dataset)) {
      if (key === "src" || key === "fpReady" || key === "flipbook") continue;
      options[key] = coerce(value);
    }
    const src = node.dataset.src;
    const book = new Flipbook(node, options);
    node.flipbook = book;
    book._lastSource = src;
    book.load(src).catch(() => {});
    books.push(book);
  }
  return books;
}

function coerce(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && !Number.isNaN(Number(value))) return Number(value);
  return value;
}
