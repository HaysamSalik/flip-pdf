/**
 * Render the sheet at fixed turn progress values and save the stage.
 * Deterministic frames are the only honest way to judge the curl.
 *
 *   node tools/frames.mjs [spread] [width]
 */
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const BASE = process.env.FP_BASE || "http://127.0.0.1:8099";
const OUT = process.env.FP_SHOTS || "/tmp/opencode/frames";
const spread = Number(process.argv[2] ?? 1);
const width = Number(process.argv[3] ?? 1280);
const STEPS = [0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.FP_CHROME || "/usr/bin/google-chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(`${BASE}/demo/`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelector("[data-flip-pdf]")?.flipbook?.ready, null, { timeout: 20000 });

await page.evaluate(async (s) => {
  const book = document.querySelector("[data-flip-pdf]").flipbook;
  book.spread = s;
  book._sync();
  await Promise.all(book.book.spreadPages(s).filter((p) => p !== null).map((p) => book.cache.ensure(p)));
  book._prefetch();
  await new Promise((r) => setTimeout(r, 400));
  book._dirty = true;
  book._draw();
}, spread);

const stage = await page.locator(".fp-stage").boundingBox();
await page.screenshot({ path: `${OUT}/p-0.00.png`, clip: stage });

for (const p of STEPS) {
  await page.evaluate(async ({ p, s }) => {
    const book = document.querySelector("[data-flip-pdf]").flipbook;
    const spec = book.book.turn(s, 1);
    book.turn = { ...spec, progress: p, p0: 0, p1: 1 };
    await Promise.all([spec.sheet.front, spec.sheet.back].filter((x) => x !== null).map((x) => book.cache.ensure(x)));
    await new Promise((r) => setTimeout(r, 60));
    book._draw();
    book.renderer.gl?.finish?.();
  }, { p, s: spread });
  await page.screenshot({ path: `${OUT}/p-${p.toFixed(2)}.png`, clip: stage });
}

if (errors.length) console.log("errors:", errors.slice(0, 4));
console.log(`frames written to ${OUT}`);
await browser.close();
