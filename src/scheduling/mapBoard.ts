import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Area, Station } from "./rules";

export interface MapStation extends Station {
  warning?: boolean;
}

export interface StationMap {
  setSelected: (stationId: string | null) => void;
  setWarnings: (stationIds: Set<string>) => void;
  remove: () => void;
}

const MAP_WIDTH = 760;
const MAP_HEIGHT = 480;

const areaColors: Record<Area, string> = {
  东区: "#d8efff",
  西区: "#e7f7df",
  机场线: "#fff1d6"
};

function buildMapSvg() {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}">
    <defs>
      <pattern id="grid" width="38" height="38" patternUnits="userSpaceOnUse">
        <path d="M 38 0 L 0 0 0 38" fill="none" stroke="#eef3f8" stroke-width="1"/>
      </pattern>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#31506a" flood-opacity=".16"/>
      </filter>
    </defs>
    <rect width="760" height="480" fill="#f6f9fc"/>
    <rect width="760" height="480" fill="url(#grid)"/>
    <path d="M0 270 C95 230 178 246 272 205 C383 156 480 224 760 154 L760 480 L0 480Z" fill="#e7f0e8"/>
    <path d="M0 74 C132 36 234 76 342 48 C470 16 586 42 760 20 L760 0 L0 0Z" fill="#e3f0fa"/>
    <polygon points="344,480 502,272 760,344 760,480" fill="${areaColors.机场线}" opacity=".86"/>
    <path d="M80 0 C100 122 198 150 292 220 C342 258 370 338 384 480" fill="none" stroke="#aab8c7" stroke-width="18" stroke-linecap="round" opacity=".45"/>
    <path d="M0 326 C128 288 242 290 350 250 C478 204 584 222 760 174" fill="none" stroke="#aab8c7" stroke-width="16" stroke-linecap="round" opacity=".45"/>
    <path d="M458 0 C426 112 488 176 550 252 C608 322 632 390 650 480" fill="none" stroke="#aab8c7" stroke-width="14" stroke-linecap="round" opacity=".4"/>
    <path d="M30 42 L248 106 L330 214 L26 262Z" fill="${areaColors.东区}" stroke="#92c7ec" stroke-dasharray="7 7"/>
    <path d="M390 52 L728 96 L724 284 L478 258 L358 168Z" fill="${areaColors.西区}" stroke="#a8d39a" stroke-dasharray="7 7"/>
    <text x="70" y="38" fill="#28729e" font-size="22" font-weight="700">东区</text>
    <text x="536" y="66" fill="#4e8f3f" font-size="22" font-weight="700">西区</text>
    <text x="536" y="438" fill="#b87a18" font-size="22" font-weight="700">机场线</text>
    <g filter="url(#shadow)">
      <rect x="20" y="384" width="148" height="54" rx="12" fill="#ffffff" opacity=".92"/>
      <text x="38" y="408" fill="#536174" font-size="13">油枪 7 日内到期</text>
      <circle cx="42" cy="426" r="7" fill="#df5e45"/>
      <text x="58" y="431" fill="#536174" font-size="13">红色标记需尽快排期</text>
    </g>
  </svg>`;
}

function markerIcon(station: MapStation, selected: boolean) {
  const warningClass = station.warning ? " warning" : "";
  const selectedClass = selected ? " selected" : "";
  return L.divIcon({
    className: "",
    html: `<button type="button" class="station-marker${warningClass}${selectedClass}" aria-label="${station.name}">
      <span class="marker-label">${station.name}</span>
      <span class="marker-dot"></span>
    </button>`,
    iconSize: [118, 34],
    iconAnchor: [59, 32],
    popupAnchor: [0, -28]
  });
}

export function createStationMap(
  element: HTMLElement,
  initialStations: MapStation[],
  initialSelectedId: string | null,
  onSelect: (stationId: string) => void
): StationMap {
  const bounds = L.latLngBounds([0, 0], [MAP_HEIGHT, MAP_WIDTH]);
  const map = L.map(element, {
    crs: L.CRS.Simple,
    minZoom: -1.5,
    maxZoom: 2.4,
    zoomControl: false,
    attributionControl: false,
    scrollWheelZoom: false
  });

  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildMapSvg())}`;
  L.imageOverlay(svgUrl, bounds, { interactive: false }).addTo(map);
  map.fitBounds(bounds, { padding: [10, 10] });

  let selectedId = initialSelectedId;
  let warnings = new Set<string>();
  const markers = new Map<string, any>();

  function refreshMarker(station: MapStation) {
    const marker = markers.get(station.id);
    marker?.setIcon(markerIcon({ ...station, warning: warnings.has(station.id) }, selectedId === station.id));
  }

  for (const station of initialStations) {
    const marker = L.marker([station.mapY, station.mapX], {
      icon: markerIcon(station, selectedId === station.id),
      keyboard: true,
      title: station.name
    }).addTo(map);

    marker.on("click", () => onSelect(station.id));
    markers.set(station.id, marker);
  }

  return {
    setSelected(stationId) {
      const previous = selectedId;
      selectedId = stationId;
      if (previous) {
        const station = initialStations.find((item) => item.id === previous);
        if (station) refreshMarker(station);
      }
      if (stationId) {
        const station = initialStations.find((item) => item.id === stationId);
        if (station) refreshMarker(station);
      }
    },
    setWarnings(stationIds) {
      warnings = new Set(stationIds);
      initialStations.forEach(refreshMarker);
    },
    remove() {
      map.remove();
      markers.clear();
    }
  };
}
