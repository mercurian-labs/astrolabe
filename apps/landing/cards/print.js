// Astrolabe · share cards · the two-ink print
//
// The footer's print (src/scripts/footer.js), lifted out of the page so a card can be printed at an
// exact size: Beethoven basin's height (public/assets/footer/terrain.webp) under a low sun, ivory and
// olive grain thresholded against the same seeded noise, and a mark (the wordmark or the monogram) as
// a plate of brighter stock standing off the ground and casting its shadow on it. The shader is the
// footer's, less the naming lens; keep the two in step when the print changes.
//
// The day print is the same ground read the other way, as relight.js prints it by day: dark ink where
// the ground is darker than the paper, so level ground stays paper and the shadows and away-facing
// walls fill with ink; the plate is solid ink with its walls lit and shaded.
//
// print(canvas, { ink: "night" | "day", mark?, sun?, ground? }) draws once and resolves when the
// pixels are on the canvas. `mark` is { image, rect: [x, y, w, h] } in CSS px; `ground` is
// { scale, offset } (CSS px per texel, and where the data's top left sits), defaulting to cover.

const RAD = Math.PI / 180;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
export const INKS = {
  night: "#1e1c1a",
  ivory: "#eaddc7",
  olive: "#8d8455",
  rust: "#a0492a",
  paper: "#fbf9f4",
  ink: "#292724",
  dayOlive: "#807948",
};
const ASSETS = "/assets/footer/";

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not load ${src}`));
    image.src = src;
  });
}

// The crop's height, 0..1 over its range (as footer.js decodes it).
async function loadTerrain() {
  const [meta, image] = await Promise.all([
    fetch(ASSETS + "terrain.json").then((r) => r.json()),
    loadImage(ASSETS + "terrain.webp"),
  ]);
  const [w, h] = meta.size;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const range = meta.heightMax - meta.heightMin;
  const height = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    height[i] = ((px[i * 4] * 256 + px[i * 4 + 1]) * meta.heightStep) / range;
  return { meta, height, range };
}

const vertex = `#version 300 es
  in vec2 a_pos;
  void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const fragment = `#version 300 es
  precision highp float;
  uniform sampler2D u_height;
  uniform sampler2D u_noise;   // 512 × 512 fixed thresholds: r ivory (or ink), g olive
  uniform sampler2D u_mark;    // r letters, g rust, b the relief profile
  uniform vec4 u_markRect;     // CSS px: x, y, width, height
  uniform float u_rise;        // how far the plate stands off the ground, CSS px
  uniform vec2 u_data;
  uniform vec2 u_res;
  uniform float u_dpr;
  uniform vec2 u_offset;
  uniform float u_scale;
  uniform float u_sub;
  uniform float u_relief;
  uniform vec3 u_sun;
  uniform float u_tanAlt;
  uniform float u_flat;
  uniform float u_day;         // 0 the night print, 1 the day print
  uniform float u_gain;        // the ground's ink against the footer's (1): a lighter or heavier impression
  uniform vec3 u_night;
  uniform vec3 u_ivory;
  uniform vec3 u_olive;
  uniform vec3 u_rust;
  uniform vec3 u_paper;
  uniform vec3 u_ink;
  out vec4 outColor;

  const float IVORY_A = 0.8;
  const float OLIVE_A = 0.5;

  float H(vec2 uv) { return texture(u_height, uv).r; }
  vec2 toUV(vec2 css) { return (css - u_offset) / u_scale / u_data; }

  vec4 markAt(vec2 css) {
    vec2 uv = (css - u_markRect.xy) / u_markRect.zw;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
    return texture(u_mark, uv);
  }
  float letterH(vec2 css) { return smoothstep(0.08, 0.92, markAt(css).b) * u_rise; }

  float exposure(vec2 grad) {
    return max(dot(normalize(vec3(-grad, 1.0)), u_sun), 0.0) / u_flat * 0.225;
  }
  float curve(float lit) { return pow(clamp((lit - 0.14) / 0.86, 0.0, 1.0), 1.2); }

  // The ground's light before the print's curve: 0.225 on level ground, 0 in shadow.
  float light(vec2 uv) {
    vec2 e = 1.0 / u_data;
    vec2 grad = vec2(H(uv + vec2(e.x, 0.0)) - H(uv - vec2(e.x, 0.0)), H(uv - vec2(0.0, e.y)) - H(uv + vec2(0.0, e.y))) * 0.5 * u_relief;
    vec2 b = e * 4.0;
    vec2 broad = vec2(H(uv + vec2(b.x, 0.0)) - H(uv - vec2(b.x, 0.0)), H(uv - vec2(0.0, b.y)) - H(uv + vec2(0.0, b.y))) / 8.0 * u_relief;
    float lit = 0.75 * exposure(grad) + 0.25 * exposure(broad);
    if (lit > 0.0) {
      vec2 dir = normalize(u_sun.xy + 1e-6) * vec2(1.0, -1.0) * e;
      float h0 = H(uv);
      float occlusion = -1.0;
      for (int i = 1; i <= 24; i++) {
        float d = float(i) * (1.0 + float(i) * 0.35);
        occlusion = max(occlusion, (H(uv + dir * d) - h0) * u_relief - d * u_tanAlt);
      }
      lit *= 1.0 - smoothstep(0.0, 1.1, occlusion);
    }
    return lit;
  }

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

  vec2 grain(float pA, float pOlive, vec2 dev) {
    vec2 cell = floor(dev) * u_sub;
    vec2 cover = vec2(0.0);
    for (int j = 0; j < 2; j++) {
      for (int i = 0; i < 2; i++) {
        if (float(i) >= u_sub || float(j) >= u_sub) continue;
        vec4 r = texture(u_noise, (cell + vec2(float(i), float(j)) + 0.5) / 512.0);
        cover += vec2(step(r.r, pA), step(r.g, pOlive));
      }
    }
    return cover / (u_sub * u_sub);
  }

  void main() {
    vec2 dev = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
    vec2 css = dev / u_dpr;
    vec4 mk = markAt(css);
    float letter = smoothstep(0.35, 0.65, mk.b);
    float rust = mk.g / max(mk.r + mk.g, 1e-3) * step(0.02, mk.r + mk.g);
    float lit = light(toUV(css));
    float olive = 0.42 * (1.0 - H(toUV(css + vec2(1.0, -1.5)))) + 0.03;
    float wall = 0.0;  // the plate's walls: lit above 0.6, shaded below
    if (letter > 0.0) {
      vec2 g = vec2(letterH(css + vec2(1.0, 0.0)) - letterH(css - vec2(1.0, 0.0)),
                    letterH(css - vec2(0.0, 1.0)) - letterH(css + vec2(0.0, 1.0))) * 0.5;
      wall = clamp(0.6 + (exposure(g) - 0.225) * 1.5, 0.0, 1.0);
      olive *= 1.0 - letter;
    }
    float shadow = letter < 1.0 ? letterShadow(css) * (1.0 - letter) : 0.0;

    vec3 color;
    if (u_day < 0.5) {
      // The footer's night print, unchanged.
      float t = mix(curve(lit) * u_gain, wall, letter);
      t *= 1.0 - 0.96 * shadow;
      olive *= 1.0 - 0.75 * shadow;
      vec2 cover = grain(t, olive, dev);
      vec3 ink = mix(u_ivory, u_rust * 1.22, rust * letter);
      color = u_night * (1.0 - 0.3 * shadow);
      color = mix(color, u_olive, cover.y * OLIVE_A);
      color = mix(color, ink, cover.x * mix(IVORY_A, 0.94, letter));
    } else {
      // The day print: ink where the ground falls below the paper, as [02]'s ground prints by day:
      // level ground a sparse stipple, walls turned from the sun fuller, the plate's shadow fuller still.
      float r = lit / 0.225;
      float dark = (0.05 + 0.5 * pow(clamp(1.0 - r, 0.0, 1.0), 1.1)) * u_gain;
      dark = mix(dark, 0.78, shadow);
      // The plate: solid ink on top, its lit walls opening to the paper, its shaded walls fuller.
      float plate = clamp(0.93 - (wall - 0.6) * 1.1, 0.0, 1.0);
      dark = mix(dark, plate, letter);
      olive *= (1.0 - 0.6 * shadow) * 0.85;
      vec2 cover = grain(dark, olive, dev);
      vec3 ink = mix(u_ink, u_rust, rust * letter);
      color = u_paper;
      color = mix(color, u_olive, cover.y * 0.42);
      color = mix(color, ink, cover.x * mix(0.86, 0.96, letter));
    }
    outColor = vec4(color, 1.0);
  }`;

