// ------------------------------
// Initialize Leaflet Map
// ------------------------------
let map = L.map('map').setView([7.8731, 80.7718], 7); // Center on Sri Lanka

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Global marker array
window.markers = [];

// ------------------------------
// Firebase Setup
// ------------------------------
const firebaseConfig = {
  apiKey: "API_KEY",
  authDomain: "groupmeetupmap.firebaseapp.com",
  databaseURL: "https://groupmeetupmap-default-rtdb.firebaseio.com",
  projectId: "groupmeetupmap",
  storageBucket: "groupmeetupmap.appspot.com",
  messagingSenderId: "SENDER_ID",
  appId: "APP_ID"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ------------------------------
// Function: Geocode an address
// ------------------------------
async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data && data.length > 0) {
    return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
  } else {
    alert(`Location not found: ${address}`);
    return null;
  }
}

// ------------------------------
// Function: Calculate geometric midpoint
// ------------------------------
function calculateMidpoint(coordsList) {
  let sumLat = 0;
  let sumLng = 0;
  coordsList.forEach(c => {
    sumLat += c[0];
    sumLng += c[1];
  });
  return [sumLat / coordsList.length, sumLng / coordsList.length];
}

// ------------------------------
// Function: Find nearby POIs using Overpass API
// ------------------------------
async function findNearbyPOIs(lat, lon, type = "cafe", radius = 1000) {
  const query = `[out:json];
    node["amenity"="${type}"](around:${radius},${lat},${lon});
    out;`;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

  const response = await fetch(url);
  const data = await response.json();

  const pois = data.elements.map(el => ({
    name: el.tags.name || "Unnamed",
    lat: el.lat,
    lon: el.lon
  }));
  return pois;
}

// ------------------------------
// Function: Get travel time using OpenRouteService API
// ------------------------------
async function getTravelTime(origin, destination) {
  const apiKey = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImQ4NjA3MWZjMGE5MTRkZTg4MDFlYWYwYjAxN2NjM2I1IiwiaCI6Im11cm11cjY0In0="; 
  const url = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${apiKey}&start=${origin[1]},${origin[0]}&end=${destination[1]},${destination[0]}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data && data.features && data.features.length > 0) {
    return data.features[0].properties.summary.duration; // in seconds
  } else {
    return Infinity;
  }
}

// ------------------------------
// Function: Rank candidate POIs
// ------------------------------
async function rankMeetupPoints(userCoords, candidatePOIs) {
  let results = [];

  for (let poi of candidatePOIs) {
    let times = [];
    for (let user of userCoords) {
      let t = await getTravelTime(user, [poi.lat, poi.lon]);
      times.push(t);
    }

    let totalTime = times.reduce((a, b) => a + b, 0);
    let fairness = Math.max(...times) - Math.min(...times);

    results.push({
      poi: poi,
      totalTime: totalTime,
      fairness: fairness
    });
  }

  results.sort((a, b) => a.fairness - b.fairness || a.totalTime - b.totalTime);
  return results;
}

// ------------------------------
// Save Locations to Firebase
// ------------------------------
function saveLocationsToFirebase(locations) {
  db.ref("meetup/locations").set(locations);
}

// ------------------------------
// Load Locations from Firebase
// ------------------------------
async function loadLocationsFromFirebase() {
  const snapshot = await db.ref("meetup/locations").once("value");
  return snapshot.val() || [];
}

// ------------------------------
// Button Click Event
// ------------------------------
document.getElementById('findBtn').addEventListener('click', async () => {
  const addresses = [
    document.getElementById('location1').value,
    document.getElementById('location2').value,
    document.getElementById('location3').value
  ];

  // Save addresses to Firebase
  saveLocationsToFirebase(addresses);

  // Remove existing markers
  if (window.markers) window.markers.forEach(marker => map.removeLayer(marker));
  window.markers = [];

  // Geocode addresses
  let coordsList = [];
  for (let addr of addresses) {
    if (addr.trim() !== "") {
      let coords = await geocodeAddress(addr);
      if (coords) {
        coordsList.push(coords);
        let marker = L.marker(coords).addTo(map).bindPopup(addr);
        window.markers.push(marker);
      }
    }
  }

  if (coordsList.length > 0) {
    let midpoint = calculateMidpoint(coordsList);

    let midMarker = L.marker(midpoint, {
      icon: L.icon({
        iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png',
        iconSize: [30, 30]
      })
    }).addTo(map).bindPopup("Midpoint").openPopup();
    window.markers.push(midMarker);

    let bounds = L.latLngBounds([...coordsList, midpoint]);
    map.fitBounds(bounds, { padding: [50, 50] });

    let pois = await findNearbyPOIs(midpoint[0], midpoint[1], "cafe", 1000);
    pois.push({ name: "Midpoint", lat: midpoint[0], lon: midpoint[1] });

    let rankedPOIs = await rankMeetupPoints(coordsList, pois);
    let bestPOI = rankedPOIs[0].poi;

    let bestMarker = L.marker([bestPOI.lat, bestPOI.lon], {
      icon: L.icon({
        iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png',
        iconSize: [35, 35]
      })
    }).addTo(map).bindPopup(`Best Meetup: ${bestPOI.name}`).openPopup();

    window.markers.push(bestMarker);

    rankedPOIs.slice(1).forEach(p => {
      let marker = L.marker([p.poi.lat, p.poi.lon], {
        icon: L.icon({
          iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png',
          iconSize: [25, 25]
        })
      }).addTo(map).bindPopup(p.poi.name);
      window.markers.push(marker);
    });
  }
});

// ------------------------------
// Load saved locations on startup
// ------------------------------
window.onload = async () => {
  const savedAddresses = await loadLocationsFromFirebase();
  if (savedAddresses.length > 0) {
    document.getElementById('location1').value = savedAddresses[0] || "";
    document.getElementById('location2').value = savedAddresses[1] || "";
    document.getElementById('location3').value = savedAddresses[2] || "";
  }
};


// Only declare once
let map2 = L.map('map2').setView([20, 0], 2);

// Modern styled tiles (dark mode)
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  subdomains: 'abcd',
  maxZoom: 19
}).addTo(map);

// Geocoder
L.Control.geocoder({
  defaultMarkGeocode: true
}).addTo(map);



// ------------------------------

function setupAutocomplete(inputId) {
  const input = document.getElementById(inputId);
  new Awesomplete(input, { minChars: 3, maxItems: 5 });

  input.addEventListener("input", async () => {
    const query = input.value.trim();
    if (query.length < 3) return;

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=5`;
    const response = await fetch(url);
    const data = await response.json();

    input.awesomplete.list = data.map(
      place => ({
        label: place.display_name,
        value: place.display_name
      })
    );
  });
}

// Initialize autocomplete 
setupAutocomplete("location1");
setupAutocomplete("location2");
setupAutocomplete("location3");