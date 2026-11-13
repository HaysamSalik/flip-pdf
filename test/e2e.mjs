/**
 * Browser checks with the locally installed Chrome. Not a test framework:
 * every assertion prints, every failure sets the exit code.
 */
import { chromium } from "playwright-core";
import { mkdir, rm } from "node:fs/promises";

const BASE = process.env.FP_BASE || "http://127.0.0.1:8099";
const SHOTS = "test/screenshots";
const CHROME = process.env.FP_CHROME || "/usr/bin/google-chrome";

const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await rm(SHOTS, { recursive: true, force: true });
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-lcd-text"],
});

const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (error) => errors.push(String(error)));

await page.goto(`${BASE}/demo/`, { waitUntil: "networkidle" });

// ---------------------------------------------------------------- ready
await page.waitForFunction(() => {
  const host = document.querySelector(".viewer [data-flip-pdf]");
  return host?.querySelector(".fp") && host.flipbook?.ready === true;
}, null, { timeout: 20000 }).catch(() => {});

const state = await page.evaluate(() => {
  const host = document.querySelector(".viewer [data-flip-pdf]");
  const fp = host?.querySelector(".fp");
  const canvas = host?.querySelector(".fp-canvas");
  return {
    hasRoot: !!fp,
    backend: host?.flipbook?.backend,
    pages: host?.flipbook?.pageCount,
    canvasW: canvas?.width,
    canvasH: canvas?.height,
    counter: host?.querySelector(".fp-counter")?.textContent,
    counterColor: host ? getComputedStyle(host.querySelector(".fp-counter")).color : null,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

check("flipbook root mounted", state.hasRoot);
// demo/sample.pdf is the fixture; 10 pages is its real length.
check("pdf pages counted", state.pages === 10, `pages=${state.pages}`);
check("renderer backend", state.backend === "webgl" || state.backend === "canvas2d", `backend=${state.backend}`);
check("canvas sized", (state.canvasW ?? 0) > 400 && (state.canvasH ?? 0) > 300, `${state.canvasW}x${state.canvasH}`);
check("counter reads spread", state.counter === "1 / 10", `counter=${state.counter}`);
check("no horizontal overflow", state.overflow <= 0, `overflow=${state.overflow}`);

await page.screenshot({ path: `${SHOTS}/01-cover-1280.png` });

// ------------------------------------------------------------ turn pages
await page.evaluate(() => document.querySelector(".viewer [data-flip-pdf]").flipbook.next());
await sleep(900);
const afterNext = await page.evaluate(() => {
  const book = document.querySelector(".viewer [data-flip-pdf]").flipbook;
  return { spread: book.spread, pages: book.currentPages, counter: document.querySelector(".viewer .fp-counter").textContent };
});
check("next() advances a spread", afterNext.spread === 1, JSON.stringify(afterNext));

// Frames during a turn, for visual inspection of the curl.
await page.evaluate(() => document.querySelector(".viewer [data-flip-pdf]").flipbook.next());
await sleep(180);
await page.screenshot({ path: `${SHOTS}/02-turn-25.png` });
await sleep(200);
await page.screenshot({ path: `${SHOTS}/03-turn-55.png` });
await sleep(120);
await page.screenshot({ path: `${SHOTS}/04-turn-80.png` });
await sleep(600);
await page.screenshot({ path: `${SHOTS}/05-spread-2.png` });

const pixels = await page.evaluate(() => {
  const canvas = document.querySelector(".viewer .fp-canvas");
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  if (!gl) return { kind: "2d" };
  // The context has no preserved backbuffer, so redraw and read in one task:
  // a read after a composited frame returns zeros.
  document.querySelector(".viewer [data-flip-pdf]").flipbook._draw();
  const w = canvas.width, h = canvas.height;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let opaque = 0, dark = 0;
  for (let i = 3; i < buf.length; i += 4) {
    if (buf[i] > 8) {
      opaque++;
      if (buf[i - 1] < 200) dark++;
    }
  }
  return { kind: "gl", opaque, dark, total: w * h };
});
if (pixels.kind === "gl") {
  const coverage = pixels.opaque / pixels.total;
  check("canvas has drawn content", coverage > 0.25, `coverage=${coverage.toFixed(3)}`);
} else {
  check("canvas has drawn content", true, "2d backend, screenshot only");
}

// ------------------------------------------------------------- backwards
await page.evaluate(() => document.querySelector(".viewer [data-flip-pdf]").flipbook.prev());
await sleep(900);
const afterPrev = await page.evaluate(() => document.querySelector(".viewer [data-flip-pdf]").flipbook.spread);
check("prev() returns a spread", afterPrev === 1, `spread=${afterPrev}`);

// ------------------------------------------------------------ drag to turn
const box = await page.locator(".viewer .fp-stage").boundingBox();
await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5);
await page.mouse.down();
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(box.x + box.width * 0.8 - (box.width * 0.7 * i) / 12, box.y + box.height * 0.5);
  await sleep(16);
}
await page.screenshot({ path: `${SHOTS}/06-drag-mid.png` });
await page.mouse.up();
await sleep(900);
const afterDrag = await page.evaluate(() => document.querySelector(".viewer [data-flip-pdf]").flipbook.spread);
check("drag turns the page", afterDrag === 2, `spread=${afterDrag}`);

// ----------------------------------------------------------------- keyboard
await page.locator(".viewer .fp").focus();
await page.keyboard.press("ArrowRight");
await sleep(900);
const afterKey = await page.evaluate(() => document.querySelector(".viewer [data-flip-pdf]").flipbook.spread);
check("arrow key turns the page", afterKey === 3, `spread=${afterKey}`);

// --------------------------------------------------------------- thumbnails
await page.locator(".viewer .fp-btn.fp-thumbs").click();
await sleep(700);
const drawer = await page.evaluate(() => {
  const panel = document.querySelector(".viewer .fp-drawer");
  return {
    open: !panel.hidden,
    thumbs: panel.querySelectorAll(".fp-thumb").length,
    painted: panel.querySelectorAll(".fp-thumb-img img").length,
    expanded: document.querySelector(".viewer .fp-btn.fp-thumbs").getAttribute("aria-expanded"),
  };
});
check("thumbnail drawer opens", drawer.open && drawer.expanded === "true", JSON.stringify(drawer));
check("thumbnails rendered for every page", drawer.thumbs === 10, `thumbs=${drawer.thumbs}`);
check("thumbnail images painted", drawer.painted > 4, `painted=${drawer.painted}`);
await page.screenshot({ path: `${SHOTS}/07-thumbnails.png` });
await page.keyboard.press("Escape");
await sleep(200);

// ---------------------------------------------------------------- contrast
const contrast = await page.evaluate(() => {
  const toRgb = (css) => css.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const counter = document.querySelector(".viewer .fp-counter");
  const bar = document.querySelector(".viewer .fp-bar");
  return {
    counter: ratio(toRgb(getComputedStyle(counter).color), toRgb(getComputedStyle(bar).backgroundColor)),
  };
});
check("counter contrast is AA", contrast.counter >= 4.5, `ratio=${contrast.counter.toFixed(2)}`);

// ------------------------------------------------------------------ widths
for (const width of [320, 390, 768]) {
  await page.setViewportSize({ width, height: 780 });
  await sleep(700);
  const probe = await page.evaluate(() => {
    const host = document.querySelector(".viewer [data-flip-pdf]");
    const book = host.flipbook;
    const bar = document.querySelector(".viewer .fp-bar");
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      mode: book.book.isSingle ? "single" : "double",
      barOverflow: bar.scrollWidth - bar.clientWidth,
      counterVisible: document.querySelector(".viewer .fp-counter").getBoundingClientRect().width > 0,
      tapTargets: [...document.querySelectorAll(".viewer .fp-btn")].map((b) => b.getBoundingClientRect().width),
    };
  });
  check(`no overflow at ${width}`, probe.overflow <= 0, `overflow=${probe.overflow}`);
  check(`toolbar fits at ${width}`, probe.barOverflow <= 0, `barOverflow=${probe.barOverflow}`);
  check(`counter visible at ${width}`, probe.counterVisible);
  check(
    `tap targets >= 32px at ${width}`,
    probe.tapTargets.every((w) => w >= 32),
    probe.tapTargets.map((v) => Math.round(v)).join(","),
  );
  check(`mode at ${width}`, width < 720 ? probe.mode === "single" : probe.mode === "double", probe.mode);
  await page.screenshot({ path: `${SHOTS}/08-${width}.png` });
}

