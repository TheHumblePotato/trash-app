// Map initialization and configuration
const FALLBACK_LAT = 47.67891;
const FALLBACK_LNG = -122.33787;
const ZOOM_LEVEL = 15; // Shows approximately 2km area

let map;

function initializeMap(lat, lng, locationType) {
    // Create map centered at the provided coordinates
    map = L.map('map').setView([lat, lng], ZOOM_LEVEL);
    
    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
    }).addTo(map);
    
    // Add a marker at the center
    L.marker([lat, lng])
        .bindPopup(`<b>${locationType}</b><br>Latitude: ${lat.toFixed(4)}<br>Longitude: ${lng.toFixed(4)}`)
        .addTo(map)
        .openPopup();
    
    // Update status
    updateStatus(`Map centered at ${locationType}`, 'success');
}

function updateStatus(message, type = 'info') {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.className = type;
}

// Request user's location
navigator.geolocation.getCurrentPosition(
    function(position) {
        // Success: Use user's location
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        initializeMap(lat, lng, 'Your Location');
    },
    function(error) {
        // Error: Use fallback location
        console.warn('Geolocation failed:', error.message);
        initializeMap(FALLBACK_LAT, FALLBACK_LNG, 'Fallback Location (Seattle Area)');
    },
    {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
    }
);
