// Astrolabe · drafting · the observatory plates, lit by the astrolabe's sun
//
// Four plates stand on the page: the Sphinx Observatory, La Silla's New Technology Telescope and Gemini
// North as chapter plates between sections, and the Pic du Midi Observatory in the close. Each is a building printed in the page's own print from a photograph (by astrolabe-site's
// scripts/observatories/), and each figure (Plate.astro) names its textures' folder, their size and
// relief: a geometry texture whose red and green carry the view-space normal's x (right) and y (up),
// whose blue carries the relative depth and whose alpha is the building and its rock; a tone texture
// with the photograph's dark detail (red), the recesses (green) and the albedo over two (blue: snow
// brighter than masonry, rock darker); and two line masks coloured by CSS. Each time the working
// astrolabe's moment changes (`astrolabe:time`), this shader lights the normals from its sun and prints
// them as relight.js prints Mercury: the building's brightness against the paper's, thresholded against
// fixed noise, dark ink where it is darker than the paper and ivory where it is lighter, the olive off
// register in the shadow side and the recesses, with the shadows the building casts on itself marched
// through the depth.
//
// The frame: we stand with our back to the sun's side of the sky, as the photographers did, so a
// northern observer faces north: the view's x is east, y the zenith, z (towards us) south, and a sun
// at azimuth A, altitude h lights the plate along (cos h sin A, sin h, −cos h cos A): morning from the
// right, noon from high in front, evening from the left. A southern observer faces south.
//
// Under the pointer an eyepiece opens onto the photograph itself in continuous tone (the duotone,
// registered texel for texel with the plate), coloured here from the page's palette: paper through
// olive to ink by day, charcoal through olive to ivory at night. It is drawn in the same pass; the
// drawn lines step out of it through CSS masks and a hairline ring frames it. With a fine
// pointer it opens like an iris on enter (0.45 s), follows the pointer exactly, closes on leave
// (0.35 s) and takes the cursor, which comes back over the credit's links, on leave, blur and a hidden
// tab. On touch a tap opens it there, a sideways drag moves it (vertical swipes scroll) and a tap
// elsewhere closes it. Its photograph loads on the first approach to its section, never with the page.
//
// After sunset the windows light up in the page's rust: the glass of their panes (packed into the tone
// texture's alpha by astrolabe-site's scripts/observatories/windows.py) is printed flat in rust, grain
// by grain like the other inks and under the drawn lines. The lamps come up through civil and nautical
// twilight and are full before the page's inks turn over at −10°; the eyepiece shows them lit too. Rust
// is the page's fill rust before the turn and its night rust (--rust-text) after it.
//
// Nothing of a plate loads until the page comes within 800 px of it: not its still print or line masks
// (drafting.css holds their masks back until .plate--near), not its textures, not its WebGL context.
// Each plate then has its own context, so a visit that never scrolls down makes none and the whole
// page makes four. One shared context would have to copy its drawing into each plate's canvas on every
// repaint; small contexts cost less than that and keep each plate's textures where it draws them. A
// plate that falls more than 800 px off screen shrinks its canvas to one pixel, giving back its drawing
// buffer (the largest thing it holds: about 7.6 MB for a 690 px square at DPR 2), and shows its still
// until it comes back; its textures stay, so coming back costs one draw, not a reload. Repaints happen
// only when the sun moves, the pointer moves or the iris turns, and only for a plate on screen in a
// visible tab. DPR is capped at 2. Without WebGL the static print (CSS masks under a mid-morning sun)
// shows and there is no eyepiece.

import Twilight from "./twilight.js";

