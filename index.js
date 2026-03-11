const FALLBACK_LAT = 47.67891;
const FALLBACK_LNG = -122.33787;
const ZOOM_LEVEL = 15;

const OVERPASS_APIS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
];

let map;
let trashCanLayer = L.featureGroup();
let userLocationMarker;
let hasLoadedTrashCans = false;
let cachedTrashCans = null;
let currentAPIIndex = 0;

const trashCanIcon = L.icon({
  iconUrl:
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cmVjdCB4PSI2IiB5PSI4IiB3aWR0aD0iMTIiIGhlaWdodD0iMTAiIGZpbGw9IiMzMzMiIHN0cm9rZT0iIzAwMCIgc3Ryb2tlLXdpZHRoPSIxIi8+PHJlY3QgeD0iNiIgeT0iMiIgd2lkdGg9IjEyIiBoZWlnaHQ9IjIiIGZpbGw9IiMzMzMiLz48bGluZSB4MT0iMTAiIHkxPSI1IiB4Mj0iMTAiIHkyPSI2IiBzdHJva2U9IiMzMzMiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

function initializeMap(lat, lng, locationType) {
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
    button.onclick = loadTrashCansOnce;
  }
  
  // Keyboard shortcut: Press 'L' to load trash cans
  document.addEventListener("keydown", (e) => {
    if (e.key === "l" || e.key === "L") {
      if (!hasLoadedTrashCans) {
        loadTrashCansOnce();
      }
    }
  });
}

function loadTrashCansOnce() {
  if (hasLoadedTrashCans) {
    alert(
      `Trash cans already loaded (${cachedTrashCans ? cachedTrashCans.length : 0} found). Reload to fetch again.`,
    );
    return;
  }
  hasLoadedTrashCans = true;
  performFetch();
}

function performFetch() {
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

  currentAPIIndex = 0;
  tryFetchWithFallback(query);
}

function tryFetchWithFallback(query) {
  if (currentAPIIndex >= OVERPASS_APIS.length) {
    alert("All APIs unavailable. Try again later.");
    hasLoadedTrashCans = false;
    return;
  }

  const apiUrl = OVERPASS_APIS[currentAPIIndex];

  fetch(apiUrl, { method: "POST", body: query })
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
        if (element.type === "node") {
          lat = element.lat;
          lng = element.lon;
        } else if (element.type === "way" && element.center) {
          lat = element.center.lat;
          lng = element.center.lon;
        }

        if (lat && lng) {
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
          popupContent += `<br>Lat: ${lat.toFixed(4)}<br>Lon: ${lng.toFixed(4)}`;
          marker.bindPopup(popupContent);
          trashCanLayer.addLayer(marker);
        }
      });

      updateStatus(
        `Found ${elements.length} trash cans! (Loaded once to save API)`,
        "success",
      );
    })
    .catch((error) => {
      const errorMsg = error.message;
      if (errorMsg.includes("Status") || errorMsg === "HTML response") {
        currentAPIIndex++;
        if (currentAPIIndex < OVERPASS_APIS.length) {
          updateStatus(
            `Trying API ${currentAPIIndex + 1}/${OVERPASS_APIS.length}...`,
            "info",
          );
          setTimeout(() => tryFetchWithFallback(query), 1000);
          return;
        }
      }
      alert(`Error: ${errorMsg}`);
      updateStatus("Error loading", "error");
      hasLoadedTrashCans = false;
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