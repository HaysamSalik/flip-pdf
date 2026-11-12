/**
 * Sheet geometry for the page turn.
 *
 * The moving sheet is a strip across the page width. It bends into a circular
 * arc (curvature increasing toward the outer edge) and the whole strip rotates
 * about the spine. At progress 0 it lies flat on the right page, at 1 it lies
 * flat on the left showing its back. Everything is computed on the CPU: one
 * strip of ~48 quads, which is cheaper and far easier to test than a shader
 * that integrates curvature per vertex.
 *
 * Book space: origin at the spine, +x toward the right page, +y up, +z toward
 * the reader. Units are CSS pixels.
 */

const DEFAULTS = {
  segments: 56,
  /** How far the free edge runs ahead of the chord. 0 = rigid card, 1 = full fold. */
  curl: 0.7,
  /** Curvature distribution along the sheet. 1 = circular arc, higher = tip-heavy. */
  bias: 1,
};

export function createSheetBuffers(segments = DEFAULTS.segments) {
  const seg = Math.max(2, Math.floor(segments));
  const vertexCount = (seg + 1) * 2;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint16Array(seg * 6);

  for (let c = 0; c < seg; c++) {
    const top = c * 2;
    const bottom = c * 2 + 1;
    const nextTop = top + 2;
    const nextBottom = bottom + 2;
    const o = c * 6;
    indices[o] = top;
    indices[o + 1] = bottom;
    indices[o + 2] = nextTop;
    indices[o + 3] = nextTop;
    indices[o + 4] = bottom;
    indices[o + 5] = nextBottom;
  }

  // uvs depend only on the column index, so they are fixed for the lifetime of
  // the buffer: the renderer uploads them once and only rewrites positions.
  for (let c = 0; c <= seg; c++) {
    const u = c / seg;
    write2(uvs, c * 2, u, 0);
    write2(uvs, c * 2 + 1, u, 1);
  }

  return { segments: seg, vertexCount, positions, normals, uvs, indices };
}

/**
 * Fill `buf` for the given turn progress (0..1).
 *
 * A sheet of paper is pinned along the spine and driven at its free edge, so it
 * does not rotate rigidly: it bends into an arc. The chord from the spine to
 * the free edge sweeps 0 -> PI (that is what "progress" means), while the
 * tangent at the spine lags behind the chord and the tangent at the free edge
 * runs ahead of it. With `bow` = 1 the free edge is a full 2*phi ahead, so the
 * tip has already folded over while the root is still nearly flat, which is the
 * shape a real page takes.
 *
 * Both tangents are derived from the chord angle, so at progress 0 and 1 the
 * arc collapses to a straight sheet lying exactly on the page. That is the
 * property that lets the turn land without a jump.
 */
export function updateSheetGeometry(buf, progress, pageW, pageH, options = {}) {
  const seg = buf.segments;
  const curl = clamp01(options.curl ?? DEFAULTS.curl);
  const bias = options.bias ?? DEFAULTS.bias;
  const p = clamp01(progress);
  const phi = Math.PI * p;
  const dx = pageW / seg;

  // Bow vanishes at both ends, so the paper is flat when it starts and when it
  // lands. sin(PI p) peaks mid-turn where the sheet is most bent.
  const bow = curl * Math.sin(phi);
  const spread = 2 * phi * bow;
  const start = phi - spread / 2;

  // Pass 1: integrate the arc with its tangent running start -> start + spread.
  // Segment length is preserved, which is what makes the sheet foreshorten
  // instead of stretch.
  const xs = new Float64Array(seg + 1);
  const zs = new Float64Array(seg + 1);
  const thetas = new Float64Array(seg + 1);
  let x = 0;
  let z = 0;
  let prev = start;
  for (let c = 0; c <= seg; c++) {
    const theta = start + spread * Math.pow(c / seg, bias);
    if (c > 0) {
      const mid = (prev + theta) * 0.5;
      x += Math.cos(mid) * dx;
      z += Math.sin(mid) * dx;
    }
    xs[c] = x;
    zs[c] = z;
    thetas[c] = theta;
    prev = theta;
  }

  // Pass 2: rotate the whole arc so its chord sits exactly on phi. The chord of
  // a non-circular arc is not its mean tangent, so measuring it keeps the swing
  // honest for any curvature distribution.
  const fix = phi - Math.atan2(zs[seg], xs[seg]);
  const cosF = Math.cos(fix);
  const sinF = Math.sin(fix);

  for (let c = 0; c <= seg; c++) {
    const px = xs[c] * cosF - zs[c] * sinF;
    const pz = xs[c] * sinF + zs[c] * cosF;
    const angle = thetas[c] + fix;
    const nx = -Math.sin(angle);
    const nz = Math.cos(angle);

    const top = c * 2;
    const bottom = top + 1;

    write3(buf.positions, top, px, pageH * 0.5, pz);
    write3(buf.positions, bottom, px, -pageH * 0.5, pz);
    write3(buf.normals, top, nx, 0, nz);
    write3(buf.normals, bottom, nx, 0, nz);
  }

  return buf;
}

export function buildSheetGeometry(progress, pageW, pageH, options = {}) {
  const buf = createSheetBuffers(options.segments ?? DEFAULTS.segments);
  updateSheetGeometry(buf, progress, pageW, pageH, options);
  return buf;
}

/** Point on the sheet's outer edge, useful for tests and debugging. */
export function sheetEdge(progress, pageW, pageH, options = {}) {
  const buf = createSheetBuffers(options.segments ?? DEFAULTS.segments);
  updateSheetGeometry(buf, progress, pageW, pageH, options);
  const top = buf.segments * 2;
  return {
    x: buf.positions[top * 3],
    y: buf.positions[top * 3 + 1],
    z: buf.positions[top * 3 + 2],
    nx: buf.normals[top * 3],
    nz: buf.normals[top * 3 + 2],
  };
}

function write3(arr, i, x, y, z) {
  arr[i * 3] = x;
  arr[i * 3 + 1] = y;
  arr[i * 3 + 2] = z;
}

function write2(arr, i, x, y) {
  arr[i * 2] = x;
  arr[i * 2 + 1] = y;
}

function clamp01(v) {
  // A non-finite progress would poison every vertex, and one NaN position
  // breaks the whole draw call, not just the sheet. Treat it as "at rest".
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export const CURL_DEFAULTS = DEFAULTS;