// The mark packed for the shader as footer.js packs it: red the letters, green the rust, blue the
// relief profile (the letters blurred over about 3 CSS px).
function packMark(image, rect, dpr) {
  const pad = 6;
  const r = [rect[0] - pad, rect[1] - pad, rect[2] + 2 * pad, rect[3] + 2 * pad];
  const w = Math.max(1, Math.round(r[2] * dpr));
  const h = Math.max(1, Math.round(r[3] * dpr));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, pad * dpr, pad * dpr, rect[2] * dpr, rect[3] * dpr);
  const own = ctx.getImageData(0, 0, w, h).data;
  const profile = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) profile[i] = own[i * 4 + 3] / 255;
  const k = Math.max(1, Math.round(0.9 * dpr));
  const tmp = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -k; x <= k; x++) acc += profile[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / (2 * k + 1);
        acc += profile[y * w + Math.min(w - 1, x + k + 1)] - profile[y * w + Math.max(0, x - k)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -k; y <= k; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        profile[y * w + x] = acc / (2 * k + 1);
        acc += tmp[Math.min(h - 1, y + k + 1) * w + x] - tmp[Math.max(0, y - k) * w + x];
      }
    }
  }
  const packed = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = own[i * 4 + 3];
    const isRust = a > 40 && own[i * 4] - own[i * 4 + 1] > 48;
    packed[i * 4] = isRust ? 0 : a;
    packed[i * 4 + 1] = isRust ? a : 0;
    packed[i * 4 + 2] = Math.round(profile[i] * 255);
  }
  return { packed, w, h, rect: r };
}

