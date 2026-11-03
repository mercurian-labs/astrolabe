import "maplibre-gl/dist/maplibre-gl.css";

import type { WikiQueryResult } from "@t3tools/contracts";
import { LngLatBounds, Map as MapLibreMap, Marker, type StyleSpecification } from "maplibre-gl";
import { useEffect, useEffectEvent, useRef, useState } from "react";

type Row = WikiQueryResult["rows"][number];

// Obsidian's Maps plugin draws OpenFreeMap's styles unless a view names its own tiles.
const DEFAULT_STYLE = {
  light: "https://tiles.openfreemap.org/styles/bright",
  dark: "https://tiles.openfreemap.org/styles/dark",
};
const DEFAULT_HEIGHT = 400;
const DEFAULT_ZOOM = 4;

/** A view's tiles as a style: a style URL as given, raster tile templates made into one. */
function mapStyle(tiles: ReadonlyArray<string> | undefined, dark: boolean) {
  const urls = tiles?.filter(Boolean) ?? [];
  if (!urls.length) return dark ? DEFAULT_STYLE.dark : DEFAULT_STYLE.light;
  if (urls.length === 1 && !/\{[zxy]\}/.test(urls[0]!)) return urls[0]!;
  const style: StyleSpecification = {
    version: 8,
    sources: { tiles: { type: "raster", tiles: [...urls], tileSize: 256 } },
    layers: [{ id: "tiles", type: "raster", source: "tiles" }],
  };
  return style;
}

const centerOf = (text: string | undefined): [number, number] | undefined => {
  const [lat, lng] = (text ?? "").split(",").map((part) => Number.parseFloat(part));
  return lat !== undefined && lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng)
    ? [lng, lat]
    : undefined;
};

/**
 * A map view, as Obsidian's Maps plugin draws one: a marker per file with coordinates, in its
 * colour, opening the file when clicked. Loaded only when a map view shows.
 */
export default function WikiBaseMap({
  result,
  dark,
  openRow,
}: {
  readonly result: WikiQueryResult;
  readonly dark: boolean;
  readonly openRow: (row: Row) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const open = useEffectEvent((row: Row) => openRow(row));
  const settings = result.settings ?? {};
  const tiles = dark && settings.mapTilesDark?.length ? settings.mapTilesDark : settings.mapTiles;
  const style = JSON.stringify(mapStyle(tiles, dark));

  // oxlint-disable-next-line t3code/react-effect-budget -- the map is a WebGL canvas outside React
  useEffect(() => {
    if (!container.current) return;
    const center = centerOf(settings.center);
    const created = new MapLibreMap({
      container: container.current,
      style: JSON.parse(style) as string | StyleSpecification,
      center: center ?? [0, 0],
      zoom: settings.defaultZoom ?? DEFAULT_ZOOM,
      ...(settings.minZoom === undefined ? {} : { minZoom: settings.minZoom }),
      ...(settings.maxZoom === undefined ? {} : { maxZoom: settings.maxZoom }),
      attributionControl: { compact: true },
    });
    setMap(created);
    return () => {
      created.remove();
      setMap(null);
    };
  }, [style, settings.center, settings.defaultZoom, settings.minZoom, settings.maxZoom]);

  // oxlint-disable-next-line t3code/react-effect-budget -- markers live on the map, outside React
  useEffect(() => {
    const current = map;
    if (!current) return;
    for (const marker of markers.current) marker.remove();
    const placed = result.rows.filter((row) => row.marker !== undefined);
    markers.current = placed.map((row) => {
      const at = row.marker!;
      const marker = new Marker(at.color ? { color: at.color } : {})
        .setLngLat([at.lng, at.lat])
        .addTo(current);
      const element = marker.getElement();
      element.title = row.name;
      element.style.cursor = "pointer";
      element.addEventListener("click", () => open(row));
      return marker;
    });
    if (placed.length && centerOf(settings.center) === undefined) {
      const bounds = new LngLatBounds();
      for (const row of placed) bounds.extend([row.marker!.lng, row.marker!.lat]);
      current.fitBounds(bounds, { padding: 48, maxZoom: settings.maxZoom ?? 14, animate: false });
    }
  }, [map, result.rows, settings.center, settings.maxZoom]);

  const missing = result.rows.length - result.rows.filter((row) => row.marker).length;
  return (
    <div className="flex flex-col gap-2">
      <div
        ref={container}
        className="w-full overflow-hidden rounded-lg border border-border"
        style={{ height: settings.mapHeight ?? DEFAULT_HEIGHT }}
      />
      {!settings.coordinates ? (
        <p className="text-muted-foreground text-sm">
          Choose the property that holds each file's coordinates in the view's settings.
        </p>
      ) : missing > 0 ? (
        <p className="text-muted-foreground text-xs">
          {missing === 1 ? "1 file has no coordinates." : `${missing} files have no coordinates.`}
        </p>
      ) : null}
    </div>
  );
}