check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

// --------------------------------------------------------- narrow containers
// A card in a column is not the demo's full-row viewer: the book has to live
// inside a box that is smaller than 360px tall and 240px wide.
const narrow = await page.evaluate(async () => {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;left:-4000px;top:0;width:300px;height:300px;overflow:hidden";
  const host = document.createElement("div");
  host.style.height = "100%";
  wrap.append(host);
  document.body.append(wrap);

  const { Flipbook } = window.FlipPdf;
  const book = new Flipbook(host, { workerSrc: "/dist/pdf.worker.min.mjs" });
  await book.load("/demo/sample.pdf");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(600);

  const read = () => {
    const fp = host.querySelector(".fp");
    const bar = host.querySelector(".fp-bar");
    const fr = fp.getBoundingClientRect();
    return {
      hostH: host.clientHeight,
      stageH: host.querySelector(".fp-stage").clientHeight,
      mode: book.book.mode,
      barOverflow: bar.scrollWidth - bar.clientWidth,
      clipped: [...bar.children].filter((k) => k.getBoundingClientRect().right > fr.right + 0.5).length,
      counter: host.querySelector(".fp-counter").getBoundingClientRect().width > 0,
    };
  };

  const at = [];
  at.push({ size: "300x300", ...read() });

  for (const [w, h] of [[240, 300], [200, 200]]) {
    wrap.style.width = `${w}px`;
    wrap.style.height = `${h}px`;
    await sleep(400);
    at.push({ size: `${w}x${h}`, ...read() });
  }

  wrap.style.height = "auto";
  host.style.height = "";
  await sleep(400);
  const fallback = host.clientHeight;

  book.destroy();
  wrap.remove();
  return { at, fallback };
});

