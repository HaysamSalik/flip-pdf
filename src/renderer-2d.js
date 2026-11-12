/**
 * Canvas2D fallback. Same geometry as the WebGL path, projected per strip:
 * each vertical slice of the sheet is drawn with its own perspective scale and
 * light level, which is enough to read as a turning page without a GPU.
 */
import { createSheetBuffers, updateSheetGeometry } from "./curl.js";
import { clamp } from "./gl.js";

export class Canvas2DRenderer {
  static isSupported() {
    try {
      return !!document.createElement("canvas").getContext("2d");
    } catch {
      return false;
    }
  }

  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });
    if (!this.ctx) throw new Error("Canvas 2D is not available");
    this.fit = options.fit ?? 0.9;
    this.curl = options.curl ?? 0.7;
    this.light = options.light ?? [-0.42, 0.55, 0.72];
    this.pageW = 1000;
    this.pageH = 1414;
    this.cols = 2;
    this.viewport = { width: 1, height: 1, dpr: 1 };
    this.cache = null;
    this.sheet = createSheetBuffers(28);
    this.destroyed = false;
    this.scratch = document.createElement("canvas");
  }

  setCache(cache) {
    this.cache = cache;
  }

  setLayout({ pageW, pageH, cols, fitWidth, centerX, curl }) {
    this.pageW = pageW;
    this.pageH = pageH;
    this.cols = cols;
    this.fitWidth = fitWidth ?? pageW * cols;
    this.centerX = centerX ?? 0;
    if (curl !== undefined) this.curl = curl;
  }

  setViewport(width, height, dpr) {
    this.viewport = { width, height, dpr };
    const pw = Math.max(1, Math.round(width * dpr));
    const ph = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
  }

  resize(width, height, dpr) {
    this.setViewport(width, height, dpr);
  }

  _scale() {
    const { width, height } = this.viewport;
    const bookW = this.fitWidth ?? this.pageW * this.cols;
    const bookH = this.pageH;
    const fit = clamp(this.fit, 0.3, 1);
    return Math.min((width * fit) / bookW, (height * fit) / bookH);
  }

  _entry(index) {
    if (index === null || index === undefined) return null;
    return this.cache?.getFresh(index) ?? this.cache?.get(index) ?? null;
  }

  draw(scene) {
    if (this.destroyed) return;
    const { ctx } = this;
    const { width, height, dpr } = this.viewport;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const turn = scene.turn;
    const progress = turn ? clamp(turn.progress, 0, 1) : 0;
    const scale = this._scale();
    if (scene.centerX !== undefined) this.centerX = scene.centerX;
    const cx = width / 2 - (this.centerX ?? 0) * scale;
    const cy = height / 2;
    const shadow = turn ? Math.sin(Math.PI * progress) * 0.85 : 0;

    const left = turn ? turn.left : scene.spreadPages[0];
    const right = turn ? turn.right : scene.spreadPages[1];

    this._drawShadow(ctx, left, right, cx, cy, scale);
    this._drawPage(ctx, left, -1, cx, cy, scale, shadow);
    this._drawPage(ctx, right, 1, cx, cy, scale, shadow);

    if (turn) {
      this._drawSheet(ctx, turn, progress, cx, cy, scale);
    }
  }

  _drawShadow(ctx, left, right, cx, cy, scale) {
    const hasLeft = left !== null && left !== undefined;
    const hasRight = right !== null && right !== undefined;
    if (!hasLeft && !hasRight) return;
    const x0 = hasLeft ? -this.pageW : 0;
    const x1 = hasRight ? this.pageW : 0;
    const width = (x1 - x0) * scale;
    const height = this.pageH * scale * 1.06;
    ctx.save();
    ctx.shadowColor = "rgba(28,25,23,0.34)";
    ctx.shadowBlur = Math.max(10, 14 * scale);
    ctx.shadowOffsetY = Math.max(2, 6 * scale);
    ctx.fillStyle = "rgba(0,0,0,0.02)";
    ctx.fillRect(cx + (x0 + x1) * scale / 2 - width / 2, cy - height / 2, width, height);
    ctx.restore();
  }

  _drawPage(ctx, index, side, cx, cy, scale, shadow) {
    const entry = this._entry(index);
    const w = this.pageW * scale;
    const h = this.pageH * scale;
    const x = cx + (side < 0 ? -this.pageW / 2 : this.pageW / 2) * scale - w / 2;
    const y = cy - h / 2;

    if (!entry) {
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillRect(x, y, w, h);
      return;
    }
    ctx.drawImage(entry.canvas, x, y, w, h);

    // Spine crease and the shadow of the lifting sheet.
    const spineX = side < 0 ? cx : cx;
    const grad = ctx.createLinearGradient(spineX, 0, spineX + side * w, 0);
    grad.addColorStop(0, `rgba(28,25,23,${0.16 + shadow * 0.16})`);
    grad.addColorStop(0.09, "rgba(28,25,23,0.05)");
    grad.addColorStop(0.34, `rgba(28,25,23,${0.05 * shadow})`);
    grad.addColorStop(0.9, "rgba(28,25,23,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
  }

  _drawSheet(ctx, turn, progress, cx, cy, scale) {
    const buf = this.sheet;
    updateSheetGeometry(buf, progress, this.pageW, this.pageH, {
      curl: this.curl ?? 0.8,
      bias: this.bias ?? 1.15,
    });

    const distance = this.pageW * 4.2;
    const light = normalize(this.light);
    const seg = buf.segments;

    const frontEntry = this._entry(turn.sheet.front);
    const backEntry = this._entry(turn.sheet.back);

    for (let c = 0; c < seg; c++) {
      const i0 = c * 2;
      const i1 = (c + 1) * 2;
      const x0 = buf.positions[i0 * 3];
      const z0 = buf.positions[i0 * 3 + 2];
      const x1 = buf.positions[i1 * 3];
      const z1 = buf.positions[i1 * 3 + 2];

      const f0 = distance / (distance - z0);
      const f1 = distance / (distance - z1);
      const sx0 = cx + x0 * scale * f0;
      const sx1 = cx + x1 * scale * f1;
      const halfH0 = (this.pageH * scale * f0) / 2;
      const halfH1 = (this.pageH * scale * f1) / 2;

      const nx = buf.normals[i0 * 3];
      const nz = buf.normals[i0 * 3 + 2];
      const rel = (nx * light[0] + nz * light[2]) / light[2];
      const shade = 0.42 + 0.58 * Math.max(rel, 0);

      // The sheet shows its front while the front normal faces the camera.
      const showBack = nx * 0 + nz < 0;
      const entry = showBack ? backEntry : frontEntry;
      const u0 = c / seg;
      const u1 = (c + 1) / seg;
      const srcU = showBack ? 1 - u0 : u0;
      const srcU2 = showBack ? 1 - u1 : u1;

      if (entry) {
        const sxMin = Math.min(sx0, sx1);
        const sxMax = Math.max(sx0, sx1);
        const width = Math.max(1.2, sxMax - sxMin);
        const topLeft = cy - Math.max(halfH0, halfH1);
        const height = Math.max(halfH0, halfH1) * 2;
        const su = Math.min(srcU, srcU2) * entry.canvas.width;
        const sw = Math.abs(srcU2 - srcU) * entry.canvas.width;
        ctx.drawImage(entry.canvas, su, 0, Math.max(1, sw), entry.canvas.height, sxMin, topLeft, width, height);
        if (shade < 0.999) {
          ctx.fillStyle = `rgba(28,25,23,${(1 - shade) * 0.85})`;
          ctx.fillRect(sxMin, topLeft, width, height);
        }
      }
    }

    // Crease line where the sheet leaves the spine.
    ctx.fillStyle = `rgba(28,25,23,${0.18 * Math.sin(Math.PI * progress)})`;
    ctx.fillRect(cx - 1, cy - (this.pageH * scale) / 2, 2, this.pageH * scale);
  }

  destroy() {
    this.destroyed = true;
  }
}

function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
