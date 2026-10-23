// Astrolabe · share cards · the Sphinx (see sphinx.html for the query).
//
// The print is src/scripts/plate.js's shader, less the eyepiece, under one frozen light; keep the two
// in step when the plate changes. By day it is the page's day print under a low sun. At night the page
// itself lights the building only by the sky, which leaves it a silhouette; the card keeps the night's
// inks and lamps but lights the building with a low moon, so it keeps its modelling: ivory grain where
// the light falls, the night paper where it does not, and the two upper windows printed flat in rust.

import Twilight from "/src/scripts/twilight.js";
import { done, fonts, params } from "./frame.js";

const ink = params.get("ink") === "day" ? "day" : "night";
const W = innerWidth;
const H = innerHeight;
const RAD = Math.PI / 180;

// The light: low, from the west-south-west, so in front and to the left of us: the tower's west face
// and the dome's shoulder lit, its front in half light, the rock carved by its crevices. By day the
// sun; at night a moon as bright as the page's sun is at dusk, with the lamps lit.
const LIGHT = {
  day: { palette: 30, alt: 14, az: 250, direct: 0.58, ambient: 0.34, glowShare: 0.25, lamp: 0 },
  night: { palette: -20, alt: 14, az: 250, direct: 0.55, ambient: 0.1, glowShare: 0, lamp: 0.96 },
}[ink];
const alt = Number(params.get("alt") ?? LIGHT.alt);
const az = Number(params.get("az") ?? LIGHT.az);

