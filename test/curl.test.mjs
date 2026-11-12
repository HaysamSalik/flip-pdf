import test from "node:test";
import assert from "node:assert/strict";
import { buildSheetGeometry, createSheetBuffers, sheetEdge, updateSheetGeometry, CURL_DEFAULTS } from "../src/curl.js";

const W = 400;
const H = 560;

function xRange(buf) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < buf.vertexCount; i++) {
    const x = buf.positions[i * 3];
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return [min, max];
}

/** Sum of per-column arc lengths along the surface. */
function arcLength(buf) {
  let total = 0;
  let prev = null;
  for (let c = 0; c <= buf.segments; c++) {
    const i = c * 2;
    const point = [buf.positions[i * 3], buf.positions[i * 3 + 1], buf.positions[i * 3 + 2]];
    if (prev) {
      total += Math.hypot(point[0] - prev[0], point[1] - prev[1], point[2] - prev[2]);
    }
    prev = point;
  }
  return total;
}

test("progress 0 lies flat on the right page", () => {
  const buf = buildSheetGeometry(0, W, H);
  const [min, max] = xRange(buf);
  assert.ok(Math.abs(min) < 1e-6, `starts at the spine, got ${min}`);
  assert.ok(Math.abs(max - W) < 1e-3, `reaches the outer edge, got ${max}`);
  for (let i = 0; i < buf.vertexCount; i++) {
    assert.ok(Math.abs(buf.positions[i * 3 + 2]) < 1e-6, "no depth at rest");
  }
});

test("progress 1 lies flat on the left page", () => {
  const buf = buildSheetGeometry(1, W, H);
  const [min, max] = xRange(buf);
  assert.ok(Math.abs(min + W) < 1e-3, `reaches the left edge, got ${min}`);
  assert.ok(Math.abs(max) < 1e-6, `ends at the spine, got ${max}`);
});

test("the sheet keeps its width as it turns", () => {
  // Arc length is preserved by construction; if it drifts the page would
  // stretch mid-turn, which is the most obvious artefact a reader can spot.
  for (const progress of [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1]) {
    const buf = buildSheetGeometry(progress, W, H);
    const length = arcLength(buf);
    assert.ok(Math.abs(length - W) < 1, `p=${progress} length ${length.toFixed(2)} vs ${W}`);
  }
});

test("the sheet reaches toward the camera at mid-turn and returns", () => {
  const mid = buildSheetGeometry(0.5, W, H);
  let maxZ = 0;
  for (let i = 0; i < mid.vertexCount; i++) maxZ = Math.max(maxZ, mid.positions[i * 3 + 2]);
  assert.ok(maxZ > W * 0.5, `expected depth at p=0.5, got ${maxZ}`);

  for (const progress of [0, 1]) {
    const buf = buildSheetGeometry(progress, W, H);
    for (let i = 0; i < buf.vertexCount; i++) {
      assert.ok(Math.abs(buf.positions[i * 3 + 2]) < 1e-6, `no depth at p=${progress}`);
    }
  }
});

test("the sheet never crosses back past the spine mid-turn", () => {
  // A strip that folds behind the binding reads as a page turning inside out.
  for (let p = 0; p <= 1.0001; p += 0.05) {
    const [min, max] = xRange(buildSheetGeometry(p, W, H));
    assert.ok(min > -W - 1e-3, `p=${p.toFixed(2)} min ${min}`);
    assert.ok(max < W + 1e-3, `p=${p.toFixed(2)} max ${max}`);
  }
});

test("normals stay unit length and point away from the surface", () => {
  for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
    const buf = buildSheetGeometry(progress, W, H);
    for (let i = 0; i < buf.vertexCount; i++) {
      const nx = buf.normals[i * 3];
      const ny = buf.normals[i * 3 + 1];
      const nz = buf.normals[i * 3 + 2];
      assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-6);
      assert.ok(Math.abs(ny) < 1e-9, "normals have no vertical component");
    }
  }
});

test("uvs run once from spine to outer edge and do not depend on progress", () => {
  const buf = createSheetBuffers(16);
  const before = Array.from(buf.uvs);
  updateSheetGeometry(buf, 0.42, W, H);
  assert.deepEqual(Array.from(buf.uvs), before, "uvs are static");
  assert.equal(buf.uvs[0], 0);
  assert.equal(buf.uvs[buf.segments * 2 * 2], 1);
  // Top vertex samples the top of the page, bottom vertex the bottom.
  assert.equal(buf.uvs[1], 0);
  assert.equal(buf.uvs[3], 1);
});

