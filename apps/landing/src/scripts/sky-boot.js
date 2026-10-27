// Astrolabe · drafting · the page's light before it paints. Layout.astro inlines this file (with
// sky.js, places.js and twilight.js, imports stripped) as a classic head script, so a night visit
// opens dark with no flash of day. It sets the palette for now or `?t=` / `&tz=`; then relight.js
// drives it. Without script the page keeps drafting.css's day palette.

import Places from "./places.js";
import Sky from "./sky.js";
import Twilight from "./twilight.js";

try {
  const { place, fixed } = Places.fromQuery(location.search);
  Twilight.page(Sky.sunAltitude(fixed || new Date(), place.lat, place.lon));
} catch {
  // The day palette stands.
}
