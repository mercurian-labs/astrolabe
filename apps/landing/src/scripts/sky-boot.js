// Astrolabe · drafting · the page's light before it paints
//
// Layout.astro inlines this file, with sky.js, places.js and twilight.js, as a classic script in the
// head (imports and exports stripped), so a visit at night opens on a dark page with no flash of
// day. It sets the palette for the real sky now, or at `?t=` / `&tz=`; from then on the working
// astrolabe drives it (relight.js). Without script the page keeps the day palette in drafting.css.

import Places from "./places.js";
import Sky from "./sky.js";
import Twilight from "./twilight.js";

try {
  const { place, fixed } = Places.fromQuery(location.search);
  Twilight.page(Sky.sunAltitude(fixed || new Date(), place.lat, place.lon));
} catch {
  // The day palette stands.
}
