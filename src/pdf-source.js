/**
 * Thin wrapper over PDF.js. It only rasterises; all layout and animation is
 * ours. Keeping this in one module means upgrading PDF.js never touches the
 * flipbook code.
 */
import { getDocument, GlobalWorkerOptions, VerbosityLevel } from "pdfjs-dist/build/pdf.mjs";
import workerSource from "#fp-worker";

let configured = false;
let blobUrl = null;

/**
 * The worker ships inside this file, so there is no path to configure and no
 * companion asset to copy. PDF.js always loads it as a module worker, which a
 * blob URL supports. Callers who prefer a real file (CSP, cache headers, or a
 * CDN) just pass `workerSrc` and this is never used.
 */
export function defaultWorkerSrc() {
  if (blobUrl) return blobUrl;
  if (typeof URL === "undefined" || typeof Blob === "undefined") return null;
  blobUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  return blobUrl;
}

export function configurePdfJs({ workerSrc, standardFontDataUrl, cMapUrl }) {
  const src = workerSrc || defaultWorkerSrc();
  if (src) GlobalWorkerOptions.workerSrc = src;
  if (standardFontDataUrl) GlobalWorkerOptions.standardFontDataUrl = standardFontDataUrl;
  if (cMapUrl) {
    GlobalWorkerOptions.cMapUrl = cMapUrl;
    GlobalWorkerOptions.cMapPacked = true;
  }
  configured = true;
}

export function isConfigured() {
  return configured;
}

/**
 * @param {string|URL|ArrayBuffer|Uint8Array} source
 * @param {object} options passed to PDF.js getDocument (password, httpHeaders, ...)
 */
export async function openDocument(source, options = {}) {
  const input =
    source instanceof URL
      ? source.href
      : typeof source === "string" || source instanceof ArrayBuffer || ArrayBuffer.isView(source)
        ? source
        : String(source);

  const task = getDocument({
    ...options,
    url: typeof input === "string" ? input : undefined,
    data: typeof input === "string" ? undefined : input,
    verbosity: VerbosityLevel.ERRORS,
    isEvalSupported: false,
  });

  const doc = await task.promise;
  return new PdfSource(doc);
}

export class PdfSource {
  constructor(doc) {
    this.doc = doc;
    this.numPages = doc.numPages;
    this._pages = new Map();
    this._firstPageSize = null;
  }

  async page(index) {
    const cached = this._pages.get(index);
    if (cached) return cached;
    const pending = this.doc.getPage(index + 1);
    this._pages.set(index, pending);
    try {
      const page = await pending;
      this._pages.set(index, page);
      return page;
    } catch (error) {
      this._pages.delete(index);
      throw error;
    }
  }

  /**
   * Page size in CSS pixels at scale 1, in PDF points. Returns the first
   * page's box, which is what the book is sized from.
   */
  async size(index = 0) {
    if (index === 0 && this._firstPageSize) return this._firstPageSize;
    const page = await this.page(index);
    const viewport = page.getViewport({ scale: 1 });
    const size = { width: viewport.width, height: viewport.height };
    if (index === 0) this._firstPageSize = size;
    return size;
  }

  /**
   * Rasterise one page into a canvas sized for `targetWidth` device pixels.
   * The canvas is always the full page box; pages of a different size are
   * letterboxed onto white so mixed-size documents do not stretch.
   */
  async render(index, targetWidth, { maxPixels = 4096, background = "#ffffff" } = {}) {
    const page = await this.page(index);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.max(0.05, targetWidth / base.width);
    const viewport = page.getViewport({ scale });

    const width = Math.max(1, Math.min(maxPixels, Math.round(viewport.width)));
    const height = Math.max(1, Math.min(maxPixels, Math.round(viewport.height)));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    await page.render({ canvas, canvasContext: ctx, viewport, intent: "display" }).promise;

    return { canvas, width, height, aspect: base.width / base.height, pageWidth: base.width };
  }

  async destroy() {
    this._pages.clear();
    await this.doc.destroy();
  }
}
