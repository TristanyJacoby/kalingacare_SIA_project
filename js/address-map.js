// js/address-map.js
// KalingaCare — Google Maps address picker, shared by Settings (saved
// address) and Checkout (this order's delivery address).
//
// Drag the marker or click anywhere on the map to set the exact delivery
// location; a search box on top uses the Places Autocomplete widget to
// jump straight to an address. Either action reverse-geocodes the pin's
// position into the address field and reports the new {lat, lng}.
//
// Uses AdvancedMarkerElement + PlaceAutocompleteElement (Google's current,
// non-deprecated APIs) rather than the older Marker/Autocomplete classes;
// AdvancedMarkerElement needs a Map ID, hence DEMO_MAP_ID.
// Maps quotas are capped per day (see CLAUDE.md): this uses map loads,
// Geocoding and Places Autocomplete/Details only.

import { loadGoogleMaps, GOOGLE_MAPS_API_KEY, DEMO_MAP_ID } from "./site.js";

const METRO_MANILA = { lat: 14.5995, lng: 120.9842 };

// AdvancedMarkerElement's .position can come back as either a plain
// {lat, lng} literal or a google.maps.LatLng-style object with lat()/lng()
// methods, depending on how it was set — this normalizes either shape.
function toLatLngLiteral(pos) {
  if (typeof pos.lat === "function") return { lat: pos.lat(), lng: pos.lng() };
  return { lat: pos.lat, lng: pos.lng };
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.mapEl            where the map renders
 * @param {HTMLElement} opts.searchContainer  where the search box goes
 * @param {HTMLInputElement|HTMLTextAreaElement} opts.addressInput  filled with the pin's address
 * @param {number|null} [opts.lat]            starting pin (null = Metro Manila, no pin chosen yet)
 * @param {number|null} [opts.lng]
 * @param {(pos: {lat: number, lng: number}) => void} opts.onChange  called whenever the pin moves
 * @returns {Promise<{ setPosition(lat, lng): void } | null>} null if the map couldn't load
 */
export async function initAddressPicker({ mapEl, searchContainer, addressInput, lat = null, lng = null, onChange }) {
  if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === "YOUR_GOOGLE_MAPS_API_KEY") {
    mapEl.innerHTML = `
      <div class="map-placeholder">
        <i class="bi bi-map" style="font-size:1.8rem; margin-bottom:8px;"></i>
        Map picker needs a Google Maps API key.<br />
        Add one in <code>js/site.js</code> (GOOGLE_MAPS_API_KEY) to enable it.
      </div>`;
    return null;
  }

  let googleMaps, AdvancedMarkerElement, PlaceAutocompleteElement, Geocoder;
  try {
    googleMaps = await loadGoogleMaps();
    ({ AdvancedMarkerElement } = await googleMaps.importLibrary("marker"));
    ({ PlaceAutocompleteElement } = await googleMaps.importLibrary("places"));
    ({ Geocoder } = await googleMaps.importLibrary("geocoding"));
  } catch (err) {
    console.error("KalingaCare Maps error:", err);
    mapEl.innerHTML = `<div class="map-placeholder">Couldn't load the map right now. You can still type the address below.</div>`;
    return null;
  }

  const hasPin = lat != null && lng != null;
  const center = hasPin ? { lat, lng } : METRO_MANILA;

  const map = new googleMaps.Map(mapEl, {
    center,
    zoom: hasPin ? 16 : 11,
    mapId: DEMO_MAP_ID, // required for AdvancedMarkerElement to render at all
    streetViewControl: false,
    mapTypeControl: false,
  });

  const marker = new AdvancedMarkerElement({
    position: center,
    map,
    gmpDraggable: true,
    title: "Drag to set the exact delivery location",
  });

  const geocoder = new Geocoder();

  async function updateFromPosition(pos) {
    onChange(pos);
    try {
      const result = await geocoder.geocode({ location: pos });
      if (result.results[0]) addressInput.value = result.results[0].formatted_address;
    } catch {
      // Reverse geocoding failing isn't critical — the pin position is
      // still kept even if we can't turn it into text.
    }
  }

  marker.addListener("dragend", () => updateFromPosition(toLatLngLiteral(marker.position)));

  map.addListener("click", (e) => {
    const pos = toLatLngLiteral(e.latLng);
    marker.position = pos;
    updateFromPosition(pos);
  });

  // <gmp-place-autocomplete> is its own element, so it replaces the
  // container's contents rather than binding to an existing input.
  const placeAutocomplete = new PlaceAutocompleteElement({ includedRegionCodes: ["ph"] });
  placeAutocomplete.className = "map-search-input";
  searchContainer.innerHTML = "";
  searchContainer.appendChild(placeAutocomplete);

  placeAutocomplete.addEventListener("gmp-select", async ({ placePrediction }) => {
    try {
      const place = placePrediction.toPlace();
      await place.fetchFields({ fields: ["location", "formattedAddress"] });
      if (!place.location) return;
      const pos = toLatLngLiteral(place.location);
      map.setCenter(pos);
      map.setZoom(16);
      marker.position = pos;
      onChange(pos);
      if (place.formattedAddress) addressInput.value = place.formattedAddress;
    } catch {
      // The map/marker stay where they were; the user can still drag/click.
    }
  });

  return {
    setPosition(newLat, newLng) {
      if (newLat == null || newLng == null) return;
      const pos = { lat: newLat, lng: newLng };
      marker.position = pos;
      map.setCenter(pos);
      map.setZoom(16);
    },
  };
}
