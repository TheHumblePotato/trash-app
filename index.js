const FALLBACK_LAT = 47.67891;
const FALLBACK_LNG = -122.33787;
const HALF_MILE_ZOOM_LEVEL = 17; // Zoom level for 0.5 mile radius

const OVERPASS_API = "https://overpass-api.de/api/interpreter";

let map;
let trashCanLayer = L.featureGroup();
let userLocationMarker;
let userHeadingLayer = L.featureGroup(); // Layer for heading indicator
let userLat, userLng; // Store user location for distance calculations
let cachedTrashCans = null;
let deviceHeading = null; // Device compass heading in degrees (0-360)

// Icon colors for different amenity types
const trashCanIcons = {
  waste_basket: L.icon({
    iconUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cmVjdCB4PSI2IiB5PSI4IiB3aWR0aD0iMTIiIGhlaWdodD0iMTAiIGZpbGw9IiNmZmE1MDAiIHN0cm9rZT0iIzAwMCIgc3Ryb2tlLXdpZHRoPSIxIi8+PHJlY3QgeD0iNiIgeT0iMiIgd2lkdGg9IjEyIiBoZWlnaHQ9IjIiIGZpbGw9IiNmZmE1MDAiLz48bGluZSB4MT0iMTAiIHkxPSI1IiB4Mj0iMTAiIHkyPSI2IiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==",
    iconSize: [48, 48],
    iconAnchor: [24, 48],
    popupAnchor: [0, -48],
  }),
  waste_disposal: L.icon({
    iconUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cmVjdCB4PSI2IiB5PSI4IiB3aWR0aD0iMTIiIGhlaWdodD0iMTAiIGZpbGw9IiM2YjUzOTQiIHN0cm9rZT0iIzAwMCIgc3Ryb2tlLXdpZHRoPSIxIi8+PHJlY3QgeD0iNiIgeT0iMiIgd2lkdGg9IjEyIiBoZWlnaHQ9IjIiIGZpbGw9IiM2YjUzOTQiLz48bGluZSB4MT0iMTAiIHkxPSI1IiB4Mj0iMTAiIHkyPSI2IiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==",
    iconSize: [48, 48],
    iconAnchor: [24, 48],
    popupAnchor: [0, -48],
  }),
  recycling: L.icon({
    iconUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cmVjdCB4PSI2IiB5PSI4IiB3aWR0aD0iMTIiIGhlaWdodD0iMTAiIGZpbGw9IiMyOGE3NDUiIHN0cm9rZT0iIzAwMCIgc3Ryb2tlLXdpZHRoPSIxIi8+PHJlY3QgeD0iNiIgeT0iMiIgd2lkdGg9IjEyIiBoZWlnaHQ9IjIiIGZpbGw9IiMyOGE3NDUiLz48bGluZSB4MT0iMTAiIHkxPSI1IiB4Mj0iMTAiIHkyPSI2IiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==",
    iconSize: [48, 48],
    iconAnchor: [24, 48],
    popupAnchor: [0, -48],
  }),
};

// Haversine formula to calculate distance between two coordinates (in miles)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Calculate bearing (direction) from one point to another
function calculateBearing(lat1, lon1, lat2, lon2) {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(dLon);
  let bearing = (Math.atan2(y, x) * 180) / Math.PI;
  bearing = (bearing + 360) % 360; // Normalize to 0-360
  return bearing;
}

// Get direction cardinal description
function getDirectionDescription(bearing) {
  const directions = [
    "North",
    "NE",
    "East",
    "SE",
    "South",
    "SW",
    "West",
    "NW",
  ];
  const index = Math.round(bearing / 45) % 8;
  return directions[index];
}

