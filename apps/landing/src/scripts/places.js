// Astrolabe · drafting · where the visitor probably is
//
// The hero instrument is set for the visitor's latitude. The time zone is the only hint we take (never
// the geolocation API): a zone in this table names its city; any other zone gets the city in the same
// region whose longitude best matches the zone's offset from UTC; with no zone at all, Greenwich.

const Places = (() => {
  // IANA zone: [city, latitude, longitude east].
  const TABLE = {
    "America/Los_Angeles": ["Los Angeles", 34.05, -118.24],
    "America/Vancouver": ["Vancouver", 49.28, -123.12],
    "America/Tijuana": ["Tijuana", 32.51, -117.04],
    "America/Phoenix": ["Phoenix", 33.45, -112.07],
    "America/Denver": ["Denver", 39.74, -104.99],
    "America/Edmonton": ["Edmonton", 53.55, -113.49],
    "America/Boise": ["Boise", 43.62, -116.2],
    "America/Chicago": ["Chicago", 41.88, -87.63],
    "America/Winnipeg": ["Winnipeg", 49.9, -97.14],
    "America/Mexico_City": ["Mexico City", 19.43, -99.13],
    "America/Monterrey": ["Monterrey", 25.69, -100.32],
    "America/New_York": ["New York", 40.71, -74.01],
    "America/Detroit": ["Detroit", 42.33, -83.05],
    "America/Toronto": ["Toronto", 43.65, -79.38],
    "America/Montreal": ["Montreal", 45.5, -73.57],
    "America/Halifax": ["Halifax", 44.65, -63.58],
    "America/St_Johns": ["St. John's", 47.56, -52.71],
    "America/Anchorage": ["Anchorage", 61.22, -149.9],
    "Pacific/Honolulu": ["Honolulu", 21.31, -157.86],
    "America/Bogota": ["Bogotá", 4.71, -74.07],
    "America/Lima": ["Lima", -12.05, -77.04],
    "America/Caracas": ["Caracas", 10.48, -66.9],
    "America/Santiago": ["Santiago", -33.45, -70.67],
    "America/Argentina/Buenos_Aires": ["Buenos Aires", -34.6, -58.38],
    "America/Buenos_Aires": ["Buenos Aires", -34.6, -58.38],
    "America/Sao_Paulo": ["São Paulo", -23.55, -46.63],
    "America/Montevideo": ["Montevideo", -34.9, -56.16],
    "America/Panama": ["Panama City", 8.98, -79.52],
    "America/Puerto_Rico": ["San Juan", 18.47, -66.11],
    "Atlantic/Reykjavik": ["Reykjavík", 64.15, -21.94],
    "Europe/London": ["London", 51.51, -0.13],
    "Europe/Dublin": ["Dublin", 53.35, -6.26],
    "Europe/Lisbon": ["Lisbon", 38.72, -9.14],
    "Europe/Madrid": ["Madrid", 40.42, -3.7],
    "Europe/Paris": ["Paris", 48.86, 2.35],
    "Europe/Brussels": ["Brussels", 50.85, 4.35],
    "Europe/Amsterdam": ["Amsterdam", 52.37, 4.9],
    "Europe/Berlin": ["Berlin", 52.52, 13.4],
    "Europe/Zurich": ["Zürich", 47.38, 8.54],
    "Europe/Rome": ["Rome", 41.9, 12.5],
    "Europe/Vienna": ["Vienna", 48.21, 16.37],
    "Europe/Prague": ["Prague", 50.08, 14.44],
    "Europe/Copenhagen": ["Copenhagen", 55.68, 12.57],
    "Europe/Oslo": ["Oslo", 59.91, 10.75],
    "Europe/Stockholm": ["Stockholm", 59.33, 18.07],
    "Europe/Warsaw": ["Warsaw", 52.23, 21.01],
    "Europe/Budapest": ["Budapest", 47.5, 19.04],
    "Europe/Helsinki": ["Helsinki", 60.17, 24.94],
    "Europe/Athens": ["Athens", 37.98, 23.73],
    "Europe/Bucharest": ["Bucharest", 44.43, 26.1],
    "Europe/Kyiv": ["Kyiv", 50.45, 30.52],
    "Europe/Kiev": ["Kyiv", 50.45, 30.52],
    "Europe/Istanbul": ["Istanbul", 41.01, 28.98],
    "Europe/Moscow": ["Moscow", 55.76, 37.62],
    "Africa/Casablanca": ["Casablanca", 33.57, -7.59],
    "Africa/Lagos": ["Lagos", 6.52, 3.38],
    "Africa/Cairo": ["Cairo", 30.04, 31.24],
    "Africa/Nairobi": ["Nairobi", -1.29, 36.82],
    "Africa/Johannesburg": ["Johannesburg", -26.2, 28.05],
    "Asia/Jerusalem": ["Jerusalem", 31.77, 35.21],
    "Asia/Tel_Aviv": ["Tel Aviv", 32.09, 34.78],
    "Asia/Dubai": ["Dubai", 25.2, 55.27],
    "Asia/Riyadh": ["Riyadh", 24.71, 46.68],
    "Asia/Tehran": ["Tehran", 35.69, 51.39],
    "Asia/Karachi": ["Karachi", 24.86, 67.0],
    "Asia/Kolkata": ["Mumbai", 19.08, 72.88],
    "Asia/Calcutta": ["Mumbai", 19.08, 72.88],
    "Asia/Kathmandu": ["Kathmandu", 27.72, 85.32],
    "Asia/Dhaka": ["Dhaka", 23.81, 90.41],
    "Asia/Bangkok": ["Bangkok", 13.76, 100.5],
    "Asia/Jakarta": ["Jakarta", -6.21, 106.85],
    "Asia/Ho_Chi_Minh": ["Ho Chi Minh City", 10.82, 106.63],
    "Asia/Singapore": ["Singapore", 1.35, 103.82],
    "Asia/Kuala_Lumpur": ["Kuala Lumpur", 3.14, 101.69],
    "Asia/Manila": ["Manila", 14.6, 120.98],
    "Asia/Shanghai": ["Shanghai", 31.23, 121.47],
    "Asia/Hong_Kong": ["Hong Kong", 22.32, 114.17],
    "Asia/Taipei": ["Taipei", 25.03, 121.57],
    "Asia/Seoul": ["Seoul", 37.57, 126.98],
    "Asia/Tokyo": ["Tokyo", 35.68, 139.69],
    "Australia/Perth": ["Perth", -31.95, 115.86],
    "Australia/Adelaide": ["Adelaide", -34.93, 138.6],
    "Australia/Darwin": ["Darwin", -12.46, 130.84],
    "Australia/Brisbane": ["Brisbane", -27.47, 153.03],
    "Australia/Sydney": ["Sydney", -33.87, 151.21],
    "Australia/Melbourne": ["Melbourne", -37.81, 144.96],
    "Australia/Hobart": ["Hobart", -42.88, 147.33],
    "Pacific/Auckland": ["Auckland", -36.85, 174.76],
  };
  const GREENWICH = { zone: "Europe/London", city: "Greenwich", lat: 51.48, lon: 0 };

  // Minutes east of UTC for a zone at an instant.
  function offsetMinutes(zone, date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    }).formatToParts(date);
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    const wall = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    return Math.round((wall - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  }

  function guess(zone) {
    try {
      zone ||= Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      zone = "";
    }
    if (!zone || /^(UTC|GMT|Etc\/)/.test(zone)) return { ...GREENWICH, zone: zone || "UTC" };
    const hit = TABLE[zone];
    if (hit) return { zone, city: hit[0], lat: hit[1], lon: hit[2] };
    // Not in the table: the city of the same region nearest the zone's standard meridian. January and
    // July offsets differ by daylight saving; the smaller is standard time.
    let lon = null;
    try {
      const year = new Date().getUTCFullYear();
      const standard = Math.min(
        offsetMinutes(zone, new Date(Date.UTC(year, 0, 1))),
        offsetMinutes(zone, new Date(Date.UTC(year, 6, 1))),
      );
      lon = standard / 4;
    } catch {
      return GREENWICH;
    }
    const region = zone.split("/")[0];
    let best = null;
    for (const [key, [city, lat, cityLon]] of Object.entries(TABLE)) {
      if (key.split("/")[0] !== region) continue;
      const d = Math.abs(cityLon - lon);
      if (!best || d < best.d) best = { d, city, lat, lon: cityLon };
    }
    return best ? { zone, city: best.city, lat: best.lat, lon: best.lon } : { ...GREENWICH, zone };
  }

  // The instant at which a wall-clock time ("2026-10-21T21:30") falls in `zone`.
  function wallToDate(wall, zone) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(wall);
    if (!m) {
      const parsed = new Date(wall);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0), +(m[6] || 0));
    let t = asUtc;
    for (let i = 0; i < 3; i++) t = asUtc - offsetMinutes(zone, new Date(t)) * 60000;
    return new Date(t);
  }

  // Where and when a page address asks for: `?t=2026-10-21T21:30` (a wall time in the zone) and
  // `&tz=Area/City` fix both for testing; without `t`, `fixed` is null and the moment is now.
  function fromQuery(search) {
    const params = new URLSearchParams(search);
    const place = guess(params.get("tz") || undefined);
    const zone = place.zone && !/^(UTC|GMT|Etc\/)/.test(place.zone) ? place.zone : "UTC";
    const fixed = params.get("t") ? wallToDate(params.get("t"), zone) : null;
    return { place, zone, fixed };
  }

  return { guess, wallToDate, offsetMinutes, fromQuery };
})();

export default Places;