// The footer's noise, from the same seed, so the grain is the page's grain.
function noise() {
  let seed = 0x2f6e2b1;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const data = new Uint8Array(512 * 512 * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(random() * 255) + 1;
  return data;
}

export async function print(
  canvas,
  {
    ink = "night",
    mark = null,
    sun = { alt: 16, az: 292 },
    ground = null,
    rise = null,
    gain = 1,
  } = {},
) {
  const box = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(box.width * dpr);
  canvas.height = Math.round(box.height * dpr);
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error("no WebGL2");
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const u = {};
  for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
    const name = gl.getActiveUniform(program, i).name;
    u[name] = gl.getUniformLocation(program, name);
  }
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const texture = (unit, filter, wrap) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  };

  const t = await loadTerrain();
  const [w, h] = t.meta.size;
  texture(0, gl.LINEAR, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, t.height);
  // R32F filters only with this extension; without it the shader reads nearest texels.
  if (!gl.getExtension("OES_texture_float_linear")) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }
  texture(1, gl.NEAREST, gl.REPEAT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, noise());
  texture(3, gl.LINEAR, gl.CLAMP_TO_EDGE);
  if (mark) {
    const m = packMark(mark.image, mark.rect, dpr);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, m.w, m.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, m.packed);
    gl.uniform4f(u.u_markRect, ...m.rect);
    gl.uniform1f(u.u_rise, rise ?? Math.max(4, mark.rect[3] * 0.045));
  } else {
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
    gl.uniform4f(u.u_markRect, -10, -10, 1, 1);
    gl.uniform1f(u.u_rise, 0);
  }
  gl.uniform1i(u.u_height, 0);
  gl.uniform1i(u.u_noise, 1);
  gl.uniform1i(u.u_mark, 3);

  const ca = Math.cos(sun.alt * RAD);
  gl.uniform3f(
    u.u_sun,
    ca * Math.sin(sun.az * RAD),
    ca * Math.cos(sun.az * RAD),
    Math.sin(sun.alt * RAD),
  );
  gl.uniform1f(u.u_tanAlt, Math.tan(sun.alt * RAD));
  gl.uniform1f(u.u_flat, Math.max(Math.sin(sun.alt * RAD), Math.sin(12 * RAD)));
  gl.uniform1f(u.u_day, ink === "day" ? 1 : 0);
  gl.uniform1f(u.u_gain, gain);
  gl.uniform3f(u.u_night, ...hex(INKS.night));
  gl.uniform3f(u.u_ivory, ...hex(INKS.ivory));
  gl.uniform3f(u.u_olive, ...hex(ink === "day" ? INKS.dayOlive : INKS.olive));
  gl.uniform3f(u.u_rust, ...hex(INKS.rust));
  gl.uniform3f(u.u_paper, ...hex(INKS.paper));
  gl.uniform3f(u.u_ink, ...hex(INKS.ink));

  const scale = ground?.scale ?? Math.max(box.width / w, box.height / h);
  const offset = ground?.offset ?? [(box.width - w * scale) / 2, (box.height - h * scale) / 2];
  gl.uniform2f(u.u_data, w, h);
  gl.uniform1f(u.u_relief, (t.range * t.meta.exaggeration) / t.meta.metresPerPixel);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(u.u_res, canvas.width, canvas.height);
  gl.uniform1f(u.u_dpr, dpr);
  gl.uniform2f(u.u_offset, ...offset);
  gl.uniform1f(u.u_scale, scale);
  gl.uniform1f(u.u_sub, dpr < 1.5 ? 2 : 1);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.finish();
  return { meta: t.meta, scale, offset };
}