check(
  "a 300px card gets a 300px viewer, not 360",
  narrow.at[0].hostH === 300,
  `hostH=${narrow.at[0].hostH}`,
);
check(
  "every narrow card keeps the toolbar inside the frame",
  narrow.at.every((r) => r.barOverflow <= 0 && r.clipped === 0),
  narrow.at.map((r) => `${r.size}: overflow=${r.barOverflow} clipped=${r.clipped}`).join(" | "),
);
check(
  "the toolbar drops the progress bar before the buttons",
  narrow.at[0].counter && !narrow.at[2].counter,
  narrow.at.map((r) => `${r.size}: counter=${r.counter}`).join(" | "),
);
check(
  "a narrow container switches to a single page",
  narrow.at.every((r) => r.mode === "single"),
  narrow.at.map((r) => r.mode).join(","),
);
check("a height-less container falls back to 240px", narrow.fallback === 240, `h=${narrow.fallback}`);

// ---------------------------------------------------------- thumbnail drawer
// A thumbnail must show the whole page. The image is sized from its intrinsic
// ratio, so "image taller than its box" means the box collapsed and the page is
// cropped, which is what a stretched grid row used to do in a short container.
const thumbs = await page.evaluate(async () => {
  const hosts = [document.querySelector(".viewer [data-flip-pdf]"), document.querySelector('[data-label="Sample PDF in a 240px card"]')];
  const out = [];
  for (const host of hosts) {
    host.querySelector(".fp-btn.fp-thumbs").click();
    // Thumbnails are painted three at a time; wait for the last one instead of
    // trusting a sleep, which is what made this check flaky on CI.
    for (let i = 0; i < 120; i++) {
      if (host.querySelectorAll(".fp-thumb-img img").length === host.querySelectorAll(".fp-thumb").length) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const box = host.querySelector(".fp-thumb-img");
    const img = box.querySelector("img");
    out.push({
      label: host.dataset.label || "viewer",
      tiles: host.querySelectorAll(".fp-thumb").length,
      painted: host.querySelectorAll(".fp-thumb-img img").length,
      box: Math.round(box.getBoundingClientRect().height),
      img: Math.round(img.getBoundingClientRect().height),
      overflow: (() => {
        const grid = host.querySelector(".fp-thumbs-grid");
        return grid.scrollWidth - grid.clientWidth;
      })(),
    });
    host.querySelector(".fp-btn.fp-thumbs").click();
  }
  return out;
});
for (const t of thumbs) {
  check(
    `thumbnails show the whole page in the ${t.label}`,
    t.box > 40 && t.img === t.box && t.painted === t.tiles && t.overflow <= 0,
    JSON.stringify(t),
  );
}

// ------------------------------------------------------- single-mode turn
await page.setViewportSize({ width: 390, height: 780 });
await sleep(500);
await page.evaluate(async () => {
  const book = document.querySelector(".viewer [data-flip-pdf]").flipbook;
  await book.goToSpread(0);
});
await sleep(400);
const single = await page.evaluate(async () => {
  const book = document.querySelector(".viewer [data-flip-pdf]").flipbook;
  const before = book.spread;
  await book.next();
  await new Promise((r) => setTimeout(r, 900));
  // Draw and read back in the same task: the context has no preserved
  // backbuffer, so a read outside the frame returns zeros.
  book._draw();
  const canvas = document.querySelector(".viewer .fp-canvas");
  const gl = book.renderer.gl;
  const px = new Uint8Array(4 * 64 * 64);
  gl.readPixels(
    Math.max(0, Math.floor(canvas.width / 2) - 32),
    Math.max(0, Math.floor(canvas.height / 2) - 32),
    64,
    64,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    px,
  );
  let lit = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] > 150 && px[i + 1] > 145) lit++;
  return {
    before,
    after: book.spread,
    single: book.book.isSingle,
    lit: lit / (px.length / 4),
    counter: document.querySelector(".viewer .fp-counter").textContent,
  };
});
check("single mode turns one page at a time", single.single && single.after === single.before + 1, JSON.stringify(single));
check("single mode draws paper at the centre", single.lit > 0.6, `lit=${single.lit.toFixed(2)}`);
await page.screenshot({ path: `${SHOTS}/09-single.png` });

