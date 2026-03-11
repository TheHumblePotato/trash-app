const FALLBACK_LAT = 47.67891;
const FALLBACK_LNG = -122.33787;
const ZOOM_LEVEL = 15;
const HALF_MILE_ZOOM_LEVEL = 17; // Zoom level for 0.5 mile radius

const OVERPASS_API = "https://overpass-api.de/api/interpreter";

let map;
let trashCanLayer = L.featureGroup();
let userLocationMarker;
let userLat, userLng; // Store user location for distance calculations
let cachedTrashCans = null;
let deviceHeading = null; // Device compass heading in degrees (0-360)

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
  
  map = L.map("map").setView([lat, lng], ZOOM_LEVEL);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  trashCanLayer.addTo(map);

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

      let minDistance = Infinity;
      let nearestTrashCan = null;
      let bearingToNearest = null;

      elements.forEach((element) => {
        let lat, lng;
        if (element.type === "node") {
          lat = element.lat;
          lng = element.lon;
        } else if (element.type === "way" && element.center) {
          lat = element.center.lat;
          lng = element.center.lon;
        }

        if (lat && lng) {
          // Calculate distance to this trash can
          const distance = calculateDistance(userLat, userLng, lat, lng);
          if (distance < minDistance) {
            minDistance = distance;
            bearingToNearest = calculateBearing(userLat, userLng, lat, lng);
            nearestTrashCan = { lat, lng, distance };
          }

          const marker = L.marker([lat, lng], { icon: trashCanIcon });
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
          const direction = getDirectionDescription(calculateBearing(userLat, userLng, lat, lng));
          popupContent += `<br>Lat: ${lat.toFixed(4)}<br>Lon: ${lng.toFixed(4)}<br><b>Distance: ${distance_mi} mi (${direction})</b>`;
          marker.bindPopup(popupContent);
          trashCanLayer.addLayer(marker);
        }
      });

      // Auto-zoom to 0.5 mile radius around results
      if (elements.length > 0) {
        const halfMileInDegrees = 0.00724; // approximate conversion: 0.5 mi ≈ 0.00724 degrees
        
        let minLat = Infinity, maxLat = -Infinity;
        let minLng = Infinity, maxLng = -Infinity;
        
        elements.forEach((element) => {
          let lat, lng;
          if (element.type === "node") {
            lat = element.lat;
            lng = element.lon;
          } else if (element.type === "way" && element.center) {
            lat = element.center.lat;
            lng = element.center.lon;
          }
          
          if (lat && lng) {
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
          }
        });
        
        // Expand bounds to create 0.5 mile radius buffer
        minLat -= halfMileInDegrees;
        maxLat += halfMileInDegrees;
        minLng -= halfMileInDegrees;
        maxLng += halfMileInDegrees;
        
        const bounds = L.latLngBounds(
          L.latLng(minLat, minLng),
          L.latLng(maxLat, maxLng)
        );
        map.fitBounds(bounds, { padding: [50, 50] });
      }

      let statusMsg = `Found ${elements.length} trash cans!`;
      if (nearestTrashCan && bearingToNearest !== null) {
        const direction = getDirectionDescription(bearingToNearest);
        let directionInfo = direction;
        
        // If device has compass, show relative direction
        if (deviceHeading !== null) {
          // Calculate relative bearing to nearest trash can from device perspective
          const relativeBearing = (bearingToNearest - deviceHeading + 360) % 360;
          if (relativeBearing < 45 || relativeBearing > 315) {
            directionInfo = "Ahead ↑";
          } else if (relativeBearing >= 45 && relativeBearing < 135) {
            directionInfo = "Right →";
          } else if (relativeBearing >= 135 && relativeBearing < 225) {
            directionInfo = "Behind ↓";
          } else {
            directionInfo = "Left ←";
          }
        }
        
        statusMsg += ` | Nearest: ${nearestTrashCan.distance.toFixed(2)} mi ${directionInfo}`;
      }
      updateStatus(statusMsg, "success");
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