import * as esbuild from "esbuild";
import { copyFile, mkdir, rm, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const watch = process.argv.includes("--watch");
const outdir = "dist";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const WORKER = "node_modules/pdfjs-dist/build/pdf.worker.min.mjs";
const CSS = "src/styles.css";

/**
 * The two heavy assets are embedded as strings so the published file works with
 * no companion files and no path configuration:
 *   - the PDF.js worker becomes a blob URL at runtime,
 *   - the stylesheet is injected once, unless a link already provides it.
 * Both are also written to dist/ for people who would rather manage assets
 * themselves (CSP, cache headers).
 */
const embedAssets = {
  name: "embed-assets",
  setup(build) {
    build.onResolve({ filter: /^#fp-worker$/ }, () => ({ path: "worker", namespace: "embed" }));
    build.onResolve({ filter: /^#fp-css$/ }, () => ({ path: "css", namespace: "embed" }));
    build.onLoad({ filter: /.*/, namespace: "embed" }, async (args) => {
      const file = args.path === "worker" ? WORKER : CSS;
      const text = await readFile(file, "utf8");
      // A literal </script> inside a string breaks any page that inlines the
      // bundle, so it is split. Same for </style> in the stylesheet.
      const safe = text.replace(/<\/script/gi, "<\\/script").replace(/<\/style/gi, "<\\/style");
      return { contents: `export default ${JSON.stringify(safe)};`, loader: "js" };
    });
  },
};

const pkg = JSON.parse(await readFile("package.json", "utf8"));

// esbuild does not treat pdf.js's "@licstart" banner as a legal comment, so the
// attribution is written explicitly rather than relying on comment retention.
const BANNER = `/*! ${pkg.name} v${pkg.version} | ${pkg.license} | includes PDF.js (Apache-2.0): https://github.com/mozilla/pdf.js/blob/master/LICENSE */`;

const common = {
  bundle: true,
  minify: true,
  sourcemap: true,
  banner: { js: BANNER },
  target: ["es2020", "chrome90", "firefox90", "safari15"],
  legalComments: "eof",
  logLevel: "warning",
  plugins: [embedAssets],
};

const builds = [
  { entryPoints: ["src/index.js"], outfile: `${outdir}/flip-pdf.mjs`, format: "esm" },
  { entryPoints: ["src/index.js"], outfile: `${outdir}/flip-pdf.js`, format: "iife" },
];

if (watch) {
  const contexts = await Promise.all(
    builds.map((opts) => esbuild.context({ ...common, ...opts }).then((ctx) => (ctx.watch(), ctx))),
  );
  console.log("watching, open http://127.0.0.1:8099/demo/");
  process.on("SIGINT", async () => {
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
    process.exit(0);
  });
} else {
  await Promise.all(builds.map((opts) => esbuild.build({ ...common, ...opts })));

  // Optional companions, for callers who want their own asset pipeline.
  await copyFile(WORKER, `${outdir}/pdf.worker.min.mjs`);
  await esbuild.build({ ...common, plugins: [], entryPoints: [CSS], outfile: `${outdir}/flip-pdf.css`, minify: false });

  const gzip = async (file) => {
    const { gzipSync } = await import("node:zlib");
    return gzipSync(await readFile(file), { level: 9 }).length;
  };

  const files = [
    "flip-pdf.js",
    "flip-pdf.mjs",
    "flip-pdf.css",
    "pdf.worker.min.mjs",
  ];
  let total = 0;
  for (const file of files) {
    const full = path.join(outdir, file);
    const bytes = (await stat(full)).size;
    const gz = await gzip(full);
    total += gz;
    console.log(`${file.padEnd(22)} ${(bytes / 1024).toFixed(1).padStart(8)} kB  ${(gz / 1024).toFixed(0).padStart(5)} kB gzip`);
  }
  console.log(`${"total gzip".padEnd(22)} ${"".padStart(8)}     ${(total / 1024).toFixed(0).padStart(5)} kB`);

  // A self-contained build is only useful if it stays a sane size. If this
  // trips, something got bundled that should not have been.
  const bundle = (await stat(`${outdir}/flip-pdf.js`)).size;
  const bundleGz = await gzip(`${outdir}/flip-pdf.js`);
  if (bundleGz > 620 * 1024) throw new Error(`bundle budget exceeded: ${(bundleGz / 1024).toFixed(0)} kB gzip`);
  const cssGz = await gzip(`${outdir}/flip-pdf.css`);
  if (cssGz > 6 * 1024) throw new Error(`css budget exceeded: ${(cssGz / 1024).toFixed(0)} kB gzip`);
  console.log(`bundle: ${(bundle / 1024).toFixed(0)} kB raw, ${(bundleGz / 1024).toFixed(0)} kB gzip (budget 620 kB)`);

  await writeFile(`${outdir}/.built`, new Date().toISOString());
}