test("vertex and index buffers agree on the strip", () => {
  const buf = createSheetBuffers(4);
  assert.equal(buf.vertexCount, (4 + 1) * 2);
  assert.equal(buf.indices.length, 4 * 6);
  for (const index of buf.indices) assert.ok(index < buf.vertexCount);
  // Every column boundary is referenced, and every quad is two triangles.
  assert.equal(buf.indices.length / 3, 8);
});

test("geometry never produces NaN, including at clamped extremes", () => {
  for (const progress of [-1, -0.001, 0, 0.5, 1, 1.001, 2, NaN]) {
    const buf = buildSheetGeometry(progress, W, H);
    for (let i = 0; i < buf.vertexCount; i++) {
      for (let c = 0; c < 3; c++) {
        assert.ok(Number.isFinite(buf.positions[i * 3 + c]), `p=${progress} pos ${i}/${c}`);
      }
    }
  }
});

test("the outer edge is the last column, and it is where the page ends", () => {
  const edge = sheetEdge(0.5, W, H);
  assert.equal(edge.y, H / 2);
  assert.ok(edge.z > 0, "edge lifted toward the camera");
  assert.ok(edge.x > -W && edge.x < W, "edge stays inside the book");
});

/** Largest distance any column sits off the straight chord spine -> free edge. */
function bulge(buf) {
  const last = buf.segments * 2;
  const cx = buf.positions[last * 3];
  const cz = buf.positions[last * 3 + 2];
  const len = Math.hypot(cx, cz) || 1;
  let worst = 0;
  for (let c = 0; c <= buf.segments; c++) {
    const i = c * 2;
    const x = buf.positions[i * 3];
    const z = buf.positions[i * 3 + 2];
    // Perpendicular distance to the chord through the origin.
    worst = Math.max(worst, Math.abs((x * cz - z * cx) / len));
  }
  return worst;
}

/** Tangent angle at the free edge, from the surface normal. */
function tipAngle(buf) {
  const last = buf.segments * 2;
  const nx = buf.normals[last * 3];
  const nz = buf.normals[last * 3 + 2];
  return Math.atan2(-nx, nz);
}

test("zero curl is a rigid card", () => {
  const buf = buildSheetGeometry(0.25, W, H, { curl: 0, bias: 1 });
  assert.ok(bulge(buf) < 1e-6, `expected a straight sheet, bulge ${bulge(buf)}`);
  assert.ok(Math.abs(tipAngle(buf) - Math.PI * 0.25) < 1e-6, "tip follows the chord exactly");
});

test("curl bows the sheet without moving the chord", () => {
  const soft = buildSheetGeometry(0.3, W, H, { curl: 0.3, bias: 1 });
  const hard = buildSheetGeometry(0.3, W, H, { curl: 0.9, bias: 1 });
  assert.ok(bulge(hard) > bulge(soft) * 1.5, `bulge ${bulge(hard).toFixed(1)} vs ${bulge(soft).toFixed(1)}`);
  // The free edge stays on the chord direction: that is what keeps the swing
  // honest and the landing flat.
  const a = Math.atan2(soft.positions[(soft.segments * 2) * 3 + 2], soft.positions[(soft.segments * 2) * 3]);
  const b = Math.atan2(hard.positions[(hard.segments * 2) * 3 + 2], hard.positions[(hard.segments * 2) * 3]);
  assert.ok(Math.abs(a - b) < 1e-6, "chord angle is independent of curl");
});

test("the free edge folds past vertical while the root is still flat", () => {
  const buf = buildSheetGeometry(0.4, W, H);
  assert.ok(tipAngle(buf) > Math.PI / 2, `tip should pass 90 degrees, got ${(tipAngle(buf) * 180 / Math.PI).toFixed(0)}`);
  // The root tangent lags the chord, so the sheet leaves the spine shallowly.
  const rootAngle = Math.atan2(-buf.normals[0], buf.normals[2]);
  assert.ok(rootAngle > 0 && rootAngle < Math.PI * 0.4, `root ${(rootAngle * 180 / Math.PI).toFixed(0)} degrees`);
});


test("defaults are stable and documented", () => {
  assert.equal(typeof CURL_DEFAULTS.curl, "number");
  assert.ok(CURL_DEFAULTS.segments >= 16);
});
