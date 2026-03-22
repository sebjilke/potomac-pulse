// Potomac Pulse — Map (Leaflet) initialization and controls
// Extracted from index.html inline script

import L from 'leaflet';
import { LF, GAUGES, BRANCHES, GREAT_FALLS } from '../model/constants.js';
import { map, setMap, markers } from '../state/store.js';
import { popup } from '../ui/gauges-ui.js';

// ==================== NHD RIVER STYLING ====================

// Color rivers by name to match existing branch color scheme
function nhdColor(name) {
    if (!name) return '#475569';
    if (name === 'Potomac River') return '#2563eb';
    if (name === 'North Branch Potomac River') return '#0891b2';
    if (name.startsWith('South Branch Potomac')) return '#7c3aed';
    if (name === 'Shenandoah River') return '#c026d3';
    if (name === 'Monocacy River' || name === 'Goose Creek' || name === 'Seneca Creek') return '#dc2626';
    if (name === 'Cacapon River' || name === 'Conococheague Creek' || name === 'Antietam Creek') return '#059669';
    return '#475569';
}

function nhdStyle(feature) {
    const name = feature.properties.gnis_name || '';
    const order = feature.properties.streamorde || 3;
    return {
        color: nhdColor(name),
        weight: Math.max(0.8, order * 0.45),
        opacity: 0.75
    };
}

// Load NHD river GeoJSON from static asset, add behind markers
function loadNHDRivers(mapInstance) {
    fetch('/potomac-nhd.geojson')
        .then(r => r.json())
        .then(data => {
            L.geoJSON(data, { style: nhdStyle }).addTo(mapInstance).bringToBack();
        })
        .catch(err => console.warn('NHD rivers failed to load:', err));
}

// ==================== MAP FUNCTIONS ====================

export function panTo(id) {
    const g = GAUGES[id];
    if (g && map) {
        map.setView([g.lat, g.lon], 10);
        if (markers[id]) markers[id].openPopup();
    }
}

export function initMap() {
    // Add loading overlay
    const mapEl = document.getElementById('map');
    const overlay = document.createElement('div');
    overlay.className = 'map-loading-overlay';
    overlay.innerHTML = '<div class="map-loading-spinner"></div>';
    mapEl.appendChild(overlay);

    const mapInstance = L.map("map").setView([39.2, -77.8], 8);
    setMap(mapInstance);

    const tileLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: 'Tiles © Esri — Esri, DeLorme, NAVTEQ, TomTom, USGS, NPS'
    }).addTo(mapInstance);

    tileLayer.on('load', () => overlay.classList.add('hidden'));
    tileLayer.on('loading', () => overlay.classList.remove('hidden'));

    // NHD rivers (async, added behind markers via bringToBack)
    loadNHDRivers(mapInstance);

    // Gauges
    for (const [id, g] of Object.entries(GAUGES)) {
        const bk = Object.entries(BRANCHES).find(([k,v]) => v.ids?.includes(id))?.[0] || "target";
        const color = bk === "target" ? "#f97316" : BRANCHES[bk]?.color || "#60a5fa";
        const size = Math.round(4 + Math.sqrt(g.pctLF) * 0.85);

        const icon = L.divIcon({
            className: "",
            html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4);"></div>`,
            iconSize: [size, size],
            iconAnchor: [size/2, size/2]
        });

        markers[id] = L.marker([g.lat, g.lon], { icon }).addTo(mapInstance);
        markers[id].bindPopup(popup(id, g, color, bk));
    }

    // Target marker special
    markers[LF.id].setZIndexOffset(1000);

    // Great Falls virtual marker (estimated gauge - dashed border style)
    const gfSize = Math.round(4 + Math.sqrt(GREAT_FALLS.pctLF) * 0.85);
    const gfIcon = L.divIcon({
        className: "",
        html: `<div style="width:${gfSize}px;height:${gfSize}px;background:#06b6d4;border-radius:50%;border:2px dashed white;box-shadow:0 1px 3px rgba(0,0,0,0.4);"></div>`,
        iconSize: [gfSize, gfSize],
        iconAnchor: [gfSize/2, gfSize/2]
    });
    markers[GREAT_FALLS.id] = L.marker([GREAT_FALLS.lat, GREAT_FALLS.lon], { icon: gfIcon }).addTo(mapInstance);
    markers[GREAT_FALLS.id].bindPopup(`
        <div style="min-width:180px;">
            <div style="font-weight:600;color:#06b6d4;border-bottom:2px solid #06b6d4;padding-bottom:4px;margin-bottom:6px;">
                🌊 ${GREAT_FALLS.name}
            </div>
            <div style="font-size:0.7rem;color:#64748b;margin-bottom:8px;">
                <em>Estimated (No USGS gauge)</em>
            </div>
            <div id="gf-popup-values" style="font-size:0.85rem;">
                <span style="color:#60a5fa;font-weight:600;" id="gf-popup-cfs">-- cfs</span>
                <span style="color:#64748b;margin:0 5px;">|</span>
                <span style="color:#4ade80;font-weight:600;" id="gf-popup-stage">-- ft</span>
            </div>
            <div style="font-size:0.65rem;color:#94a3b8;margin-top:6px;">
                Ensemble blend: PoR + EF models
            </div>
        </div>
    `);

    // Add legend
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'map-legend');
        div.innerHTML = `
            <div class="map-legend-title">Legend</div>
            <div class="map-legend-item">
                <div class="map-legend-dot target" style="background:#f97316;"></div>
                <span>Little Falls (Target)</span>
            </div>
            <div class="map-legend-item">
                <div class="map-legend-dot" style="background:#06b6d4;border:1px dashed #fff;"></div>
                <span>Great Falls (Est.)</span>
            </div>
            <div class="map-legend-item">
                <div class="map-legend-line" style="background:#2563eb;"></div>
                <span>Mainstem</span>
            </div>
            <div class="map-legend-item">
                <div class="map-legend-line" style="background:#0891b2;"></div>
                <span>North Branch</span>
            </div>
            <div class="map-legend-item">
                <div class="map-legend-line" style="background:#7c3aed;"></div>
                <span>South Branch</span>
            </div>
            <div class="map-legend-item">
                <div class="map-legend-line" style="background:#c026d3;"></div>
                <span>Shenandoah</span>
            </div>
            <div class="map-legend-item">
                <div class="map-legend-line" style="background:#dc2626;"></div>
                <span>Below Pt Rocks</span>
            </div>
            <div class="map-legend-item">
                <div class="map-legend-line" style="background:#059669;"></div>
                <span>Tributaries</span>
            </div>
        `;
        return div;
    };
    legend.addTo(mapInstance);
}

// ==================== MAP VISIBILITY ====================

// Tab switching - map now hidden by default on all tabs, use toggle button to show
export function updateMapVisibility(tabName) {
    const btn = document.getElementById('mapToggleBtn');
    // Map is always hidden by default on tab switch - user must toggle it on
    document.body.classList.remove('show-map');
    if (btn) {
        btn.setAttribute('aria-pressed', 'false');
        btn.classList.remove('active');
    }
}

// Manual map toggle button
export function toggleMap() {
    const btn = document.getElementById('mapToggleBtn');
    const show = document.body.classList.toggle('show-map');
    btn.setAttribute('aria-pressed', show);
    btn.classList.toggle('active', show);
    if (map && show) map.invalidateSize();
}
