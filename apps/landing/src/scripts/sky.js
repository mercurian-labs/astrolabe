// Astrolabe · drafting · the sky
//
// The maths behind the hero instrument, kept apart from the drawing so it can be checked on its own
// (`node` can import this file). Angles are degrees, times are Dates (UTC inside). Accuracy is what
// an astrolabe can show and better: sidereal time to well under a second, the sun to about 0.01°,
// star places precessed to the date. Altitudes are geometric, with no refraction.

const Sky = (() => {
  const RAD = Math.PI / 180;
  const sin = (d) => Math.sin(d * RAD);
  const cos = (d) => Math.cos(d * RAD);
  const tan = (d) => Math.tan(d * RAD);
  const deg = (r) => r / RAD;
  const wrap360 = (d) => ((d % 360) + 360) % 360;
  const wrap180 = (d) => wrap360(d + 180) - 180;
  const SIDEREAL_DAY_DEG = 360.98564736629;

  const julian = (date) => date.getTime() / 86400000 + 2440587.5;

  // Greenwich mean sidereal time (Meeus 12.4), from UT; UTC is within a second of it.
  function gmst(date) {
    const d = julian(date) - 2451545;
    const t = d / 36525;
    return wrap360(
      280.46061837 + SIDEREAL_DAY_DEG * d + 0.000387933 * t * t - (t * t * t) / 38710000,
    );
  }

  // The sun from the Astronomical Almanac's low-precision formulae, good to 0.01° this century.
  // `eot` is the equation of time in minutes: apparent minus mean solar time.
  function sun(date) {
    const n = julian(date) - 2451545;
    const L = wrap360(280.46 + 0.9856474 * n);
    const g = wrap360(357.528 + 0.9856003 * n);
    const lon = wrap360(L + 1.915 * sin(g) + 0.02 * sin(2 * g));
    const eps = obliquity(date);
    const ra = wrap360(deg(Math.atan2(cos(eps) * sin(lon), cos(lon))));
    const dec = deg(Math.asin(sin(eps) * sin(lon)));
    return { lon, ra, dec, eps, eot: 4 * wrap180(L - ra) };
  }

  const obliquity = (date) => 23.439 - 0.0000004 * (julian(date) - 2451545);

  // J2000 places, moved to the date with the first-order precession terms (good to an arcminute
  // for decades, which is finer than the drawing).
  function precess([ra, dec], date) {
    const years = (julian(date) - 2451545) / 365.25;
    const dRa = ((3.075 + 1.336 * sin(ra) * tan(dec)) * years) / 240;
    const dDec = (20.04 * cos(ra) * years) / 3600;
    return [wrap360(ra + dRa), dec + dDec];
  }

  // Horizon coordinates for an hour angle and declination at latitude `lat`. Azimuth runs from
  // north through east.
  function altAz(ha, dec, lat) {
    const alt = deg(Math.asin(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(ha)));
    const az = wrap360(
      deg(Math.atan2(-cos(dec) * sin(ha), sin(dec) * cos(lat) - cos(dec) * cos(ha) * sin(lat))),
    );
    return { alt, az };
  }

  // The inverse: the hour angle and declination of a point at altitude and azimuth.
  function equatorial(alt, az, lat) {
    const dec = deg(Math.asin(sin(lat) * sin(alt) + cos(lat) * cos(alt) * cos(az)));
    const ha = wrap360(
      deg(Math.atan2(-cos(alt) * sin(az), cos(lat) * sin(alt) - sin(lat) * cos(alt) * cos(az))),
    );
    return { ha, dec };
  }

  // The plate's projection, as astrolabes are made: stereographic from the pole opposite the
  // observer's onto the equator, which has radius 1. North of the equator that is from the south
  // pole, with the north pole at the centre; `hemi` is 1 there and -1 in the south, where the
  // instrument is the mirror image. Hour angle 0 (the meridian, where the sun stands at noon) is
  // straight up, and the sky turns clockwise in the north. y grows downward, as in SVG.
  function toPlate(ha, dec, hemi) {
    const r = tan((90 - hemi * dec) / 2);
    const a = hemi * ha;
    return { x: r * sin(a), y: -r * cos(a) };
  }

  function fromPlate(x, y, hemi) {
    const r = Math.hypot(x, y);
    const dec = hemi * (90 - 2 * deg(Math.atan(r)));
    const ha = wrap360(hemi * deg(Math.atan2(x, -y)));
    return { ha, dec };
  }

  // An almucantar (circle of equal altitude) on the plate: its centre's y and its radius. It is
  // symmetric about the meridian, so the two meridian crossings fix it. Angles here are measured
  // from the plate's pole along the meridian, positive toward the top of the plate.
  function almucantar(alt, lat) {
    const phi = Math.abs(lat);
    const top = tan((180 - phi - alt) / 2);
    const bottom = tan((alt - phi) / 2);
    return { cy: -(top + bottom) / 2, r: Math.abs(top - bottom) / 2 };
  }

  // Plate radius of a declination circle (the equator is 1).
  const decRadius = (dec, hemi) => tan((90 - hemi * dec) / 2);

  // Local sidereal time; `lon` east positive.
  const lst = (date, lon) => wrap360(gmst(date) + lon);

  const msPerSiderealDegree = 86400000 / SIDEREAL_DAY_DEG;

  return {
    RAD,
    sin,
    cos,
    tan,
    wrap360,
    wrap180,
    julian,
    gmst,
    lst,
    sun,
    obliquity,
    precess,
    altAz,
    equatorial,
    toPlate,
    fromPlate,
    almucantar,
    decRadius,
    msPerSiderealDegree,
  };
})();

export default Sky;
