/**
 * Assemble a self-contained static site for deployment.
 *
 *   node tools/build-site.mjs
 *
 * Writes dist/site/: the demo page, the bundle and the sample document, with
 * every path relative to the site root. The module build is swapped for the
 * classic one so the host does not need an .mjs MIME mapping.
 */
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const out = "dist/site";
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

let html = await readFile("demo/index.html", "utf8");

html = html.replace(
  /<script type="module" src="\.\.\/dist\/flip-pdf\.mjs"><\/script>/,
  '<script src="./flip-pdf.js" defer></script>',
);
// The inline module that fills in the page count has to become a classic
// script too, since it relies on a global rather than an import.
html = html.replace(
  /<script type="module">([\s\S]*?)<\/script>/,
  (_match, body) => `<script>\n  addEventListener("load", () => {${body}});\n</script>`,
);
html = html.replace(/\.\.\/dist\//g, "./");
html = html.replace(/href="\.\.\/index\.html"/g, 'href="./"');

if (/\.\.\//.test(html)) {
  const leftover = html.match(/\.\.\/[^\s"')]+/g);
  throw new Error(`site build left relative escapes: ${leftover?.join(", ")}`);
}

await writeFile(path.join(out, "index.html"), html);
await copyFile("dist/flip-pdf.js", path.join(out, "flip-pdf.js"));
await copyFile("demo/sample.pdf", path.join(out, "sample.pdf"));
await writeFile(path.join(out, "robots.txt"), "User-agent: *\nAllow: /\n");

console.log(`site built in ${out}`);
