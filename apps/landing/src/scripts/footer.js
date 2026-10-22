// Astrolabe · footer
//
// The night band printed on Beethoven basin, with a naming lens. The crop's height comes as 16 bits
// (public/assets/footer/terrain.webp, see the README), and a WebGL2 shader makes the two-ink print
// from it as relight.js does: normals from the height, Lambert light under a low west-northwest sun
// with shadows marched toward it, and ivory and olive grain thresholded against fixed noise. The
// wordmark is part of the print, a plate of brighter stock standing off the basin and casting its
// shadow on it. Under the pointer the lens draws the graticule on the ground, and the DOM beside it
// shows the coordinates, the three nearest named features from the IAU Gazetteer, leader lines and
// crater rims at their true size, the readout placed clear of the letters.
//
// WebGL is set up only when the band comes near the viewport. It repaints only on change (a pointer
// move, then while the lens settles) and only while on screen in a visible tab; with reduced motion
// the lens snaps. Without WebGL2 the static print (CSS masks) shows, fetched only then.

const RAD = Math.PI / 180;
const NIGHT = [0x1e, 0x1c, 0x1a].map((v) => v / 255);
const IVORY = [0xea, 0xdd, 0xc7].map((v) => v / 255);
const OLIVE = [0x8d, 0x84, 0x55].map((v) => v / 255);
const RUST = [0xa0, 0x49, 0x2a].map((v) => v / 255);
const SUN = { alt: 16, az: 292 }; // low, from the west-northwest
const ASSETS = "/assets/footer/";

const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");

/* ─────────── The terrain (decoded once) and the named features. */

