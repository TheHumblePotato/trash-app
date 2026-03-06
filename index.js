const FALLBACK_LAT = 47.67891;
const FALLBACK_LNG = -122.33787;
const ZOOM_LEVEL = 15;

const OVERPASS_APIS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
];
let currentAPIIndex = 0;

let map;
let trashCanLayer = L.featureGroup();
let userLocationMarker;
let lastFetchTime = 0;
let retryCount = 0;
let hasLoadedTrashCans = false;

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
  updateStatus(
    `Map centered at ${locationType} - Click "Load Trash Cans" to find nearby trash`,
    "success",
  );
}

function addLoadButton() {
  const button = document.createElement("button");
  button.id = "loadTrashButton";
  button.textContent = "🗑️ Load Trash Cans";
  button.onclick = loadTrashCansOnce;
  document.getElementById("status").appendChild(button);
}

function loadTrashCansOnce() {
  if (hasLoadedTrashCans) {
    alert("Trash cans already loaded! Check the map for markers.");
    return;
  }
  hasLoadedTrashCans = true;
  document.getElementById("loadTrashButton").disabled = true;
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

  const now = Date.now();
  if (lastFetchTime && now - lastFetchTime < 2000) {
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

  lastFetchTime = now;
  retryCount = 0;

  tryFetchWithFallback(query);
}

function tryFetchWithFallback(query) {
  const apiUrl = OVERPASS_APIS[currentAPIIndex];

  fetch(apiUrl, {
    method: "POST",
    body: query,
    timeout: 15000,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(
          `API returned status ${response.status}: ${response.statusText}`,
        );
      }
      return response.text();
    })
    .then((text) => {
      if (text.trim().startsWith("<")) {
        throw new Error(
          "API returned non-JSON response (possibly HTML error page)",
        );
      }
      try {
        const data = JSON.parse(text);
        return data;
      } catch (e) {
        throw new Error(`Invalid JSON response: ${e.message}`);
      }
    })
    .then((data) => {
      if (data.error) {
        throw new Error(`Overpass API error: ${data.error}`);
      }

      const elements = data.elements || [];

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
            const amenity = element.tags.amenity;
            const type = element.tags.type;

            if (amenity === "waste_basket")
              popupContent = "<b>🗑️ Waste Basket</b>";
            else if (amenity === "waste_disposal")
              popupContent = "<b>🗑️ Waste Disposal</b>";
            else if (amenity === "recycling")
              popupContent = "<b>♻️ Recycling</b>";

            if (type) popupContent += `<br>Type: ${type}`;
          }

          popupContent += `<br>Lat: ${lat.toFixed(4)}<br>Lon: ${lng.toFixed(4)}`;
          marker.bindPopup(popupContent);
          trashCanLayer.addLayer(marker);
        }
      });

      updateStatus(`Found ${elements.length} trash cans in view`, "success");
    })
    .catch((error) => {
      console.error(`Error from ${OVERPASS_APIS[currentAPIIndex]}:`, error);

      const errorMsg = error.message || "Unknown error";

      if (
        errorMsg.includes("504") ||
        errorMsg.includes("timeout") ||
        errorMsg.includes("503") ||
        errorMsg.includes("HTML error page") ||
        errorMsg.includes("non-JSON")
      ) {
        retryCount++;
        if (retryCount < OVERPASS_APIS.length) {
          currentAPIIndex = (currentAPIIndex + 1) % OVERPASS_APIS.length;
          updateStatus(`API busy, trying alternate server...`, "info");
          setTimeout(
            () => tryFetchWithFallback(query),
            500 + Math.random() * 1500,
          );
          return;
        }
      }

      alert(
        `Error loading trash cans:\n\n${errorMsg}\n\nTry again in a minute or visit openstreetmap.org directly.`,
      );
      console.error("Error fetching trash cans:", error);
      updateStatus("Error loading trash cans", "error");

      hasLoadedTrashCans = false;
      const btn = document.getElementById("loadTrashButton");
      if (btn) btn.disabled = false;
    });
}

function updateStatus(message, type = "info") {
  const statusEl = document.getElementById("status");
  statusEl.textContent = message;
  statusEl.className = type;
}

navigator.geolocation.getCurrentPosition(
  function (position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    initializeMap(lat, lng, "Your Location");
  },
  function (error) {
    console.warn("Geolocation failed:", error.message);
    initializeMap(
      FALLBACK_LAT,
      FALLBACK_LNG,
      "Fallback Location (Seattle Area)",
    );
  },
  {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0,
  },
);