// Initialize device orientation tracking
function initializeDeviceOrientation() {
  if (typeof DeviceOrientationEvent !== "undefined") {
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      // iOS 13+ requires explicit permission
      DeviceOrientationEvent.requestPermission()
        .then((permission) => {
          if (permission === "granted") {
            window.addEventListener("deviceorientation", handleDeviceOrientation);
          }
        })
        .catch((e) => console.log("Device orientation permission denied"));
    } else {
      // Non-iOS or older browsers
      window.addEventListener("deviceorientation", handleDeviceOrientation);
    }
  }
}

function handleDeviceOrientation(event) {
  // webkitCompassHeading for iOS, alpha for Android
  deviceHeading =
    event.webkitCompassHeading !== undefined
      ? event.webkitCompassHeading
      : 360 - event.alpha;
  
  // Update the heading indicator on map
  updateUserHeadingIndicator();
}

const trashCanIcon = L.icon({
  iconUrl:
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cmVjdCB4PSI2IiB5PSI4IiB3aWR0aD0iMTIiIGhlaWdodD0iMTAiIGZpbGw9IiNmZjZiMzUiIHN0cm9rZT0iIzAwMCIgc3Ryb2tlLXdpZHRoPSIxIi8+PHJlY3QgeD0iNiIgeT0iMiIgd2lkdGg9IjEyIiBoZWlnaHQ9IjIiIGZpbGw9IiNmZjZiMzUiLz48bGluZSB4MT0iMTAiIHkxPSI1IiB4Mj0iMTAiIHkyPSI2IiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==",
  iconSize: [48, 48],
  iconAnchor: [24, 48],
  popupAnchor: [0, -48],
});

function initializeMap(lat, lng, locationType) {
  userLat = lat;
  userLng = lng; // Store for distance calculations
  
  map = L.map("map").setView([lat, lng], HALF_MILE_ZOOM_LEVEL);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  trashCanLayer.addTo(map);
  userHeadingLayer.addTo(map);

  userLocationMarker = L.marker([lat, lng], {
    title: locationType,
  })
    .bindPopup(
      `<b>${locationType}</b><br>Latitude: ${lat.toFixed(4)}<br>Longitude: ${lng.toFixed(4)}`,
    )
    .addTo(map)
    .openPopup();

  addLoadButton();
  updateStatus(`Map loaded - Click button to find trash cans`, "success");
}

function addLoadButton() {
  const button = document.getElementById("loadTrashButton");
  if (button) {
    button.onclick = loadTrashCans;
  }
  
  // Keyboard shortcut: Press 'L' to load trash cans
  document.addEventListener("keydown", (e) => {
    if (e.key === "l" || e.key === "L") {
      loadTrashCans();
    }
  });
  
  // Initialize device orientation tracking for compass direction
  initializeDeviceOrientation();
}