const vertex = `
  attribute vec2 a_pos;
  void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const fragment = `
  precision highp float;
  uniform sampler2D u_geo;     // r, g: normal x, y (view); b: depth (near is high); a: the building
  uniform sampler2D u_tone;    // r: the photograph's dark detail; g: recess; b: albedo / 2;
                               // a: 1 − the window panes × 128/255
  uniform sampler2D u_noise;   // 512 × 512 fixed thresholds: r ink, g olive, b (the eyepiece), a lamps
  uniform vec2 u_res;
  uniform vec2 u_size;
  uniform float u_dpr;
  uniform float u_sub;
  uniform float u_relief;
  uniform vec3 u_sun;
  uniform vec3 u_glow;
  uniform float u_direct;
  uniform float u_ambient;
  uniform float u_glowShare;
  uniform float u_expose;
  uniform vec3 u_y;
  uniform vec3 u_dark;
  uniform vec3 u_ivory;
  uniform vec3 u_olive;
  uniform vec3 u_alpha;
  uniform vec4 u_body;
  uniform vec4 u_lamp;

  const float DAY_Y = 0.947;

  vec3 normalOf(vec4 g) {
    vec3 n = vec3(g.rg * 2.0 - 1.0, 0.0);
    n.z = sqrt(max(0.0, 1.0 - dot(n.xy, n.xy)));
    return n;
  }

  void main() {
    vec2 uv = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_res;
    vec4 g = texture2D(u_geo, uv);
    vec2 shift = vec2(-1.0, -1.5) * u_dpr / u_res;
    vec4 g2 = texture2D(u_geo, uv + shift);
    if (g.a < 0.004 && g2.a < 0.004) {
      gl_FragColor = vec4(0.0);
      return;
    }
    vec3 n = normalOf(g);
    vec3 tone = texture2D(u_tone, uv).rgb;

    float lit = 0.0;
    if (u_direct > 0.0) {
      float shadow = 1.0;
      float across = length(u_sun.xy);
      if (across > 1e-3 && g.a > 0.5) {
        vec2 dir = vec2(u_sun.x, -u_sun.y) / across / u_size;
        float rise = u_sun.z / across;
        float z0 = g.b * u_relief;
        float occlusion = -1.0;
        for (int i = 1; i <= 26; i++) {
          float d = float(i) * (1.0 + float(i) * 0.3);
          vec4 q = texture2D(u_geo, uv + dir * d);
          if (q.a > 0.5) occlusion = max(occlusion, q.b * u_relief - z0 - d * rise);
        }
        shadow = 1.0 - smoothstep(1.0, 4.0, occlusion);
      }
      lit = max(dot(n, u_sun), 0.0) * shadow;
    }
    float sky = clamp(0.5 + 0.5 * n.y, 0.0, 1.0);
    sky *= sky;
    float glow = pow(max(dot(n, u_glow), 0.0), 1.5) * 1.3;
    float body = DAY_Y * (u_direct * lit / u_expose + u_ambient * mix(sky, glow, u_glowShare));
    body *= 1.0 - 0.8 * tone.r;
    body *= 2.0 * tone.b;

    vec3 n2 = normalOf(g2);
    float turned = (1.0 - smoothstep(0.1, 0.65, dot(n2, u_sun))) * (u_direct / 0.58);
    vec3 tone2 = texture2D(u_tone, uv + shift).rgb;
    float rock = clamp(1.0 - 2.0 * tone2.b, 0.0, 1.0) / 0.55;
    float olive = clamp(0.6 * tone2.g + 0.72 * turned + 0.3 * rock * turned, 0.0, 0.9);

    float paper = u_y.x;
    float dark = u_y.y < paper ? clamp((paper - body) / (paper - u_y.y), 0.0, 1.0) : 0.0;
    float light = u_y.z > paper ? clamp((body - paper) / (u_y.z - paper), 0.0, 1.0) : 0.0;
    dark = max(pow(dark, 1.15) * 0.8, u_y.y < paper ? 0.035 : 0.0);

    vec2 cell = floor(gl_FragCoord.xy) * u_sub;
    float inkDark = 0.0;
    float inkLight = 0.0;
    float oliveCover = 0.0;
    float lampCover = 0.0;
    for (int j = 0; j < 2; j++) {
      for (int i = 0; i < 2; i++) {
        if (float(i) >= u_sub || float(j) >= u_sub) continue;
        vec4 r = texture2D(u_noise, (cell + vec2(float(i), float(j)) + 0.5) / 512.0);
        inkDark += step(r.r, dark);
        inkLight += step(r.r, light);
        oliveCover += step(r.g, olive);
        lampCover += step(r.a, u_lamp.a);
      }
    }
    float k = 1.0 / (u_sub * u_sub);
    float aDark = inkDark * k * u_alpha.x * g.a;
    float aLight = inkLight * k * u_alpha.y * g.a;
    float aOlive = oliveCover * k * u_alpha.z * g2.a * (1.0 - aDark - aLight);
    vec4 grain = vec4(u_dark * aDark + u_ivory * aLight + u_olive * aOlive, aDark + aLight + aOlive);
    gl_FragColor = grain + u_body * g.a * (1.0 - grain.a);

    if (u_lamp.a > 0.0) {
      float pane = clamp((1.0 - texture2D(u_tone, uv).a) * 255.0 / 128.0, 0.0, 1.0) * g.a;
      float aLamp = lampCover * k * pane;
      gl_FragColor = vec4(u_lamp.rgb, 1.0) * aLamp + gl_FragColor * (1.0 - aLamp);
    }
  }`;

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });

// Toward a point in the sky in the plate's view: we face north with the photographer, so x is east,
// y the zenith and z (towards us) south.
function toward(a, b) {
  const ca = Math.cos(a * RAD);
  return [ca * Math.sin(b * RAD), Math.sin(a * RAD), -ca * Math.cos(b * RAD)];
}

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

async function printPlate(canvas, plate, palette) {
  const box = canvas.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(box.width * dpr);
  canvas.height = Math.round(box.height * dpr);
  const gl = canvas.getContext("webgl", {
    antialias: false,
    premultipliedAlpha: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error("no WebGL");
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
  const texture = (unit, filter, wrap) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  };
  const [geo, tone] = await Promise.all([
    loadImage(`${plate.assets}/geometry.webp`),
    loadImage(`${plate.assets}/tone.webp`),
  ]);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  texture(0, gl.LINEAR, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, geo);
  texture(1, gl.LINEAR, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tone);
  texture(2, gl.NEAREST, gl.REPEAT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, noise());
  gl.uniform1i(u.u_geo, 0);
  gl.uniform1i(u.u_tone, 1);
  gl.uniform1i(u.u_noise, 2);
  gl.uniform2f(u.u_size, ...plate.size);
  gl.uniform1f(u.u_relief, plate.relief);
  gl.uniform2f(u.u_res, canvas.width, canvas.height);
  gl.uniform1f(u.u_dpr, dpr);
  gl.uniform1f(u.u_sub, dpr < 1.5 ? 2 : 1);
  gl.uniform3f(u.u_sun, ...toward(alt, az));
  gl.uniform3f(u.u_glow, ...toward(18, az));
  gl.uniform1f(u.u_direct, Number(params.get("direct") ?? LIGHT.direct));
  gl.uniform1f(u.u_ambient, LIGHT.ambient);
  gl.uniform1f(u.u_glowShare, LIGHT.glowShare);
  gl.uniform1f(u.u_expose, 0.6);
  gl.uniform3f(u.u_y, palette.paperY, palette.darkY, palette.ivoryY);
  gl.uniform3f(u.u_dark, ...palette.dark);
  gl.uniform3f(u.u_ivory, ...palette.ivory);
  gl.uniform3f(u.u_olive, ...palette.olive);
  // As plate.js sets them for this palette: the night's inks thinner, the body a shade under the paper.
  const night = palette.inverted;
  gl.uniform3f(u.u_alpha, night ? 0.68 : 0.92, 0.8, 0.62 - 0.42 * palette.night);
  const b = night ? 0.42 : 0;
  gl.uniform4f(u.u_body, ...palette.paper.map((c) => c * 0.62 * b), b);
  const rust = Twilight.hex(night ? palette.vars["--rust-text"] : "#a0492a");
  gl.uniform4f(u.u_lamp, ...rust, LIGHT.lamp);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.finish();
}

// The line either side of the building, each half on two lines, as on the instrument card.
const line = params.get("line") ?? "";
const halves = [line.slice(0, line.indexOf(". ") + 1), line.slice(line.indexOf(". ") + 2)];
for (const [el, half] of [
  [document.querySelector(".wing--left"), halves[0]],
  [document.querySelector(".wing--right"), halves[1]],
]) {
  const at = half.lastIndexOf(" ");
  el.append(half.slice(0, at), document.createElement("br"), half.slice(at + 1));
}

done(
  (async () => {
    const palette = Twilight.page(LIGHT.palette);
    const mark = document.querySelector(".mark");
    mark.src = palette.inverted
      ? "/assets/brand/wordmark-small-dark.svg"
      : "/assets/brand/wordmark-small.svg";
    const plate = await fetch("/src/data/sphinx-plate.json").then((r) => r.json());
    // The art's box as tall as the card less a margin above, its foot on the bottom edge, and the
    // dome (500 units across the plate) on the card's centre line.
    const [bx, , bw, bh] = plate.box;
    const height = H - Number(params.get("top") ?? 70);
    const width = (height * bw) / bh;
    const art = document.querySelector(".sx__art");
    Object.assign(art.style, {
      width: `${width}px`,
      height: `${height}px`,
      top: `${H - height}px`,
      left: `${W / 2 - ((500 - bx) / bw) * width}px`,
    });
    await fonts();
    await Promise.all([printPlate(art.querySelector("canvas"), plate, palette), mark.decode()]);
  })(),
);