// ------------------------------------------------------------ flick + a11y
await page.setViewportSize({ width: 1280, height: 900 });
await sleep(500);
const flick = await page.evaluate(async () => {
  const book = document.querySelector(".viewer [data-flip-pdf]").flipbook;
  await book.goToSpread(2);
  const stage = document.querySelector(".viewer .fp-stage");
  const box = stage.getBoundingClientRect();
  const y = box.top + box.height / 2;
  const down = (x) => stage.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 7, clientX: x, clientY: y, bubbles: true, button: 0, isPrimary: true }));
  const move = (x) => stage.dispatchEvent(new PointerEvent("pointermove", { pointerId: 7, clientX: x, clientY: y, bubbles: true, isPrimary: true }));
  const up = (x) => stage.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, clientX: x, clientY: y, bubbles: true, button: 0, isPrimary: true }));

  down(box.left + box.width * 0.72);
  // A fast, short flick: 90 px in four steps.
  for (let i = 1; i <= 4; i++) {
    move(box.left + box.width * 0.72 - i * 22);
    await new Promise((r) => setTimeout(r, 10));
  }
  const progress = book.turn ? book.turn.progress : null;
  up(box.left + box.width * 0.72 - 88);
  // Read the animation kind on the frame the release starts. Once the turn has
  // settled it is null either way, so a later read cannot tell a spring from a
  // fixed tween.
  const anim = book._anim?.kind ?? null;
  // Wait for the turn to land instead of guessing a duration: the spring
  // settles when it settles, and a slow CI frame can push that past any fixed
  // sleep. The race is a guard against a stuck animation, not a timer.
  await Promise.race([book._whenIdle(), new Promise((r) => setTimeout(r, 6000))]);
  return { progress, spread: book.spread, anim };
});
check("a short flick still commits", flick.spread === 3, JSON.stringify(flick));
check("release runs the spring", flick.anim === "spring", `anim=${flick.anim}`);

