// Potomac Pulse — Map (Leaflet) initialization and controls
// Extracted from index.html inline script

import L from 'leaflet';
import { LF, GAUGES, BRANCHES, GREAT_FALLS } from '../model/constants.js';
import { map, setMap, markers } from '../state/store.js';
import { popup } from '../ui/gauges-ui.js';

// ==================== RIVERS CONSTANT ====================

const RIVERS = [
    // Potomac Mainstem - follows actual river path, ends at Little Falls
    { name: "Potomac Mainstem", color: "#2563eb", weight: 3, coords: [
        [39.62, -78.76],     // Cumberland
        [39.53, -78.46],     // South Branch confluence
        [39.697, -78.182],   // Hancock (Little Tonoloway)
        [39.626, -78.017],   // Big Pool
        [39.606, -78.011],   // Fort Frederick
        [39.608, -77.969],   // McCoys Ferry
        [39.45, -77.82],     // Shepherdstown area
        [39.323, -77.730],   // Harpers Ferry
        [39.273, -77.541],   // Point of Rocks
        [39.224, -77.452],   // Monocacy Aqueduct
        [39.154, -77.520],   // Whites Ferry
        [39.103, -77.474],   // Edwards Ferry
        [39.071, -77.341],   // Seneca Landing
        [39.018, -77.245],   // Riverbend Park
        [38.998, -77.252],   // Great Falls
        [38.975, -77.228],   // Mather Gorge
        [38.962, -77.197],   // Widewater
        [38.955, -77.160],   // Cabin John Creek area
        [38.950, -77.128]    // Little Falls (terminus)
    ]},
    // North Branch - Kitzmiller to Cumberland
    { name: "North Branch", color: "#0891b2", weight: 2, coords: [
        [39.394, -79.182],   // Kitzmiller
        [39.445, -79.111],   // Barnum
        [39.479, -79.065],   // Luke
        [39.62, -78.76]      // Cumberland (confluence)
    ]},
    // South Branch - Franklin gauge to confluence
    { name: "South Branch", color: "#7c3aed", weight: 2, coords: [
        [38.6428, -79.3306], // Franklin (gauge)
        [38.755, -79.260],   // Upper Tract
        [38.860, -79.195],   // Smoke Hole area
        [38.9926, -79.1239], // Petersburg (gauge)
        [39.120, -78.980],   // Moorefield
        [39.280, -78.780],   // Junction area
        [39.45, -78.65],     // Romney area
        [39.53, -78.46]      // Confluence with mainstem
    ]},
    // Shenandoah - Front Royal gauge to Harpers Ferry
    { name: "Shenandoah", color: "#c026d3", weight: 2, coords: [
        [38.914, -78.211],   // Front Royal (gauge)
        [38.983, -78.101],   // Bentonville
        [39.063, -78.030],   // Overall Run
        [39.134, -77.962],   // Compton Rapids area
        [39.200, -77.870],   // Berryville area
        [39.282, -77.789],   // Millville (gauge)
        [39.310, -77.756],   // Bloomery
        [39.323, -77.730]    // Harpers Ferry (confluence)
    ]},
    // Monocacy - Jug Bridge gauge to Potomac
    { name: "Monocacy", color: "#dc2626", weight: 1.5, coords: [
        [39.403, -77.366],   // Jug Bridge (gauge)
        [39.224, -77.452]    // Confluence at Monocacy Aqueduct
    ]},
    // Cacapon - Great Cacapon to confluence
    { name: "Cacapon", color: "#059669", weight: 1.5, coords: [
        [39.582, -78.305],   // Great Cacapon
        [39.53, -78.46]      // Confluence
    ]},
    // Conococheague - gauge to Potomac
    { name: "Conococheague", color: "#059669", weight: 1.5, coords: [
        [39.6510, -77.9239], // Conococheague gauge
        [39.60, -77.92]      // Confluence near Williamsport
    ]},
    // Antietam Creek - Sharpsburg to Potomac
    { name: "Antietam", color: "#f59e0b", weight: 1.5, coords: [
        [39.450, -77.730],   // Sharpsburg
        [39.45, -77.82]      // Confluence near Shepherdstown
    ]},
    // Goose Creek - gauge to confluence
    { name: "Goose Creek", color: "#10b981", weight: 1.5, coords: [
        [39.0559, -77.5191], // Goose Creek gauge
        [39.103, -77.474]    // Confluence near Edwards Ferry
    ]},
    // Seneca Creek - Dawsonville to Potomac
    { name: "Seneca Creek", color: "#6366f1", weight: 1.5, coords: [
        [39.128, -77.336],   // Dawsonville
        [39.071, -77.341]    // Confluence at Seneca Landing
    ]}
];

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

    const tileLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        attribution: '© OpenStreetMap © CARTO'
    }).addTo(mapInstance);

    tileLayer.on('load', () => overlay.classList.add('hidden'));
    tileLayer.on('loading', () => overlay.classList.remove('hidden'));

    // Rivers
    for (const r of RIVERS) {
        L.polyline(r.coords, { color: r.color, weight: r.weight, opacity: 0.7 }).addTo(mapInstance);
    }

    // Gauges
    for (const [id, g] of Object.entries(GAUGES)) {
        const bk = Object.entries(BRANCHES).find(([k,v]) => v.ids?.includes(id))?.[0] || "target";
        const color = bk === "target" ? "#f97316" : BRANCHES[bk]?.color || "#60a5fa";
        const size = id === LF.id ? 12 : 8;

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
    const gfIcon = L.divIcon({
        className: "",
        html: `<div style="width:10px;height:10px;background:#06b6d4;border-radius:50%;border:2px dashed white;box-shadow:0 1px 3px rgba(0,0,0,0.4);"></div>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5]
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