(() => {
  const figures = document.querySelectorAll("[data-plate-assets]");
  if (!figures.length) return;
  const RAD = Math.PI / 180;
  const noGL = new URLSearchParams(location.search).get("gl") === "0";

  // The page's fill rust (drafting.css's --rust, which twilight.js never changes).
  const RUST = "#a0492a";
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  let sun = null; // { alt, az, south }, shared by every plate
  const plates = [...figures].map(mount);

  document.addEventListener("astrolabe:time", (event) => {
    const { sunAlt, sunAz, nowAlt, arriving, lat } = event.detail;
    // relight.js sets the page's palette from the same event; asking again only reads it back.
    const palette = Twilight.page(arriving ? nowAlt : sunAlt);
    // Between sunset and the flip the building is darker than the paper and reads by its outline; the
    // lines inside it fade (drafting.css) until the night brings them back in ivory.
    const dusk = (palette.inverted ? 0 : smooth(0.5, -4, sunAlt)).toFixed(3);
    for (const plate of plates) plate.figure.style.setProperty("--plate-dusk", dusk);
    const south = lat < 0;
    if (
      sun &&
      Math.abs(sun.alt - sunAlt) < 0.004 &&
      Math.abs(sun.az - sunAz) < 0.004 &&
      sun.south === south
    )
      return;
    sun = { alt: sunAlt, az: sunAz, south };
    for (const plate of plates) {
      plate.dirty = true;
      plate.paint();
    }
  });
  document.addEventListener("visibilitychange", () => {
    for (const plate of plates) plate.paint();
  });

  /* ─────────── WebGL, the same program for every plate. */

  const vertex = `
    attribute vec2 a_pos;
    void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

  const fragment = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform sampler2D u_geo;     // r, g: normal x, y (view); b: depth (near is high); a: the building
    uniform sampler2D u_tone;    // r: the photograph's dark detail; g: recess; b: albedo / 2;
                                 // a: 1 − the window panes × 128/255
    uniform sampler2D u_noise;   // 512 × 512 fixed thresholds: r ink, g olive, b the eyepiece's edge, a lamps
    uniform sampler2D u_duo;     // the eyepiece's photograph: luminance, registered with u_geo
    uniform vec2 u_res;          // canvas, device px
    uniform vec2 u_size;         // the data, texels
    uniform float u_dpr;
    uniform float u_sub;         // grains per device px along each axis (2 below DPR 1.5)
    uniform float u_relief;      // texels of rise for the whole depth range
    uniform vec3 u_sun;          // toward the sun, view space
    uniform vec3 u_glow;         // toward the glow over the sun, view space
    uniform float u_direct;      // the sun's share of the building's brightness
    uniform float u_ambient;     // the sky's share
    uniform float u_glowShare;   // how much of the skylight comes from the glow over the sun
    uniform float u_expose;      // direct light on a face that should print as clean paper
    uniform vec3 u_y;            // luminance of the paper, the dark ink, the ivory ink
    uniform vec3 u_dark;
    uniform vec3 u_ivory;
    uniform vec3 u_olive;
    uniform vec3 u_alpha;        // dark ink, ivory ink, olive
    uniform vec4 u_body;         // the night silhouette, premultiplied
    uniform vec4 u_lens;         // the aperture: centre (device px, GL), radius (device px), 1 once loaded
    uniform vec3 u_duoDark;      // the duotone's ends: shadows, highlights (the olive, softened, between)
    uniform vec3 u_duoLight;
    uniform vec4 u_lamp;         // the lamps' rust, and how far they are up (0 by day)

    const float DAY_Y = 0.947;   // the day paper's luminance; the building is measured against it

    vec3 normalOf(vec4 g) {
      vec3 n = vec3(g.rg * 2.0 - 1.0, 0.0);
      n.z = sqrt(max(0.0, 1.0 - dot(n.xy, n.xy)));
      return n;
    }

    void main() {
      vec2 uv = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_res;
      vec4 g = texture2D(u_geo, uv);
      // The olive plate, off register: a pixel and a half down and one to the right.
      vec2 shift = vec2(-1.0, -1.5) * u_dpr / u_res;
      vec4 g2 = texture2D(u_geo, uv + shift);
      if (g.a < 0.004 && g2.a < 0.004) {
        gl_FragColor = vec4(0.0);
        return;
      }
      vec3 n = normalOf(g);
      vec3 tone = texture2D(u_tone, uv).rgb;

      // The sun: Lambert, with the shadows the building casts on itself.
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
      // Skylight: the open sky over faces turned up, and the glow over the sun, which outlasts it.
      float sky = clamp(0.5 + 0.5 * n.y, 0.0, 1.0);
      sky *= sky;
      float glow = pow(max(dot(n, u_glow), 0.0), 1.5) * 1.3;
      float body = DAY_Y * (u_direct * lit / u_expose + u_ambient * mix(sky, glow, u_glowShare));
      body *= 1.0 - 0.8 * tone.r; // glass and deep reveals stay dark under any sky
      body *= 2.0 * tone.b; // snow is brighter than masonry and stays paper in light; rock is darker

      // The olive: recesses, and the side turned from the sun.
      vec3 n2 = normalOf(g2);
      float turned = (1.0 - smoothstep(0.1, 0.65, dot(n2, u_sun))) * (u_direct / 0.58);
      vec3 tone2 = texture2D(u_tone, uv + shift).rgb;
      float rock = clamp(1.0 - 2.0 * tone2.b, 0.0, 1.0) / 0.55;
      float olive = clamp(0.6 * tone2.g + 0.72 * turned + 0.3 * rock * turned, 0.0, 0.9);

      float paper = u_y.x;
      float dark = u_y.y < paper ? clamp((paper - body) / (paper - u_y.y), 0.0, 1.0) : 0.0;
      float light = u_y.z > paper ? clamp((body - paper) / (u_y.z - paper), 0.0, 1.0) : 0.0;
      // The paper's tooth: even a face square to the sun keeps a few grains, as the Mercury prints do.
      dark = max(pow(dark, 1.15) * 0.8, u_y.y < paper ? 0.035 : 0.0);

      // Grains at the print's resolution (two per CSS px), averaged where a device px holds several.
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

      // The eyepiece: inside the aperture the photograph in continuous tone. Its edge is decided grain
      // by grain over about a CSS px, so it is as crisp as the print and has the print's tooth.
      if (u_lens.w > 0.5 && u_lens.z > 0.5) {
        float edge = clamp((u_lens.z - length(gl_FragCoord.xy - u_lens.xy)) / (1.2 * u_dpr) + 0.5, 0.0, 1.0);
        float inside = step(texture2D(u_noise, (floor(gl_FragCoord.xy) + 0.5) / 512.0).b, edge);
        if (inside > 0.0) {
          float l = texture2D(u_duo, uv).r;
          vec3 mid = mix(u_olive, mix(u_duoDark, u_duoLight, 0.55), 0.3);
          vec3 c = l < 0.5 ? mix(u_duoDark, mid, smoothstep(0.0, 1.0, l / 0.5))
                           : mix(mid, u_duoLight, smoothstep(0.0, 1.0, (l - 0.5) / 0.5));
          gl_FragColor = vec4(c * g.a, g.a);
        }
      }

      // The lamps, over the print and the eyepiece alike.
      if (u_lamp.a > 0.0) {
        float pane = clamp((1.0 - texture2D(u_tone, uv).a) * 255.0 / 128.0, 0.0, 1.0) * g.a;
        float aLamp = lampCover * k * pane;
        gl_FragColor = vec4(u_lamp.rgb, 1.0) * aLamp + gl_FragColor * (1.0 - aLamp);
      }
    }`;

  const image = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  // The noise: seeded, so the print is the same grain on every visit (relight.js's), and on every plate.
  let noise = null;
  function grain() {
    if (noise) return noise;
    let seed = 0x2f6e2b1;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    noise = new Uint8Array(512 * 512 * 4);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(random() * 255) + 1;
    return noise;
  }

  // Brightness of the sky on the building through twilight, in units of the day paper: a pale facade
  // facing the glow stays lighter than the sky behind it well into civil twilight.
  const AMBIENT = [
    [6, 0.34],
    [0, 0.42],
    [-3, 0.36],
    [-6, 0.24],
    [-9, 0.11],
    [-12, 0.08],
    [-18, 0.12],
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

  // Toward a point in the sky at azimuth `az`, altitude `alt`, in the plate's view (top of file).
  function toward(alt, az, south) {
    const ca = Math.cos(alt * RAD);
    const east = ca * Math.sin(az * RAD);
    const north = ca * Math.cos(az * RAD);
    const up = Math.sin(alt * RAD);
    return south ? [-east, up, north] : [east, up, -north];
  }

  /* ─────────── One plate. */

  function mount(figure) {
    const sheet = figure.querySelector(".plate__sheet");
    const art = figure.querySelector(".plate__art");
    const canvas = figure.querySelector(".plate__canvas");
    const assets = figure.dataset.plateAssets;
    const size = figure.dataset.plateSize.split(" ").map(Number);
    const relief = Number(figure.dataset.plateRelief);
    const plate = { figure, dirty: true, paint() {} };
    const fallback = () => figure.classList.add("plate--still");
    if (!("IntersectionObserver" in window)) {
      figure.classList.add("plate--near");
      fallback();
      return plate;
    }

    let nearby = false;
    let visible = false;
    let draw = null;
    let gl = null;
    let dpr = 1;
    const u = {};
    const lens = { x: 0, y: 0, r: 0, loaded: false }; // art px

    plate.paint = () => {
      if (!draw || !sun || !plate.dirty || !nearby || !visible || document.hidden) return;
      plate.dirty = false;
      draw();
      figure.classList.add("plate--live");
    };

    new IntersectionObserver(
      ([entry]) => {
        nearby = entry.isIntersecting;
        if (nearby) figure.classList.add("plate--near");
        if (noGL || !canvas) return fallback();
        if (!gl) {
          if (nearby) start();
          return;
        }
        if (!draw) return; // still loading: its layout() reads `nearby`
        layout();
        if (!nearby) figure.classList.remove("plate--live");
        plate.dirty = true;
        plate.paint();
      },
      { rootMargin: "800px 0px" },
    ).observe(figure);
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      plate.paint();
    }).observe(canvas);

    const texture = (unit, filter, wrap) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    };

    function start() {
      gl = canvas.getContext("webgl", {
        antialias: false,
        depth: false,
        premultipliedAlpha: true,
        alpha: true,
      });
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
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );
      const position = gl.getAttribLocation(program, "a_pos");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
        const name = gl.getActiveUniform(program, i).name;
        u[name] = gl.getUniformLocation(program, name);
      }

      texture(2, gl.NEAREST, gl.REPEAT);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, grain());

      Promise.all([image(`${assets}/geometry.webp`), image(`${assets}/tone.webp`)])
        .then(([geo, tone]) => {
          gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          texture(0, gl.LINEAR, gl.CLAMP_TO_EDGE);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, geo);
          texture(1, gl.LINEAR, gl.CLAMP_TO_EDGE);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tone);
          gl.uniform1i(u.u_geo, 0);
          gl.uniform1i(u.u_tone, 1);
          gl.uniform1i(u.u_noise, 2);
          gl.uniform1i(u.u_duo, 3);
          gl.uniform2f(u.u_size, ...size);
          gl.uniform1f(u.u_relief, relief);
          gl.disable(gl.BLEND);
          draw = render;
          layout();
          new ResizeObserver(() => {
            layout();
            plate.dirty = true;
            plate.paint();
          }).observe(canvas);
          eyepiece();
          plate.dirty = true;
          plate.paint();
        })
        .catch(fallback);

      canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        draw = null;
        figure.classList.remove("plate--live");
        fallback();
      });
    }

    // Far from the screen the canvas is one pixel (top of file).
    function layout() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const box = canvas.getBoundingClientRect();
      canvas.width = nearby ? Math.max(1, Math.round(box.width * dpr)) : 1;
      canvas.height = nearby ? Math.max(1, Math.round(box.height * dpr)) : 1;
    }

    function render() {
      const { alt, az, south } = sun;
      const palette = Twilight.current() || Twilight.at(alt);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u.u_res, canvas.width, canvas.height);
      gl.uniform1f(u.u_dpr, dpr);
      gl.uniform1f(u.u_sub, dpr < 1.5 ? 2 : 1);
      gl.uniform3f(u.u_sun, ...toward(alt, az, south));
      gl.uniform3f(u.u_glow, ...toward(18, az, south));
      gl.uniform1f(u.u_direct, 0.58 * smooth(-0.8, 1, alt));
      gl.uniform1f(u.u_ambient, along(AMBIENT, alt));
      gl.uniform1f(u.u_glowShare, 0.25 + 0.55 * smooth(2, -3, alt) - 0.8 * smooth(-12, -19, alt));
      gl.uniform1f(u.u_expose, 0.6);
      gl.uniform3f(u.u_y, palette.paperY, palette.darkY, palette.ivoryY);
      gl.uniform3f(u.u_dark, ...palette.dark);
      gl.uniform3f(u.u_ivory, ...palette.ivory);
      gl.uniform3f(u.u_olive, ...palette.olive);
      // After sunset the building is lit only by the sky; its ink thins a little so the silhouette
      // keeps the side toward the glow instead of filling solid.
      gl.uniform3f(u.u_alpha, 0.92 - 0.24 * smooth(1, -5, alt), 0.8, 0.62 - 0.42 * palette.night);
      // Once the paper has turned dark, the building stands against it a shade darker still.
      const b = palette.inverted ? 0.42 : 0;
      gl.uniform4f(u.u_body, ...palette.paper.map((c) => c * 0.62 * b), b);
      gl.uniform4f(
        u.u_lens,
        lens.x * dpr,
        canvas.height - lens.y * dpr,
        lens.r * dpr,
        lens.loaded ? 1 : 0,
      );
      gl.uniform3f(u.u_duoDark, ...(palette.inverted ? palette.paper : palette.dark));
      gl.uniform3f(u.u_duoLight, ...(palette.inverted ? palette.ivory : palette.paper));
      // The lamps: up from just after sunset, full at −9°, a degree before the inks turn over.
      const rust = Twilight.hex(palette.inverted ? palette.vars["--rust-text"] : RUST);
      gl.uniform4f(u.u_lamp, ...rust, 0.96 * smooth(-0.5, -9, alt));
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /* ─────────── The eyepiece. */

    let duo = null;
    function loadDuotone() {
      duo ||= image(`${assets}/duotone.webp`).then((img) => {
        texture(3, gl.LINEAR, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, img);
        lens.loaded = true;
      });
      return duo;
    }

    function eyepiece() {
      const CONTROLS = "a[href], button, input, select, textarea, label, summary";
      const fine = matchMedia("(hover: hover) and (pointer: fine)");
      const still = matchMedia("(prefers-reduced-motion: reduce)");
      const ring = document.createElement("span");
      ring.className = "plate__eyepiece";
      ring.setAttribute("aria-hidden", "true");
      sheet.append(ring);
      sheet.classList.add("plate__sheet--eyepiece");
      const at = { x: 0, y: 0 }; // sheet px
      let open = 0; // the iris, 0 → 1
      let goal = 0;
      let from = 0;
      let started = 0;
      let raf = 0;

      const radius = () => Math.min(100, Math.max(55, sheet.clientWidth * 0.125));
      const frame = () => {
        if (!raf) raf = requestAnimationFrame(tick);
      };
      const to = (next, now = false) => {
        if (goal === next && !now) return;
        goal = next;
        from = open;
        started = performance.now();
        if (now || still.matches) open = goal;
        frame();
      };
      const close = (now = false) => {
        sheet.classList.remove("takes-cursor");
        to(0, now);
      };
      const track = (e, tap = false) => {
        const touch = e.pointerType !== "mouse" && e.pointerType !== "pen";
        if (!touch && !fine.matches) return;
        if (touch && !tap && !goal) return; // a touch only moves an eyepiece it opened
        if (e.target.closest?.(CONTROLS)) return close();
        const box = sheet.getBoundingClientRect();
        at.x = e.clientX - box.left;
        at.y = e.clientY - box.top;
        sheet.classList.toggle("takes-cursor", !touch);
        loadDuotone().then(() => to(1));
        frame();
      };
      function tick() {
        raf = 0;
        if (open !== goal) {
          const t = Math.min(1, (performance.now() - started) / (goal ? 450 : 350));
          open = t >= 1 ? goal : from + (goal - from) * (1 - (1 - t) ** 3);
          if (t < 1) frame();
        }
        const r = radius() * open;
        const s = sheet.getBoundingClientRect();
        const a = art.getBoundingClientRect();
        lens.x = at.x - (a.left - s.left);
        lens.y = at.y - (a.top - s.top);
        lens.r = r;
        sheet.classList.toggle("is-looking", r > 0.5);
        art.style.setProperty("--lens", `${lens.x}px ${lens.y}px`);
        sheet.style.setProperty("--lens-r", `${r}px`);
        // The ring is sized, not scaled, so its hairline stays a hairline through the iris.
        ring.style.width = ring.style.height = `${2 * r}px`;
        ring.style.transform = `translate(${at.x - r}px, ${at.y - r}px)`;
        plate.dirty = true;
        plate.paint();
      }

      // The section's own approach fetches the photograph, before the pointer reaches the plate.
      figure
        .closest("section, .chapter")
        ?.addEventListener("pointerover", () => loadDuotone(), { once: true });
      sheet.addEventListener("pointerenter", (e) => track(e));
      sheet.addEventListener("pointermove", (e) => track(e));
      sheet.addEventListener("pointerleave", (e) => {
        if (e.pointerType !== "touch") close();
      });
      sheet.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "mouse") track(e, true);
      });
      document.addEventListener("pointerdown", (e) => {
        if (!sheet.contains(e.target)) close();
      });
      addEventListener("blur", () => close(true));
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) close(true);
      });
    }

    return plate;
  }
})();