// A stalled main thread used to stretch a turn: the integrator advanced at most
// 50 ms per delivered frame, so a 200 ms frame moved the spring 50 ms. It has
// to advance by the time that actually passed.
const stall = await page.evaluate(() => {
  const book = document.querySelector(".viewer [data-flip-pdf]").flipbook;
  const saved = book.turn;
  book.turn = { progress: 0 };
  const anim = { kind: "spring", from: 0, to: 1, x: -1, v: 0, omega: 11, elapsed: 0, last: 1000 };
  book._stepSpring(anim, 1200); // one 200 ms frame
  book.turn = saved;
  return { x: Number(anim.x.toFixed(4)), elapsed: Number(anim.elapsed.toFixed(3)) };
});
check(
  "a stalled frame advances the spring by the time that passed",
  stall.elapsed >= 0.19 && Math.abs(stall.x) < 0.45,
  JSON.stringify(stall),
);

// ------------------------------------------------- no blank landing side
// A turn used to drop the sheet one frame before the commit while the static
// underlays still held the pre-turn pages, leaving the landing half empty.
// The assertion is fixture-independent: the landing half must be drawn (opaque)
// on every late frame, and must already show the page the reader is about to
// land on.
const landing = await page.evaluate(async () => {
  const book = document.querySelector(".viewer [data-flip-pdf]").flipbook;
  await book.goToSpread(0);
  await new Promise((r) => setTimeout(r, 350));

  const gl = book.renderer.gl;
  const canvas = book.renderer.canvas;
  const draw = book._draw.bind(book);
  const read = (f) => {
    const px = new Uint8Array(4);
    gl.readPixels(Math.floor(canvas.width * f), Math.floor(canvas.height * 0.5), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { v: px[0], a: px[3] };
  };

  const samples = [];
  book._draw = () => {
    draw();
    samples.push({ p: book.turn ? book.turn.progress : null, left: read(0.32) });
  };
  await book.next();
  await new Promise((r) => setTimeout(r, 1200));
  book._draw = draw;

  // What the landing half looks like once the turn has committed.
  draw();
  const settled = read(0.32);

  const late = samples.filter((s) => s.p !== null && s.p > 0.9);
  const gaps = late.filter((s) => s.left.a < 200).length;
  // Compare the last frame before the commit, not the worst of them: the sheet's
  // edge and its shadow sweep across the probe mid-animation, which is motion,
  // not a missing page. Only the final state has to match what lands.
  const last = late[late.length - 1];
  const drift = last ? Math.abs(last.left.v - settled.v) : 999;
  return { frames: samples.length, late: late.length, gaps, drift, settled: settled.v, lastP: last?.p ?? null };
});
check("turn never leaves the landing half blank", landing.late > 0 && landing.gaps === 0, JSON.stringify(landing));
check("the landing page is already in place before the commit", landing.drift <= 12, `drift=${landing.drift}`);

// ------------------------------------------------------------ error state
const errorState = await page.evaluate(async () => {
  const host = document.createElement("div");
  host.style.height = "320px";
  host.style.width = "480px";
  document.body.append(host);
  const { Flipbook } = window.FlipPdf;
  const book = new Flipbook(host, { workerSrc: "/dist/pdf.worker.min.mjs" });
  let thrown = null;
  try {
    await book.load("./does-not-exist.pdf");
  } catch (error) {
    thrown = String(error?.message || error);
  }
  const status = host.querySelector(".fp-status");
  const retry = host.querySelector(".fp-retry");
  const result = {
    thrown,
    visible: !status.hidden,
    state: status.dataset.state,
    message: status.textContent.trim().slice(0, 60),
    hasRetry: !!retry,
  };
  book.destroy();
  host.remove();
  return result;
});
check("a bad PDF reports an error instead of hanging", errorState.visible && errorState.state === "error", JSON.stringify(errorState));
check("the error state offers a retry", errorState.hasRetry);

await browser.close();

console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