// Update user heading indicator on map
function updateUserHeadingIndicator() {
  userHeadingLayer.clearLayers();
  
  if (deviceHeading !== null && map) {
    // Create a line showing device heading direction
    const headingRad = (deviceHeading * Math.PI) / 180;
    const distance = 0.002; // About 200m in degrees
    const endLat = userLat + distance * Math.cos(headingRad);
    const endLng = userLng + distance * Math.sin(headingRad);
    
    // Draw line
    const line = L.polyline(
      [[userLat, userLng], [endLat, endLng]],
      { color: "#0066ff", weight: 3, opacity: 0.8, dashArray: "5, 5" }
    );
    userHeadingLayer.addLayer(line);
    
    // Add arrow marker at end
    const arrowIcon = L.divIcon({
      className: "heading-arrow",
      html: `<div style="font-size: 24px; color: #0066ff; transform: rotate(${deviceHeading}deg); transform-origin: center; text-shadow: 1px 1px 3px rgba(0,0,0,0.5);">▶</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    L.marker([endLat, endLng], { icon: arrowIcon }).addTo(userHeadingLayer);
  }
}

function loadTrashCans() {
  performFetch();
}

function performFetch() {
  const center = map.getCenter();
  
  // Zoom to 0.5 mile radius around current view center
  map.setView(center, HALF_MILE_ZOOM_LEVEL);
  
  // After zooming, wait a moment for bounds to update, then fetch
  setTimeout(() => {
    const bounds = map.getBounds();
    const south = bounds.getSouth();
    const west = bounds.getWest();
    const north = bounds.getNorth();
    const east = bounds.getEast();

    if (
      !isFinite(south) ||
      !isFinite(west) ||
      !isFinite(north) ||
      !isFinite(east)
    ) {
      updateStatus("Invalid map bounds", "error");
      return;
    }

    trashCanLayer.clearLayers();
    updateStatus("Searching for trash cans...", "info");

    const query = `[out:json][timeout:10];
(
  node["amenity"="waste_basket"](${south},${west},${north},${east});
  node["amenity"="waste_disposal"](${south},${west},${north},${east});
  node["amenity"="recycling"](${south},${west},${north},${east});
  way["amenity"="waste_basket"](${south},${west},${north},${east});
  way["amenity"="waste_disposal"](${south},${west},${north},${east});
  way["amenity"="recycling"](${south},${west},${north},${east});
);
out center;`;

    tryFetchWithFallback(query);
  }, 300);
}

function tryFetchWithFallback(query) {
  fetch(OVERPASS_API, { method: "POST", body: query })
    .then((response) => {
      if (!response.ok) throw new Error(`Status ${response.status}`);
      return response.text();
    })
    .then((text) => {
      if (text.trim().startsWith("<")) throw new Error("HTML response");
      return JSON.parse(text);
    })
    .then((data) => {
      if (data.error) throw new Error(data.error);

      const elements = data.elements || [];
      cachedTrashCans = elements;

      elements.forEach((element) => {
        let lat, lng;
        let amenityType = "waste_basket"; // default
        
        if (element.type === "node") {
          lat = element.lat;
          lng = element.lon;
        } else if (element.type === "way" && element.center) {
          lat = element.center.lat;
          lng = element.center.lon;
        }

        if (element.tags && element.tags.amenity) {
          amenityType = element.tags.amenity;
        }

        if (lat && lng) {
          const distance = calculateDistance(userLat, userLng, lat, lng);
          
          // Select icon based on amenity type
          const icon = trashCanIcons[amenityType] || trashCanIcons.waste_basket;
          
          const marker = L.marker([lat, lng], { icon });
          let popupContent = "<b>🗑️ Trash Can</b>";
          if (element.tags) {
            if (element.tags.amenity === "waste_basket")
              popupContent = "<b>🗑️ Waste Basket</b>";
            else if (element.tags.amenity === "waste_disposal")
              popupContent = "<b>🗑️ Disposal</b>";
            else if (element.tags.amenity === "recycling")
              popupContent = "<b>♻️ Recycling</b>";
          }
          const distance_mi = distance.toFixed(2);
          popupContent += `<br>Lat: ${lat.toFixed(4)}<br>Lon: ${lng.toFixed(4)}<br><b>Distance: ${distance_mi} mi</b>`;
          marker.bindPopup(popupContent);
          trashCanLayer.addLayer(marker);
        }
      });

      updateStatus(`Found ${elements.length} trash cans!`, "success");
    })
    .catch((error) => {
      alert(`Error: ${error.message}`);
      updateStatus("Error loading trash cans", "error");
    });
}

function updateStatus(message, type = "info") {
  const statusEl = document.getElementById("status");
  const statusText = statusEl.querySelector("#statusText");
  if (statusText) statusText.textContent = message;
  statusEl.className = type;
}

navigator.geolocation.getCurrentPosition(
  (position) => {
    initializeMap(
      position.coords.latitude,
      position.coords.longitude,
      "Your Location",
    );
  },
  () => {
    initializeMap(FALLBACK_LAT, FALLBACK_LNG, "Fallback Location");
  },
  { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
);