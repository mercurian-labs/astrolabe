// Astrolabe · drafting · the closing ground, lit by the instrument's sun
//
// The closing section stands on a close crop of Mercury (scripts/render-relight.py exports its normals
// and height). Each time the working astrolabe's represented moment changes (it announces that with an
// `astrolabe:time` event), the section takes its palette from the sun's altitude (twilight.js) and
// this shader prints the ground in the page's two-ink grain under that sun: the print's up is north,
// so a sun at azimuth A and altitude h lights it along (cos h sin A, cos h cos A, sin h). Shadows are
// cast by marching toward the sun through the height. The grain is thresholded against a fixed noise
// texture laid on the canvas's own pixels, so a moving light only flips the grains whose shade
// crosses their threshold; nothing shimmers.
//
// The ground's brightness is absolute (direct sun plus skylight, falling through twilight) and the
// paper's comes from the palette, so the grain is whatever prints one on the other: dark ink where the
// ground is darker than the paper, ivory where it is lighter. By day that is ink in the shadows; at
// dusk the ground goes dark before the paper does; through nautical twilight the paper falls past it
// and the ink turns over; at night a little ivory picks out what the skylight finds.
//
// Repaints happen only when the moment changes (a drag, the eased return to now, the minute) and only
// while the section is on screen and the tab visible; otherwise the change waits for the next look.
// The data loads when the section comes near. Without WebGL the static print (CSS masks) shows and the
// palette still follows the sun.

import Twilight from "./twilight.js";

