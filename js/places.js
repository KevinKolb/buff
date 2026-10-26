// Places: where providers work, and travel time between places.
// Mirrors the database (_works_there, _travel_min) so pages can show choices;
// the database decides what can actually be booked.
//
// CFG.places: [{ id, name, address, lat, lng, main }]
// CFG.providerPlaces: { providerId: [{ placeId, days: [0-6] }] }  (none = the main place, every day)
// CFG.placeTravel: { 'a-b': minutes } with a < b, set by hand
// CFG.travelDefaultMin: used when a place couldn't be found on the map

(function () {
  function cfg() { return window.BUFF_CONFIG; }
  function list() { return cfg().places || []; }

  function main() { return list().filter(function (p) { return p.main; })[0] || null; }
  function byId(id) { return list().filter(function (p) { return String(p.id) === String(id); })[0] || null; }
  function mainId() { var m = main(); return m ? m.id : null; }

  /** Place ids where a provider works (on dateISO if given). */
  function forProvider(pid, dateISO) {
    var rows = (cfg().providerPlaces || {})[pid] || [];
    if (!rows.length) { return mainId() != null ? [mainId()] : []; }
    var dow = dateISO ? new Date(dateISO + 'T00:00:00').getDay() : null;
    return rows.filter(function (r) { return dow == null || !r.days || !r.days.length || r.days.indexOf(dow) >= 0; })
      .map(function (r) { return r.placeId; });
  }
  function worksThere(pid, placeId, dateISO) {
    var id = placeId == null ? mainId() : placeId;
    return forProvider(pid, dateISO).some(function (x) { return String(x) === String(id); });
  }

  /** Places where at least one provider who does all these services works, in list order. */
  function forServices(services, canDo) {
    var ids = {};
    cfg().providers.forEach(function (p) {
      if (canDo && !canDo(p.id, services)) { return; }
      forProvider(p.id).forEach(function (id) { ids[id] = true; });
    });
    return list().filter(function (p) { return ids[p.id]; }).map(function (p) { return p.id; });
  }

  function km(a, b) {
    var r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.pow(Math.sin(dLng / 2), 2);
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  }
  function key(a, b) { return Math.min(a, b) + '-' + Math.max(a, b); }

  /** { minutes, how: 'same' | 'set' | 'map' | 'default' } between two places (null = main). */
  function travelInfo(a, b) {
    a = a == null ? mainId() : a; b = b == null ? mainId() : b;
    if (a == null || b == null || String(a) === String(b)) { return { minutes: 0, how: 'same' }; }
    var set = (cfg().placeTravel || {})[key(+a, +b)];
    if (set != null) { return { minutes: set, how: 'set' }; }
    var pa = byId(a), pb = byId(b);
    if (!pa || !pb) { return { minutes: cfg().travelDefaultMin || 30, how: 'default' }; }
    if (pa.address.trim().toLowerCase() === pb.address.trim().toLowerCase()) { return { minutes: 0, how: 'same' }; }
    if (pa.lat == null || pb.lat == null) { return { minutes: cfg().travelDefaultMin || 30, how: 'default' }; }
    // roads are ~1.3× the straight line; ~30 km/h in town; +10 min to park and set up; round up to 5
    return { minutes: Math.min(240, Math.ceil((km(pa, pb) * 1.3 / 30 * 60 + 10) / 5) * 5), how: 'map' };
  }
  function travel(a, b) { return travelInfo(a, b).minutes; }

  /** Find an address on the map (OpenStreetMap). Resolves { lat, lng } or null. */
  function geocode(address) {
    var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(address);
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { return rows && rows[0] ? { lat: +rows[0].lat, lng: +rows[0].lon } : null; }, function () { return null; });
  }

  /** More than one place in use? (Otherwise pages don't ask "where".) */
  function several() {
    var used = {};
    cfg().providers.forEach(function (p) { forProvider(p.id).forEach(function (id) { used[id] = true; }); });
    return Object.keys(used).length > 1;
  }

  window.BuffPlaces = { main: main, mainId: mainId, byId: byId, forProvider: forProvider, worksThere: worksThere, forServices: forServices,
    travel: travel, travelInfo: travelInfo, geocode: geocode, several: several, key: key };
})();
