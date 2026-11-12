/**
 * WebGL renderer. Two flat page quads plus one curved sheet drawn twice (front
 * and back face). The camera looks straight down -z and dollies back slightly
 * while a sheet is in the air so the swinging edge stays inside the frame.
 */
import { straightCamera, translation, multiply, clamp } from "./gl.js";
import { createSheetBuffers, updateSheetGeometry } from "./curl.js";

const VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform mat4 uProj;
uniform vec3 uScale;
uniform vec3 uOffset;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 world = aPos * uScale + uOffset;
  vW = world;
  vN = aNormal;
  vUv = aUv;
  gl_Position = uProj * vec4(world, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
uniform sampler2D uTex;
uniform vec3 uLight;
uniform float uMirror;
uniform float uNormalSign;
uniform float uFlat;
uniform float uPageW;
uniform float uShadow;
uniform vec3 uTint;
uniform float uMode;
uniform float uShadowAlpha;
uniform float uSide;
uniform float uShadowSide;
uniform vec2 uSpan;
uniform float uEdge;

void main() {
  if (uEdge > 0.5) {
    // The cut edge of a leaf is bare paper whatever is printed on it.
    gl_FragColor = vec4(vec3(0.972, 0.964, 0.948), 1.0);
    return;
  }
  if (uMode > 0.5) {
    vec4 s = texture2D(uTex, vUv);
    gl_FragColor = vec4(s.rgb, s.a * uShadowAlpha);
    return;
  }

  vec2 uv = vec2(mix(vUv.x, 1.0 - vUv.x, uMirror), vUv.y);
  vec3 color = texture2D(uTex, uv).rgb * uTint;
  vec3 n = normalize(vN) * uNormalSign;

  // Relative to a face-on page, so a flat page renders at exactly 1.0 and
  // only surfaces that turn away from the light lose brightness.
  float rel = dot(n, uLight) / uLight.z;
  // Half-Lambert: paper is bright at every angle, it only loses a little as it
  // turns away. A hard N-dot-L crushes the back of a turning page to grey.
  float shade = 0.66 + 0.34 * clamp(0.5 + 0.5 * rel, 0.0, 1.0);

  if (uFlat > 0.5) {
    float d = vW.x * uSide;
    // Crease darkening where every sheet is bound.
    shade *= mix(0.87, 1.0, smoothstep(0.0, uPageW * 0.08, d));
    // Shadow of the sheet in the air: full under the sheet, decaying over a
    // short distance beyond its outer edge.
    float b = max(uSpan.x, uSpan.y) * uSide;
    float edge = max(0.0, d - b);
    // Only the half of the book the sheet is actually over can be in its
    // shadow; otherwise a page that has just been revealed dims for no reason.
    float on = max(0.0, uSide * uShadowSide);
    float band = exp(-pow(edge / (uPageW * 0.20), 1.5)) * smoothstep(0.0, uPageW * 0.02, d) * on;
    shade *= 1.0 - uShadow * band * 0.46;
  } else {
    // Curvature cue: paper darkens toward the bound edge and where the strip
    // bends away, which is what separates a curved sheet from a flat card.
    shade *= mix(0.86, 1.0, smoothstep(0.0, uPageW * 0.26, abs(vW.x)));
    shade *= 1.0 - 0.04 * uShadow;
  }

  gl_FragColor = vec4(color * shade, 1.0);
}`;

const MAX_TEXTURES = 24;

export class WebGLRenderer {
  static isSupported() {
    try {
      const probe = document.createElement("canvas");
      return !!(probe.getContext("webgl2") || probe.getContext("webgl"));
    } catch {
      return false;
    }
  }

  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.light = options.light ?? [-0.42, 0.55, 0.72];
    this.fit = options.fit ?? 0.9;
    this.dolly = options.dolly ?? 0.34;
    this.maxTexture = options.maxTexture ?? 2048;
    this.curl = options.curl ?? 0.7;

    this.pageW = 1000;
    this.pageH = 1414;
    this.cols = 2;
    this.fitWidth = 2000;
    this.centerX = 0;
    this.viewport = { width: 1, height: 1, dpr: 1 };

    this.textures = new Map();
    this.cache = null;
    this.destroyed = false;

    this.gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: !!options.preserveDrawingBuffer,
      powerPreference: "high-performance",
    });
    this.isWebGL2 = !!this.gl;
    if (!this.gl) {
      this.gl = canvas.getContext("webgl", {
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: !!options.preserveDrawingBuffer,
      });
    }
    if (!this.gl) throw new Error("WebGL is not available");

    this._initProgram();
    this._initGeometry();
    this._initPlaceholder();
    this._initShadowTexture();

    this._onLost = (event) => {
      event.preventDefault();
      this.contextLost = true;
    };
    this._onRestored = () => {
      this.contextLost = false;
      this.textures.clear();
      this._initProgram();
      this._initGeometry();
      this._initPlaceholder();
      this._initShadowTexture();
    };
    canvas.addEventListener("webglcontextlost", this._onLost);
    canvas.addEventListener("webglcontextrestored", this._onRestored);
  }

  _initProgram() {
    const gl = this.gl;
    const compile = (type, src) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader compile failed: ${log}`);
      }
      return shader;
    };

    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;
    this.attrib = {
      pos: gl.getAttribLocation(program, "aPos"),
      normal: gl.getAttribLocation(program, "aNormal"),
      uv: gl.getAttribLocation(program, "aUv"),
    };
    this.uniform = {};
    for (const name of [
      "uProj", "uScale", "uOffset", "uTex", "uLight", "uMirror",
      "uNormalSign", "uFlat", "uPageW", "uShadow", "uTint", "uMode", "uShadowAlpha",
      "uSide", "uShadowSide", "uSpan", "uEdge",
    ]) {
      this.uniform[name] = gl.getUniformLocation(program, name);
    }

    this.aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    this.anisoMax = this.aniso ? gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
  }

  _initGeometry() {
    const gl = this.gl;

    // Unit quad, centred, uv with (0,0) at the top-left of the page image.
    const quad = new Float32Array([
      -0.5, -0.5, 0, 0, 0, 1, 0, 1,
      0.5, -0.5, 0, 0, 0, 1, 1, 1,
      0.5, 0.5, 0, 0, 0, 1, 1, 0,
      -0.5, 0.5, 0, 0, 0, 1, 0, 0,
    ]);
    this.quadCount = 6;
    this.quad = this._uploadQuad(quad, new Uint16Array([0, 1, 2, 0, 2, 3]));

    this.sheet = createSheetBuffers(56);
    this.sheetUpload = this._uploadSheet(this.sheet);

    // Four vertices along the free edge, extruded by a hair so the leaf has a
    // visible cut edge instead of being an infinitely thin surface.
    this.edgeCount = 6;
    this.edgeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 8 * 4, gl.DYNAMIC_DRAW);
    this.edgeIndex = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.edgeIndex);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  }

  _uploadQuad(data, indices) {
    const gl = this.gl;
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    return { vbo, ibo, count: indices.length, stride: 8 * 4 };
  }

  _uploadSheet(buf) {
    const gl = this.gl;
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, buf.positions.byteLength, gl.DYNAMIC_DRAW);
    const nbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
    gl.bufferData(gl.ARRAY_BUFFER, buf.normals.byteLength, gl.DYNAMIC_DRAW);
    const ubo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ubo);
    gl.bufferData(gl.ARRAY_BUFFER, buf.uvs, gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, buf.indices, gl.STATIC_DRAW);
    return { vbo, nbo, ubo, ibo, count: buf.indices.length };
  }

  _initPlaceholder() {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.placeholder = tex;
  }

  /**
   * Alpha mask for the soft shadow the book casts on the stage. Squircle
   * falloff so the shadow follows the book's rectangular silhouette instead of
   * reading as a circle, and reaches zero at the quad edge so no hard line is
   * visible.
   */
  _initShadowTexture() {
    const gl = this.gl;
    const size = 128;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = ((x + 0.5) / size) * 2 - 1;
        const v = ((y + 0.5) / size) * 2 - 1;
        const d = Math.pow(Math.pow(Math.abs(u), 4) + Math.pow(Math.abs(v), 4), 0.25);
        // Densest just outside the page edge and gone well before the quad
        // ends, so the shadow never reads as a plate the book sits on.
        const a = Math.pow(1 - smoothstep(0.62, 1.0, d), 1.6);
        const i = (y * size + x) * 4;
        data[i] = 30;
        data[i + 1] = 25;
        data[i + 2] = 21;
        data[i + 3] = Math.round(a * 255);
      }
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.shadowTexture = tex;
  }

  setCache(cache) {
    this.cache = cache;
    cache.onEvict = (entry) => this._dropTexture(entry.index);
    cache.on((event) => {
      if (event.type === "load") this._markDirty();
    });
  }

  _markDirty() {
    this.dirty = true;
  }

  /** Page size in CSS px, the width the camera must cover, and its centre. */
  setLayout({ pageW, pageH, cols, fitWidth, centerX, curl }) {
    const nextFit = fitWidth ?? pageW * cols;
    const nextCenter = centerX ?? 0;
    if (curl !== undefined) this.curl = curl;
    if (pageW === this.pageW && pageH === this.pageH && cols === this.cols && nextFit === this.fitWidth && nextCenter === this.centerX) {
      return;
    }
    this.pageW = pageW;
    this.pageH = pageH;
    this.cols = cols;
    this.fitWidth = nextFit;
    this.centerX = nextCenter;
    this._markDirty();
  }

  setViewport(width, height, dpr) {
    const pixelW = Math.max(1, Math.round(width * dpr));
    const pixelH = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== pixelW || this.canvas.height !== pixelH) {
      this.canvas.width = pixelW;
      this.canvas.height = pixelH;
      this._markDirty();
    }
    this.viewport = { width, height, dpr };
  }

  resize(width, height, dpr) {
    this.setViewport(width, height, dpr);
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this._markDirty();
  }

  _textureFor(index) {
    if (index === null || index === undefined) return null;
    const entry = this.cache?.getFresh(index) ?? this.cache?.get(index);
    const cached = this.textures.get(index);
    // Re-upload when the bitmap was replaced (a resize produced a bigger one).
    if (cached && (!entry || cached.entry === entry)) return cached;
    if (!entry) return cached ?? null;

    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const mip = this.isWebGL2;
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    if (this.aniso) {
      gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, this.anisoMax));
    }

    const record = { texture: tex, entry };
    this.textures.set(index, record);
    if (this.textures.size > MAX_TEXTURES) {
      const oldest = this.textures.keys().next().value;
      if (oldest !== index) this._dropTexture(oldest);
    }
    return record;
  }

  _dropTexture(index) {
    const record = this.textures.get(index);
    if (!record) return;
    this.gl.deleteTexture(record.texture);
    this.textures.delete(index);
    this._markDirty();
  }

  /** Camera that maps the flat book to `fit` of the viewport. */
  _camera(progress) {
    const { width, height } = this.viewport;
    const bookW = this.fitWidth ?? this.pageW * this.cols;
    const bookH = this.pageH;
    const aspect = Math.max(0.2, width / Math.max(1, height));
    const fit = clamp(this.fit, 0.3, 1);

    const needHalfH = bookH / (2 * fit);
    const needHalfW = bookW / (2 * fit);
    const halfH = Math.max(needHalfH, needHalfW / aspect);

    const air = Math.sin(Math.PI * clamp(progress, 0, 1));
    const distance = this.pageW * 5.2 * (1 + this.dolly * air);
    const fovY = 2 * Math.atan(halfH / distance);
    const proj = straightCamera(distance, fovY, aspect, 1, distance * 6);
    // Shift so the book's centre of interest sits at the middle of the stage.
    const shift = translation(-(this.centerX ?? 0), 0, 0);
    return { view: multiply(proj, shift), distance };
  }

  draw(scene) {
    if (this.destroyed) return;
    const gl = this.gl;
    if (this.contextLost) return;

    const { width, height, dpr } = this.viewport;
    if (this.canvas.width !== Math.max(1, Math.round(width * dpr)) || this.canvas.height !== Math.max(1, Math.round(height * dpr))) {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);

    const turn = scene.turn;
    const progress = turn ? turn.progress : 0;
    if (scene.centerX !== undefined) this.centerX = scene.centerX;
    const { view } = this._camera(progress);

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniform.uProj, false, view);
    gl.uniform3fv(this.uniform.uLight, normalize(this.light));

    // Draw the sheet whenever a turn exists, including flat at progress 0 and
    // 1. Hiding it there leaves a hole: the static underlays still hold the
    // pre-turn pages, so the landing page would vanish for the frames between
    // the cutoff and the commit.
    const inAir = !!turn;
    if (inAir) this._updateSheet(progress);
    const span = inAir ? this._span : [0, 0];

    const shadow = turn ? Math.sin(Math.PI * clamp(progress, 0, 1)) * 0.85 : 0;
    gl.uniform1f(this.uniform.uShadow, shadow);
    gl.uniform1f(this.uniform.uPageW, this.pageW);
    gl.uniform2f(this.uniform.uSpan, span[0], span[1]);
    gl.uniform1f(this.uniform.uShadowSide, inAir ? this._shadowSide : 1);
    gl.uniform1f(this.uniform.uSide, 1);

    const left = turn ? turn.left : scene.spreadPages[0];
    const right = turn ? turn.right : scene.spreadPages[1];

    this._drawBookShadow(left, right);
    this._drawPage(left, -1, shadow);
    this._drawPage(right, 1, shadow);

    if (inAir) this._drawSheet(turn);

    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    this.dirty = false;
  }

  _drawBookShadow(left, right) {
    const hasLeft = left !== null && left !== undefined;
    const hasRight = right !== null && right !== undefined;
    if (!hasLeft && !hasRight) return;
    const gl = this.gl;

    const x0 = hasLeft ? -this.pageW : 0;
    const x1 = hasRight ? this.pageW : 0;
    const width = x1 - x0;
    if (width <= 0) return;

    this._bindQuad();
    gl.uniform3f(this.uniform.uScale, width * 1.16, this.pageH * 1.12, 1);
    gl.uniform3f(this.uniform.uOffset, (x0 + x1) / 2, -this.pageH * 0.028, -4);
    gl.uniform1f(this.uniform.uMode, 1);
    gl.uniform1f(this.uniform.uShadowAlpha, 0.55);
    gl.uniform1f(this.uniform.uMirror, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
    gl.uniform1i(this.uniform.uTex, 0);
    gl.drawElements(gl.TRIANGLES, this.quad.count, gl.UNSIGNED_SHORT, 0);
    gl.uniform1f(this.uniform.uMode, 0);
  }

  _drawPage(index, side, shadow) {
    if (index === null || index === undefined) return;
    const gl = this.gl;
    const record = this._textureFor(index);
    gl.bindVertexArray?.(null);

    this._bindQuad();
    gl.uniform3f(this.uniform.uScale, this.pageW, this.pageH, 1);
    gl.uniform3f(this.uniform.uOffset, side < 0 ? -this.pageW / 2 : this.pageW / 2, 0, 0);
    gl.uniform1f(this.uniform.uMirror, 0);
    gl.uniform1f(this.uniform.uNormalSign, 1);
    gl.uniform1f(this.uniform.uFlat, 1);
    gl.uniform1f(this.uniform.uSide, side);
    gl.uniform3f(this.uniform.uTint, 1, 1, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, record ? record.texture : this.placeholder);
    gl.uniform1i(this.uniform.uTex, 0);
    gl.drawElements(gl.TRIANGLES, this.quad.count, gl.UNSIGNED_SHORT, 0);
  }

  _bindQuad() {
    const gl = this.gl;
    const { vbo, ibo, stride } = this.quad;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(this.attrib.pos);
    gl.vertexAttribPointer(this.attrib.pos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.attrib.normal);
    gl.vertexAttribPointer(this.attrib.normal, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(this.attrib.uv);
    gl.vertexAttribPointer(this.attrib.uv, 2, gl.FLOAT, false, stride, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  }

  _updateSheet(progress) {
    updateSheetGeometry(this.sheet, progress, this.pageW, this.pageH, {
      curl: this.curl ?? 0.8,
      bias: this.bias ?? 1.15,
    });

    const gl = this.gl;
    const upload = this.sheetUpload;
    gl.bindBuffer(gl.ARRAY_BUFFER, upload.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.sheet.positions);
    gl.bindBuffer(gl.ARRAY_BUFFER, upload.nbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.sheet.normals);

    this._updateEdge();

    // Horizontal footprint. The page below is darkened under it and for a
    // short distance beyond it, which is what tells the eye the sheet is in
    // the air instead of lying flat.
    const pos = this.sheet.positions;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < this.sheet.vertexCount; i++) {
      const x = pos[i * 3];
      if (x < min) min = x;
      if (x > max) max = x;
    }
    this._span = [min, max];
    this._shadowSide = max + min >= 0 ? 1 : -1;
  }

  /** Ribbon along the free edge: four vertices straddling the surface. */
  _updateEdge() {
    const seg = this.sheet.segments;
    const top = seg * 2;
    const bottom = top + 1;
    const pos = this.sheet.positions;
    const nrm = this.sheet.normals;
    const x = pos[top * 3];
    const yTop = pos[top * 3 + 1];
    const yBottom = pos[bottom * 3 + 1];
    const z = pos[top * 3 + 2];
    const nx = nrm[top * 3];
    const nz = nrm[top * 3 + 2];
    const t = Math.max(0.9, this.pageW * 0.004);

    const data = new Float32Array(4 * 8);
    const put = (i, px, py, pz) => {
      const o = i * 8;
      data[o] = px;
      data[o + 1] = py;
      data[o + 2] = pz;
      data[o + 4] = 1;
    };
    put(0, x + nx * t, yTop, z + nz * t);
    put(1, x + nx * t, yBottom, z + nz * t);
    put(2, x - nx * t, yBottom, z - nz * t);
    put(3, x - nx * t, yTop, z - nz * t);

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
  }

  _drawEdge() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    gl.enableVertexAttribArray(this.attrib.pos);
    gl.vertexAttribPointer(this.attrib.pos, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(this.attrib.normal);
    gl.vertexAttribPointer(this.attrib.normal, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(this.attrib.uv);
    gl.vertexAttribPointer(this.attrib.uv, 2, gl.FLOAT, false, 32, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.edgeIndex);

    gl.disable(gl.CULL_FACE);
    gl.uniform1f(this.uniform.uEdge, 1);
    gl.uniform3f(this.uniform.uScale, 1, 1, 1);
    gl.uniform3f(this.uniform.uOffset, 0, 0, 0);
    gl.drawElements(gl.TRIANGLES, this.edgeCount, gl.UNSIGNED_SHORT, 0);
    gl.uniform1f(this.uniform.uEdge, 0);
    gl.enable(gl.CULL_FACE);
  }

  _drawSheet(turn) {
    const gl = this.gl;
    const { front, back } = turn.sheet;
    const upload = this.sheetUpload;

    const bindSheet = () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, upload.vbo);
      gl.enableVertexAttribArray(this.attrib.pos);
      gl.vertexAttribPointer(this.attrib.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, upload.nbo);
      gl.enableVertexAttribArray(this.attrib.normal);
      gl.vertexAttribPointer(this.attrib.normal, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, upload.ubo);
      gl.enableVertexAttribArray(this.attrib.uv);
      gl.vertexAttribPointer(this.attrib.uv, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, upload.ibo);
    };

    gl.uniform3f(this.uniform.uScale, 1, 1, 1);
    gl.uniform3f(this.uniform.uOffset, 0, 0, 0.35);
    gl.uniform1f(this.uniform.uFlat, 0);
    gl.uniform1f(this.uniform.uSide, 1);
    gl.uniform1f(this.uniform.uPageW, this.pageW);
    gl.uniform3f(this.uniform.uTint, 1, 1, 1);
    gl.uniform1i(this.uniform.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);

    // Front face: page 2k, seen while the sheet lifts away from the right.
    const frontTex = this._textureFor(front);
    bindSheet();
    gl.cullFace(gl.BACK);
    gl.uniform1f(this.uniform.uMirror, 0);
    gl.uniform1f(this.uniform.uNormalSign, 1);
    gl.bindTexture(gl.TEXTURE_2D, frontTex ? frontTex.texture : this.placeholder);
    gl.drawElements(gl.TRIANGLES, upload.count, gl.UNSIGNED_SHORT, 0);

    // Back face: page 2k+1, mirrored so it reads correctly once landed.
    const backTex = this._textureFor(back);
    bindSheet();
    gl.cullFace(gl.FRONT);
    gl.uniform1f(this.uniform.uMirror, 1);
    gl.uniform1f(this.uniform.uNormalSign, -1);
    gl.bindTexture(gl.TEXTURE_2D, backTex ? backTex.texture : this.placeholder);
    gl.drawElements(gl.TRIANGLES, upload.count, gl.UNSIGNED_SHORT, 0);

    gl.cullFace(gl.BACK);
    this._drawEdge();
  }

  destroy() {
    this.destroyed = true;
    const gl = this.gl;
    this.canvas.removeEventListener("webglcontextlost", this._onLost);
    this.canvas.removeEventListener("webglcontextrestored", this._onRestored);
    for (const index of [...this.textures.keys()]) this._dropTexture(index);
    if (this.program) gl.deleteProgram(this.program);
    if (this.placeholder) gl.deleteTexture(this.placeholder);
    if (this.shadowTexture) gl.deleteTexture(this.shadowTexture);
    if (this.quad) {
      gl.deleteBuffer(this.quad.vbo);
      gl.deleteBuffer(this.quad.ibo);
    }
    if (this.edgeBuffer) {
      gl.deleteBuffer(this.edgeBuffer);
      gl.deleteBuffer(this.edgeIndex);
    }
    if (this.sheetUpload) {
      gl.deleteBuffer(this.sheetUpload.vbo);
      gl.deleteBuffer(this.sheetUpload.nbo);
      gl.deleteBuffer(this.sheetUpload.ubo);
      gl.deleteBuffer(this.sheetUpload.ibo);
    }
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return new Float32Array([v[0] / len, v[1] / len, v[2] / len]);
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
