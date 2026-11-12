/**
 * Static server for the demo. Node only, no dependencies.
 *
 *   node tools/serve.mjs [port]
 *
 * A server is required: module scripts and fetch() of the PDF are both blocked
 * on file:// URLs, which is why opening demo/index.html directly does nothing.
 */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { extname, normalize, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.argv[2] || process.env.PORT || 8099);

/**
 * Only these directories are reachable. The server is meant to be exposed
 * through a tunnel to show the demo, and the project root also holds
 * node_modules, build tooling and local notes that have no business being on
 * the public internet.
 */
const PUBLIC_DIRS = ["demo", "dist"];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") {
    res.writeHead(302, { location: "/demo/" }).end();
    return;
  }
  if (pathname.endsWith("/")) pathname += "index.html";

  // Resolve inside the project root; refuse anything that escapes it.
  const target = resolve(root, "." + normalize(pathname));
  if (!target.startsWith(root + sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  const relative = target.slice(root.length + 1);
  const top = relative.split(sep)[0];
  if (!PUBLIC_DIRS.includes(top)) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }

  let info;
  try {
    info = await stat(target);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  if (info.isDirectory()) {
    res.writeHead(302, { location: `${url.pathname}/` }).end();
    return;
  }

  const type = TYPES[extname(target).toLowerCase()] || "application/octet-stream";
  const compressible = /^text\/|^application\/(json|javascript)|^image\/svg/.test(type);
  const acceptsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");

  // Compress text the way a production host would, so local timings and
  // transfer sizes are representative instead of several times too large.
  if (compressible && acceptsGzip && info.size > 1024) {
    const body = gzipSync(await readFile(target), { level: 6 });
    res.writeHead(200, {
      "content-type": type,
      "content-length": body.length,
      "content-encoding": "gzip",
      vary: "accept-encoding",
      "cache-control": "no-store",
    });
    res.end(body);
    return;
  }

  res.writeHead(200, {
    "content-type": type,
    "content-length": info.size,
    "cache-control": "no-store",
  });
  createReadStream(target).pipe(res);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Try: npm run serve -- 8100`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`flip-pdf demo: http://127.0.0.1:${port}/demo/`);
});