function loadTerrain() {
  return Promise.all([
    fetch(ASSETS + "terrain.json").then((r) => r.json()),
    fetch(ASSETS + "features.json").then((r) => r.json()),
    loadImage(ASSETS + "terrain.webp"),
  ]).then(([meta, features, image]) => {
    const [w, h] = meta.size;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    const range = meta.heightMax - meta.heightMin;
    const height = new Float32Array(w * h); // 0..1 over the crop's range
    for (let i = 0; i < w * h; i++)
      height[i] = ((px[i * 4] * 256 + px[i * 4 + 1]) * meta.heightStep) / range;
    const lo0 = meta.centre[0] * RAD;
    const la0 = meta.centre[1] * RAD;
    const fwd = [Math.cos(la0) * Math.cos(lo0), Math.cos(la0) * Math.sin(lo0), Math.sin(la0)];
    const right = [-Math.sin(lo0), Math.cos(lo0), 0];
    const up = [
      fwd[1] * right[2] - fwd[2] * right[1],
      fwd[2] * right[0] - fwd[0] * right[2],
      fwd[0] * right[1] - fwd[1] * right[0],
    ];
    return { meta, features, height, range, basis: { fwd, right, up } };
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

// Texel coordinates to latitude and longitude (degrees), on the orthographic view the crop was cut from.
function texelToLatLon(t, x, y) {
  const [w, h] = t.meta.size;
  const X = (x - w / 2) / t.meta.radiusPx;
  const Y = (h / 2 - y) / t.meta.radiusPx;
  const Z = Math.sqrt(Math.max(0, 1 - X * X - Y * Y));
  const { fwd, right, up } = t.basis;
  const P = [0, 1, 2].map((i) => X * right[i] + Y * up[i] + Z * fwd[i]);
  return { lat: Math.asin(P[2]) / RAD, lon: Math.atan2(P[1], P[0]) / RAD };
}
function latLonToTexel(t, lat, lon) {
  const la = lat * RAD;
  const lo = lon * RAD;
  const P = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const [w, h] = t.meta.size;
  return [
    w / 2 + dot(P, t.basis.right) * t.meta.radiusPx,
    h / 2 - dot(P, t.basis.up) * t.meta.radiusPx,
  ];
}

/* ─────────── The shader. */

const vertex = `#version 300 es
  in vec2 a_pos;
  void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const fragment = `#version 300 es
  precision highp float;
  uniform sampler2D u_height;  // the crop's height, 0..1 over its range
  uniform sampler2D u_noise;   // 512 × 512 fixed thresholds: r ivory, g olive
  uniform sampler2D u_mark;    // the wordmark: r letters, g rust, b the relief profile
  uniform vec4 u_markRect;     // where the mark texture sits, CSS px: x, y, width, height
  uniform float u_rise;        // how far the letters stand off the ground, CSS px
  uniform vec2 u_data;         // the data's size, texels
  uniform vec2 u_res;          // canvas, device px
  uniform float u_dpr;
  uniform vec2 u_offset;       // where the data's top left sits, CSS px
  uniform float u_scale;       // CSS px per texel
  uniform float u_sub;         // grains per device px along each axis (2 below DPR 1.5)
  uniform float u_relief;      // texels of rise for the whole height range
  uniform vec3 u_sun;          // toward the sun: east, north, up
  uniform float u_tanAlt;
  uniform float u_flat;        // direct light on level ground, floored
  uniform vec3 u_lens;         // CSS x, y, radius (0: no lens)
  uniform vec3 u_right;        // the view's basis, for latitude and longitude
  uniform vec3 u_up;
  uniform vec3 u_fwd;
  uniform float u_radius;      // the globe's radius, texels
  uniform vec3 u_night;
  uniform vec3 u_ivory;
  uniform vec3 u_olive;
  uniform vec3 u_rust;
  out vec4 outColor;

  const float IVORY_A = 0.8;
  const float OLIVE_A = 0.5;

  float H(vec2 uv) { return texture(u_height, uv).r; }
  vec2 toUV(vec2 css) { return (css - u_offset) / u_scale / u_data; }

  // The wordmark at a CSS point (see mark() in the script).
  vec4 markAt(vec2 css) {
    vec2 uv = (css - u_markRect.xy) / u_markRect.zw;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
    return texture(u_mark, uv);
  }
  // The letters' height off the ground, CSS px: a flat top on walls about 3 px wide.
  float letterH(vec2 css) { return smoothstep(0.08, 0.92, markAt(css).b) * u_rise; }

  // Light on a surface of slope grad (rise per run, east and north), exposed so level ground
  // prints as under a 13° sun whatever the sun's height.
  float exposure(vec2 grad) {
    return max(dot(normalize(vec3(-grad, 1.0)), u_sun), 0.0) / u_flat * 0.225;
  }
  // The print's curve (scripts/render-art.py): level ground stays nearly dark, sunward walls run bright.
  float curve(float lit) { return pow(clamp((lit - 0.14) / 0.86, 0.0, 1.0), 1.2); }

  // The ground's tone: Lambert with a little of the broad light, and the shadows the relief casts.
  float ground(vec2 uv) {
    vec2 e = 1.0 / u_data;
    vec2 grad = vec2(H(uv + vec2(e.x, 0.0)) - H(uv - vec2(e.x, 0.0)), H(uv - vec2(0.0, e.y)) - H(uv + vec2(0.0, e.y))) * 0.5 * u_relief;
    vec2 b = e * 4.0;
    vec2 broad = vec2(H(uv + vec2(b.x, 0.0)) - H(uv - vec2(b.x, 0.0)), H(uv - vec2(0.0, b.y)) - H(uv + vec2(0.0, b.y))) / 8.0 * u_relief;
    float lit = 0.75 * exposure(grad) + 0.25 * exposure(broad);
    if (lit > 0.0) {
      vec2 dir = normalize(u_sun.xy + 1e-6) * vec2(1.0, -1.0) * e; // north is up the texture
      float h0 = H(uv);
      float occlusion = -1.0;
      for (int i = 1; i <= 24; i++) {
        float d = float(i) * (1.0 + float(i) * 0.35);
        occlusion = max(occlusion, (H(uv + dir * d) - h0) * u_relief - d * u_tanAlt);
      }
      lit *= 1.0 - smoothstep(0.0, 1.1, occlusion);
    }
    return curve(lit);
  }

  // How much of the ground at css lies in the letters' shadow: marched toward the sun as far as
  // their height can throw it.
  float letterShadow(vec2 css) {
    vec2 toward = normalize(u_sun.xy + 1e-6) * vec2(1.0, -1.0);
    float reach = min(u_rise / max(u_tanAlt, 0.02), 200.0);
    float stepPx = max(reach / 40.0, 1.0);
    float s = 0.0;
    for (int i = 1; i <= 40; i++) {
      float d = stepPx * float(i);
      if (d > reach + stepPx) break;
      s = max(s, smoothstep(-0.6, 0.6, letterH(css + toward * d) - d * u_tanAlt));
    }
    return s;
  }

  // Ivory and olive cover from their probabilities: grains at two per CSS px, averaged where a device
  // px holds several.
  vec2 grain(float pIvory, float pOlive, vec2 dev) {
    vec2 cell = floor(dev) * u_sub;
    vec2 cover = vec2(0.0);
    for (int j = 0; j < 2; j++) {
      for (int i = 0; i < 2; i++) {
        if (float(i) >= u_sub || float(j) >= u_sub) continue;
        vec4 r = texture(u_noise, (cell + vec2(float(i), float(j)) + 0.5) / 512.0);
        cover += vec2(step(r.r, pIvory), step(r.g, pOlive));
      }
    }
    return cover / (u_sub * u_sub);
  }

  // Hairlines every step of a field, anti-aliased with fwidth; fades where they crowd closer than a few px.
  float lines(float f, float widthPx) {
    float w = fwidth(f);
    float d = abs(fract(f + 0.5) - 0.5) / max(w, 1e-6);
    float a = 1.0 - smoothstep(widthPx * 0.5 - 0.5, widthPx * 0.5 + 0.5, d);
    return a * (1.0 - smoothstep(0.16, 0.4, w));
  }

  void main() {
    vec2 dev = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y); // device px from the top left
    vec2 css = dev / u_dpr;
    float lens = u_lens.z < 0.5 ? 0.0 : 1.0 - smoothstep(u_lens.z * 0.5, u_lens.z, length(css - u_lens.xy));

    // The print: ivory tone, olive (lowlands, off register), and the letters, a plate of brighter
    // stock standing off the basin: their tops a dense ivory grain, sunward walls brighter still,
    // shaded walls dark, and their shadow on the ground beside them.
    vec4 mk = markAt(css);
    float letter = smoothstep(0.35, 0.65, mk.b);
    float rust = mk.g / max(mk.r + mk.g, 1e-3) * step(0.02, mk.r + mk.g);
    float t = ground(toUV(css));
    float olive = 0.42 * (1.0 - H(toUV(css + vec2(1.0, -1.5)))) + 0.03;
    float shadow = 0.0;
    if (letter > 0.0) {
      vec2 g = vec2(letterH(css + vec2(1.0, 0.0)) - letterH(css - vec2(1.0, 0.0)),
                    letterH(css - vec2(0.0, 1.0)) - letterH(css + vec2(0.0, 1.0))) * 0.5;
      float plate = clamp(0.6 + (exposure(g) - 0.225) * 1.5, 0.0, 1.0);
      t = mix(t, plate, letter);
      olive *= 1.0 - letter;
    }
    if (letter < 1.0) {
      shadow = letterShadow(css) * (1.0 - letter);
      t *= 1.0 - 0.96 * shadow;
      olive *= 1.0 - 0.75 * shadow;
    }

    vec2 cover = grain(t * mix(1.0, 0.7, lens), olive, dev);
    vec3 ink = mix(u_ivory, u_rust * 1.22, rust * letter);
    vec3 color = u_night * (1.0 - 0.3 * shadow); // the letters' shadow sits deeper than the night ground
    color = mix(color, u_olive, cover.y * OLIVE_A);
    color = mix(color, ink, cover.x * mix(IVORY_A, 0.94, letter));

    // The graticule under the lens, a hairline every degree and a firmer one every five, on the ground.
    if (lens > 0.0) {
      vec2 tex = (css - u_offset) / u_scale;
      float X = (tex.x - u_data.x * 0.5) / u_radius;
      float Y = (u_data.y * 0.5 - tex.y) / u_radius;
      vec3 P = X * u_right + Y * u_up + sqrt(max(0.0, 1.0 - X * X - Y * Y)) * u_fwd;
      float lat = degrees(asin(P.z));
      float lon = degrees(atan(P.y, P.x));
      float one = max(lines(lat, 0.7 * u_dpr), lines(lon, 0.7 * u_dpr));
      float five = max(lines(lat / 5.0, 0.9 * u_dpr), lines(lon / 5.0, 0.9 * u_dpr));
      color = mix(color, u_ivory, max(one * 0.22, five * 0.5) * lens * (1.0 - letter));
    }

    outColor = vec4(color, 1.0);
  }`;

/* ─────────── The band. */

class Foot {
  constructor(el) {
    this.el = el;
    this.canvas = el.querySelector("canvas");
    this.stage = el.querySelector("[data-foot-stage]");
    this.markImg = el.querySelector("[data-foot-mark]");
    this.svg = el.querySelector("[data-foot-names]");
    this.readout = el.querySelector("[data-foot-readout]");
    this.pip = el.querySelector("[data-foot-pip]");
    this.sighting = false; // a fine pointer over the stage, which the centre mark stands in for
    this.client = { x: 0, y: 0 };
    this.visible = false;
    this.ready = false;
    this.raf = 0;
    this.last = 0;
    this.box = { width: 0, height: 0 };
    this.dpr = 1;
    // The lens eases toward its target.
    this.lens = { x: 0, y: 0, r: 0 };
    this.target = { x: 0, y: 0, on: false };
    this.touch = false;
  }

  radius() {
    return Math.min(260, Math.max(100, this.box.width * 0.13));
  }

  start() {
    const gl = this.canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return this.fallback();
    this.gl = gl;
    const program = gl.createProgram();
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        console.warn(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return this.fallback();
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
      const name = gl.getActiveUniform(program, i).name;
      this.u[name] = gl.getUniformLocation(program, name);
    }
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    // The noise: seeded, so the print is the same grain on every visit.
    let seed = 0x2f6e2b1;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const noise = new Uint8Array(512 * 512 * 4);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(random() * 255) + 1;
    this.texture(1, gl.NEAREST, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, noise);
    this.texture(3, gl.LINEAR, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(4),
    );
    gl.uniform1i(this.u.u_height, 0);
    gl.uniform1i(this.u.u_noise, 1);
    gl.uniform1i(this.u.u_mark, 3);
    const ca = Math.cos(SUN.alt * RAD);
    gl.uniform3f(
      this.u.u_sun,
      ca * Math.sin(SUN.az * RAD),
      ca * Math.cos(SUN.az * RAD),
      Math.sin(SUN.alt * RAD),
    );
    gl.uniform1f(this.u.u_tanAlt, Math.tan(SUN.alt * RAD));
    gl.uniform1f(this.u.u_flat, Math.max(Math.sin(SUN.alt * RAD), Math.sin(12 * RAD)));
    gl.uniform3f(this.u.u_night, ...NIGHT);
    gl.uniform3f(this.u.u_ivory, ...IVORY);
    gl.uniform3f(this.u.u_olive, ...OLIVE);
    gl.uniform3f(this.u.u_rust, ...RUST);

    // The wordmark is the image already in the stage (wordmark-dark.svg), so it is fetched once.
    Promise.all([loadTerrain(), loadImage(this.markImg.currentSrc || this.markImg.src)])
      .then(([t, image]) => {
        this.t = t;
        this.image = image;
        const [w, h] = t.meta.size;
        // Full float if it filters, else half float (about 2 m of the range near the top: enough).
        const full = gl.getExtension("OES_texture_float_linear");
        this.texture(0, gl.LINEAR, gl.CLAMP_TO_EDGE);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          full ? gl.R32F : gl.R16F,
          w,
          h,
          0,
          gl.RED,
          gl.FLOAT,
          t.height,
        );
        gl.uniform2f(this.u.u_data, w, h);
        gl.uniform1f(this.u.u_relief, (t.range * t.meta.exaggeration) / t.meta.metresPerPixel);
        gl.uniform3f(this.u.u_right, ...t.basis.right);
        gl.uniform3f(this.u.u_up, ...t.basis.up);
        gl.uniform3f(this.u.u_fwd, ...t.basis.fwd);
        gl.uniform1f(this.u.u_radius, t.meta.radiusPx);
        this.layout();
        this.ready = true;
        this.el.classList.add("is-live");
        new ResizeObserver(([entry]) => {
          const { width, height } = entry.contentRect;
          if (Math.abs(width - this.box.width) < 0.5 && Math.abs(height - this.box.height) < 0.5)
            return;
          this.layout();
          this.request();
        }).observe(this.el);
        this.listen();
        this.request();
      })
      .catch((error) => {
        console.warn(error);
        this.fallback();
      });

    this.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.ready = false;
      this.fallback();
    });
  }

  texture(unit, filter, wrap) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  }

  fallback() {
    this.el.classList.remove("is-live", "takes-cursor");
    this.el.classList.add("is-static");
  }

  layout() {
    const gl = this.gl;
    const rect = this.el.getBoundingClientRect();
    // DPR capped at 2, and lower where a very wide band would ask for more than about 8 million pixels.
    this.dpr = Math.min(
      2,
      window.devicePixelRatio || 1,
      Math.sqrt(8e6 / Math.max(1, rect.width * rect.height)),
    );
    this.box = { width: rect.width, height: rect.height };
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    const [w, h] = this.t.meta.size;
    // The data covers the band, centred.
    this.scale = Math.max(rect.width / w, rect.height / h);
    this.offset = [(rect.width - w * this.scale) / 2, (rect.height - h * this.scale) / 2];
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.u.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.u_dpr, this.dpr);
    gl.uniform2f(this.u.u_offset, ...this.offset);
    gl.uniform1f(this.u.u_scale, this.scale);
    gl.uniform1f(this.u.u_sub, this.dpr < 1.5 ? 2 : 1);
    this.mark();
  }

  // The wordmark where its image sits, packed for the shader: red the letters, green the rust pivot
  // and full stop, blue the relief profile. A coarse copy of the mark grown by 3 px places the readout;
  // growing draws the mark at offsets round a circle, so it needs no canvas filter.
  mark() {
    const gl = this.gl;
    const band = this.el.getBoundingClientRect();
    const img = this.markImg.getBoundingClientRect();
    const d = this.dpr;
    const pad = 6;
    const rect = [
      img.left - band.left - pad,
      img.top - band.top - pad,
      img.width + 2 * pad,
      img.height + 2 * pad,
    ];
    const w = Math.max(1, Math.round(rect[2] * d));
    const h = Math.max(1, Math.round(rect[3] * d));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const draw = (dx = 0, dy = 0) =>
      ctx.drawImage(this.image, (pad + dx) * d, (pad + dy) * d, img.width * d, img.height * d);
    draw();
    const own = ctx.getImageData(0, 0, w, h).data;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 16; i++)
      draw(3 * Math.cos((i * Math.PI) / 8), 3 * Math.sin((i * Math.PI) / 8));
    draw();
    const grown = ctx.getImageData(0, 0, w, h).data;
    // The relief profile: the letters blurred over about 3 CSS px (three box passes), so the
    // shader's smoothstep turns it into a flat top on short walls centred on the true edge.
    const profile = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) profile[i] = own[i * 4 + 3] / 255;
    const r = Math.max(1, Math.round(0.9 * d));
    const tmp = new Float32Array(w * h);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < h; y++) {
        let acc = 0;
        for (let x = -r; x <= r; x++) acc += profile[y * w + Math.min(w - 1, Math.max(0, x))];
        for (let x = 0; x < w; x++) {
          tmp[y * w + x] = acc / (2 * r + 1);
          acc += profile[y * w + Math.min(w - 1, x + r + 1)] - profile[y * w + Math.max(0, x - r)];
        }
      }
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
        for (let y = 0; y < h; y++) {
          profile[y * w + x] = acc / (2 * r + 1);
          acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
        }
      }
    }
    const packed = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const a = own[i * 4 + 3];
      const isRust = a > 40 && own[i * 4] - own[i * 4 + 1] > 48; // rust #a0492a against the letters' ivory #eaddc7
      packed[i * 4] = isRust ? 0 : a;
      packed[i * 4 + 1] = isRust ? a : 0;
      packed[i * 4 + 2] = Math.round(profile[i] * 255);
    }
    gl.activeTexture(gl.TEXTURE3);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, packed);
    gl.uniform4f(this.u.u_markRect, ...rect);
    // The letters stand off the ground by about a twentieth of their height.
    gl.uniform1f(this.u.u_rise, Math.max(4, img.height * 0.045));
    const step = 4; // CSS px
    const gw = Math.ceil(rect[2] / step);
    const gh = Math.ceil(rect[3] / step);
    const grid = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const px = Math.min(w - 1, Math.round((x + 0.5) * step * d));
        const py = Math.min(h - 1, Math.round((y + 0.5) * step * d));
        grid[y * gw + x] = grown[(py * w + px) * 4 + 3] > 24 ? 1 : 0;
      }
    this.letters = { rect, step, gw, gh, grid };
  }

  // How many coarse cells of the letters a box (band CSS px) covers.
  overlap(x, y, w, h) {
    const L = this.letters;
    let n = 0;
    const x0 = Math.max(0, Math.floor((x - L.rect[0]) / L.step));
    const x1 = Math.min(L.gw - 1, Math.floor((x + w - L.rect[0]) / L.step));
    const y0 = Math.max(0, Math.floor((y - L.rect[1]) / L.step));
    const y1 = Math.min(L.gh - 1, Math.floor((y + h - L.rect[1]) / L.step));
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) n += L.grid[gy * L.gw + gx];
    return n;
  }

  /* Pointer: the lens lives on the stage, the open print under the links. A mouse moves it while it
     hovers; a touch places it with a tap and moves it with a sideways drag (the band is
     touch-action: pan-y, so vertical swipes still scroll the page), and the lens stays where the
     finger left it until a tap lands outside the stage. With a fine pointer that hovers, the lens's
     centre mark is the pointer: CSS hides the system cursor while the stage is sighting, the mark
     sits exactly on the pointer and the lens eases after it. Leaving the stage, a blurred window or
     a hidden tab gives the system cursor back. */
  listen() {
    const fine = matchMedia("(hover: hover) and (pointer: fine)");
    const takeOver = () =>
      this.el.classList.toggle("takes-cursor", fine.matches && this.ready && !!this.pip);
    takeOver();
    fine.addEventListener("change", takeOver);
    const at = (event) => {
      const rect = this.el.getBoundingClientRect();
      this.client = { x: event.clientX, y: event.clientY };
      this.target.x = event.clientX - rect.left;
      this.target.y = event.clientY - rect.top;
      this.target.on = true;
      this.request();
    };
    const leave = () => {
      if (!this.sighting) return;
      this.sight(false);
      this.target.on = false;
      this.request();
    };
    this.stage.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch" && !this.touch) return;
      if (event.pointerType !== "touch") this.sight(true);
      at(event);
    });
    addEventListener("blur", leave);
    document.addEventListener("visibilitychange", () => document.hidden && leave());
    // Scrolling carries the stage under a resting pointer, which sends no move; follow it from there.
    addEventListener(
      "scroll",
      () => {
        if (!this.sighting) return;
        const under = document.elementFromPoint(this.client.x, this.client.y);
        if (under && this.stage.contains(under))
          at({ clientX: this.client.x, clientY: this.client.y });
        else leave();
      },
      { passive: true },
    );
    this.stage.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch") this.touch = true;
      at(event);
    });
    const lift = () => (this.touch = false);
    this.stage.addEventListener("pointerup", lift);
    this.stage.addEventListener("pointercancel", lift);
    this.stage.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "touch") return;
      this.sight(false);
      this.target.on = false;
      this.request();
    });
    document.addEventListener("pointerdown", (event) => {
      if (!this.stage.contains(event.target) && this.target.on) {
        this.target.on = false;
        this.request();
      }
    });
  }

  sight(on) {
    if (this.sighting === on) return;
    this.sighting = on;
    this.stage.classList.toggle("is-sighting", on);
  }

  request() {
    if (this.raf || !this.ready || !this.visible || document.hidden) return;
    this.raf = requestAnimationFrame((time) => this.frame(time));
  }

  frame(time) {
    this.raf = 0;
    const dt = this.last ? Math.min(64, time - this.last) : 16;
    const moving = this.step(dt);
    // The centre mark is the pointer: on the target itself, never eased.
    if (this.sighting && this.pip)
      this.pip.style.transform = `translate(${this.target.x}px, ${this.target.y - this.stage.offsetTop}px)`;
    this.gl.uniform3f(this.u.u_lens, this.lens.x, this.lens.y, this.lens.r);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    this.names();
    if (moving) {
      this.last = time;
      this.request();
    } else this.last = 0;
  }

  // Eases the lens toward its target; returns whether it is still moving.
  step(dt) {
    const ease = (tau) => (reducedQuery.matches ? 1 : 1 - Math.exp(-dt / tau));
    const { lens, target } = this;
    const goalR = target.on ? this.radius() : 0;
    if (lens.r < 0.5 && target.on) {
      lens.x = target.x;
      lens.y = target.y;
    }
    const kp = ease(45);
    lens.x += (target.x - lens.x) * kp;
    lens.y += (target.y - lens.y) * kp;
    lens.r += (goalR - lens.r) * ease(110);
    if (Math.abs(goalR - lens.r) < 0.3) lens.r = goalR;
    return (
      Math.abs(target.x - lens.x) > 0.2 || Math.abs(target.y - lens.y) > 0.2 || lens.r !== goalR
    );
  }

  /* ─────────── The DOM beside the shader: the readout, leader lines and rims. */

  names() {
    const { svg, readout, lens, t } = this;
    if (lens.r < 1) {
      readout.hidden = true;
      svg.replaceChildren();
      this.stage.style.removeProperty("--reading");
      return;
    }
    const top = this.stage.offsetTop;
    const toTexel = (x, y) => [
      (x - this.offset[0]) / this.scale,
      (y - this.offset[1]) / this.scale,
    ];
    const toCss = ([x, y]) => [this.offset[0] + x * this.scale, this.offset[1] + y * this.scale];
    const here = texelToLatLon(t, ...toTexel(lens.x, lens.y));
    const kmPerPx = t.meta.metresPerPixel / 1000 / this.scale;
    const near = t.features
      .map((f) => {
        const [x, y] = toCss(latLonToTexel(t, f.lat, f.lon));
        const rim = f.type === "Crater" ? f.diameter / 2 / kmPerPx : 0;
        const d = Math.hypot(x - lens.x, y - lens.y);
        return { ...f, x, y, rim, away: Math.max(0, d - rim) * kmPerPx, d };
      })
      .filter(
        (f) =>
          f.x > -f.rim &&
          f.x < this.box.width + f.rim &&
          f.y > -f.rim &&
          f.y < this.box.height + f.rim,
      )
      .sort((a, b) => a.away - b.away)
      .slice(0, 3);
    const fade = Math.min(1, lens.r / this.radius());
    const el = (name, attrs) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", name);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      return node;
    };
    const nodes = [];
    near.forEach((f, i) => {
      const cy = (f.y - top).toFixed(1);
      if (f.rim)
        nodes.push(el("circle", { class: "rim", cx: f.x.toFixed(1), cy, r: f.rim.toFixed(1) }));
      // The leader runs from just off the pointer to the feature.
      const len = Math.max(1, f.d);
      const ux = (f.x - lens.x) / len;
      const uy = (f.y - lens.y) / len;
      const from = Math.min(len, 10);
      nodes.push(
        el("line", {
          class: "lead",
          x1: (lens.x + ux * from).toFixed(1),
          y1: (lens.y + uy * from - top).toFixed(1),
          x2: f.x.toFixed(1),
          y2: cy,
        }),
      );
      nodes.push(el("circle", { class: "dot", cx: f.x.toFixed(1), cy, r: 2 }));
      const n = el("text", {
        class: "num",
        x: (f.x + 6).toFixed(1),
        y: (f.y - top - 6).toFixed(1),
      });
      n.textContent = i + 1;
      nodes.push(n);
    });
    // The lens's centre; where the pointer mark stands in for it (CSS shows it), that is enough.
    if (!this.sighting || !this.el.classList.contains("takes-cursor"))
      nodes.push(
        el("circle", { class: "lead", cx: lens.x.toFixed(1), cy: (lens.y - top).toFixed(1), r: 4 }),
      );
    svg.replaceChildren(...nodes);
    svg.style.opacity = fade;
    const deg = (v, pos, neg) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? pos : neg}`;
    const kind = (f) =>
      f.type === "Crater" ? `crater · ${Math.round(f.diameter)} km` : f.type.toLowerCase();
    readout.innerHTML =
      `<b>${deg(here.lat, "N", "S")}&ensp;${deg(here.lon, "E", "W")}</b>` +
      near
        .map(
          (f, i) =>
            `<span><span>${i + 1} ${f.name}</span><em>${f.away < 1 ? kind(f) : `${Math.round(f.away)} km`}</em></span>`,
        )
        .join("");
    readout.hidden = false;
    readout.style.opacity = fade;
    // The readout gives the coordinates now, so the place label steps back out of its way.
    this.stage.style.setProperty("--reading", fade.toFixed(3));
    // The chip takes the first place beside the pointer that keeps clear of the letters and the stage's edges.
    const w = readout.offsetWidth;
    const h = readout.offsetHeight;
    const gap = 24;
    const spots = [
      [lens.x + gap, lens.y + gap],
      [lens.x + gap, lens.y - gap - h],
      [lens.x - gap - w, lens.y + gap],
      [lens.x - gap - w, lens.y - gap - h],
      [lens.x + gap, lens.y - gap * 3 - h],
      [lens.x - gap - w, lens.y - gap * 3 - h],
      [lens.x + gap * 3, lens.y + gap * 3],
      [lens.x - gap * 3 - w, lens.y + gap * 3],
    ];
    let best = null;
    for (const [x, y] of spots) {
      const out =
        x < 12 || y < top + 12 || x + w > this.box.width - 12 || y + h > this.box.height - 12;
      const score = this.overlap(x, y, w, h) + (out ? 1e4 : 0);
      if (!best || score < best.score) best = { x, y, score };
      if (score === 0) break;
    }
    // Where no spot fits (a narrow phone), keep the chip inside the band.
    const x = Math.max(12, Math.min(best.x, this.box.width - 12 - w));
    readout.style.transform = `translate(${x.toFixed(1)}px, ${(best.y - top).toFixed(1)}px)`;
  }
}

/* ─────────── Start the band as it comes near; paint only while it is on screen. */

const el = document.querySelector("[data-foot]");
if (el) {
  const foot = new Foot(el);
  if ("IntersectionObserver" in window) {
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        near.disconnect();
        foot.start();
      },
      { rootMargin: "600px 0px" },
    );
    near.observe(el);
    new IntersectionObserver(([entry]) => {
      foot.visible = entry.isIntersecting;
      foot.request();
    }).observe(el);
  } else {
    foot.visible = true;
    foot.start();
  }
  document.addEventListener("visibilitychange", () => foot.request());
}