(() => {
  const section = document.querySelector("[data-relight]");
  if (!section || typeof Twilight === "undefined") return;
  const canvas = section.querySelector("[data-relight-canvas]");
  const DATA = "/assets/art/close-relief";
  const RAD = Math.PI / 180;

  let sun = null; // { alt, az } at the represented moment
  let dirty = true;
  let visible = false;
  let gl = null;
  let draw = null;
  const u = {}; // uniform locations by name

  const fallback = () => section.classList.add("relight--static");

  /* ─────────── The palette follows the sun whether or not the ground can be drawn. */

  document.addEventListener("astrolabe:time", (event) => {
    const { sunAlt, sunAz } = event.detail;
    if (sun && Math.abs(sun.alt - sunAlt) < 0.004 && Math.abs(sun.az - sunAz) < 0.004) return;
    sun = { alt: sunAlt, az: sunAz };
    Twilight.apply(section, sunAlt);
    dirty = true;
    paint();
  });

  function paint() {
    if (!draw || !sun || !dirty || !visible || document.hidden) return;
    dirty = false;
    draw();
  }

  document.addEventListener("visibilitychange", paint);

  if (!canvas) return;
  if ("IntersectionObserver" in window) {
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        near.disconnect();
        start();
      },
      { rootMargin: "800px 0px" },
    );
    near.observe(section);
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      paint();
    }).observe(canvas);
  } else {
    visible = true;
    start();
  }

  /* ─────────── WebGL. */

  const vertex = `
    attribute vec2 a_pos;
    void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

  const fragment = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform sampler2D u_relief;  // r, g: normal east and north; b: height
    uniform sampler2D u_noise;   // 512 × 512 fixed thresholds: r ink, g olive
    uniform vec2 u_data;         // the data's size, texels
    uniform vec2 u_res;          // canvas, device px
    uniform float u_dpr;
    uniform vec2 u_offset;       // where the data's top left sits, CSS px
    uniform float u_scale;       // CSS px per texel
    uniform float u_sub;         // grains per device px along each axis (2 below DPR 1.5)
    uniform vec3 u_sun;          // toward the sun: east, north, up
    uniform float u_tanAlt;
    uniform float u_flat;        // the exposure: direct light on level ground, floored
    uniform float u_direct;      // the sun's share of the ground's brightness
    uniform float u_ambient;     // the sky's share
    uniform vec3 u_glow;         // toward the bright part of the sky, over the sun
    uniform float u_glowShare;   // how much of the skylight comes from there
    uniform float u_relH;        // texels of rise for the full height range
    uniform vec3 u_y;            // luminance of the paper, the dark ink, the ivory ink
    uniform vec3 u_dark;
    uniform vec3 u_ivory;
    uniform vec3 u_olive;
    uniform vec3 u_alpha;        // dark ink, ivory ink, olive

    const float DAY_Y = 0.947;   // the day paper's luminance; the ground is measured against it

    void main() {
      vec2 css = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_dpr;
      vec2 uv = (css - u_offset) / u_scale / u_data;
      vec3 t = texture2D(u_relief, uv).rgb;
      vec3 n = vec3(t.rg * 2.0 - 1.0, 0.0);
      n.z = sqrt(max(0.0, 1.0 - dot(n.xy, n.xy)));

      // The sun: Lambert against level ground's own light, with the shadows the relief casts.
      float lit = 0.0;
      if (u_direct > 0.0) {
        float shadow = 1.0;
        if (u_tanAlt < 1.7) {
          vec2 dir = normalize(u_sun.xy) * vec2(1.0, -1.0) / u_data; // north is up the texture
          float occlusion = -1.0;
          for (int i = 1; i <= 24; i++) {
            float d = float(i) * (1.0 + float(i) * 0.35);
            float h = texture2D(u_relief, uv + dir * d).b;
            occlusion = max(occlusion, (h - t.b) * u_relH - d * u_tanAlt);
          }
          shadow = 1.0 - smoothstep(0.0, 1.1, occlusion);
        }
        lit = min(max(dot(n, u_sun), 0.0) / u_flat, 2.4) * shadow;
      }
      // Skylight: the open sky overhead, and the glow over the sun, which outlasts it into twilight.
      float sky = pow(n.z, 10.0);
      float glow = max(dot(n, u_glow), 0.0) / u_glow.z;
      float ground = DAY_Y * (u_direct * lit + u_ambient * mix(sky, glow, u_glowShare));

      // What prints the ground on this paper.
      float paper = u_y.x;
      float dark = u_y.y < paper ? clamp((paper - ground) / (paper - u_y.y), 0.0, 1.0) : 0.0;
      float light = u_y.z > paper ? clamp((ground - paper) / (u_y.z - paper), 0.0, 1.0) : 0.0;
      dark = pow(dark, 1.15) * 0.94;

      // The olive, off register: lowlands, printed from a plate shifted a pixel and a half.
      float hOlive = texture2D(u_relief, (css + vec2(1.0, -1.5) - u_offset) / u_scale / u_data).b;
      float olive = 0.62 * (1.0 - hOlive) + 0.08;

      // Grains at the print's resolution (two per CSS px), averaged where a device px holds several.
      vec2 cell = floor(gl_FragCoord.xy) * u_sub;
      float inkDark = 0.0;
      float inkLight = 0.0;
      float oliveCover = 0.0;
      for (int j = 0; j < 2; j++) {
        for (int i = 0; i < 2; i++) {
          if (float(i) >= u_sub || float(j) >= u_sub) continue;
          vec4 r = texture2D(u_noise, (cell + vec2(float(i), float(j)) + 0.5) / 512.0);
          inkDark += step(r.r, dark);
          inkLight += step(r.r, light);
          oliveCover += step(r.g, olive);
        }
      }
      float k = 1.0 / (u_sub * u_sub);
      float aDark = inkDark * k * u_alpha.x;
      float aLight = inkLight * k * u_alpha.y;
      float aOlive = oliveCover * k * u_alpha.z * (1.0 - aDark - aLight);
      float a = aDark + aLight + aOlive;
      gl_FragColor = vec4(u_dark * aDark + u_ivory * aLight + u_olive * aOlive, a);
    }`;

  function start() {
    gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: true, alpha: true });
    if (!gl) return fallback();
    const program = gl.createProgram();
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return fallback();
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
      const name = gl.getActiveUniform(program, i).name;
      u[name] = gl.getUniformLocation(program, name);
    }

    const texture = (unit, filter, wrap) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    };

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
    texture(1, gl.NEAREST, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, noise);

    const image = new Image();
    image.decoding = "async";
    Promise.all([
      fetch(`${DATA}.json`).then((response) => response.json()),
      new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = `${DATA}.webp`;
      }),
    ])
      .then(([meta]) => {
        texture(0, gl.LINEAR, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
        gl.uniform1i(u.u_relief, 0);
        gl.uniform1i(u.u_noise, 1);
        gl.uniform2f(u.u_data, meta.size[0], meta.size[1]);
        gl.uniform1f(u.u_relH, meta.relief);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ZERO);
        draw = () => render(meta);
        layout();
        new ResizeObserver(() => {
          layout();
          dirty = true;
          paint();
        }).observe(canvas);
        section.classList.add("relight--live");
        dirty = true;
        paint();
      })
      .catch(fallback);

    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      draw = null;
      fallback();
    });
  }

  let box = { width: 0, height: 0 };
  let dpr = 1;
  function layout() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    box = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(box.width * dpr));
    canvas.height = Math.max(1, Math.round(box.height * dpr));
  }

  // Brightness of the sky on the ground through twilight, in units of the day paper (piecewise).
  const AMBIENT = [
    [6, 0.3],
    [0, 0.22],
    [-3, 0.17],
    [-6, 0.11],
    [-9, 0.06],
    [-12, 0.05],
    [-18, 0.085],
  ];
  function along(stops, x) {
    if (x >= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (x >= stops[i][0]) {
        const [a0, v0] = stops[i - 1];
        const [a1, v1] = stops[i];
        return v0 + ((v1 - v0) * (a0 - x)) / (a0 - a1);
      }
    }
    return stops[stops.length - 1][1];
  }
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  function render(meta) {
    const { alt, az } = sun;
    const palette = Twilight.at(alt);
    // The data covers the canvas, centred.
    const scale = Math.max(box.width / meta.size[0], box.height / meta.size[1]);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(u.u_res, canvas.width, canvas.height);
    gl.uniform1f(u.u_dpr, dpr);
    gl.uniform2f(
      u.u_offset,
      (box.width - meta.size[0] * scale) / 2,
      (box.height - meta.size[1] * scale) / 2,
    );
    gl.uniform1f(u.u_scale, scale);
    gl.uniform1f(u.u_sub, dpr < 1.5 ? 2 : 1);
    const ca = Math.cos(alt * RAD);
    gl.uniform3f(u.u_sun, ca * Math.sin(az * RAD), ca * Math.cos(az * RAD), Math.sin(alt * RAD));
    gl.uniform1f(u.u_tanAlt, Math.tan(Math.max(alt, 0.05) * RAD));
    gl.uniform1f(u.u_flat, Math.max(Math.sin(alt * RAD), Math.sin(12 * RAD)));
    gl.uniform1f(u.u_direct, 0.58 * smooth(-0.8, 1, alt));
    gl.uniform1f(u.u_ambient, along(AMBIENT, alt));
    const GLOW = 18 * RAD; // the twilight glow's height over the horizon
    gl.uniform3f(
      u.u_glow,
      Math.cos(GLOW) * Math.sin(az * RAD),
      Math.cos(GLOW) * Math.cos(az * RAD),
      Math.sin(GLOW),
    );
    gl.uniform1f(u.u_glowShare, 0.25 + 0.55 * smooth(2, -3, alt) - 0.8 * smooth(-12, -19, alt));
    gl.uniform3f(u.u_y, palette.paperY, palette.darkY, palette.ivoryY);
    gl.uniform3f(u.u_dark, ...palette.dark);
    gl.uniform3f(u.u_ivory, ...palette.ivory);
    gl.uniform3f(u.u_olive, ...palette.olive);
    gl.uniform3f(u.u_alpha, 0.92, 0.85, 0.34 - 0.14 * palette.night);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
})();
