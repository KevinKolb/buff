// Data layer. Every call returns a Promise so the mock can be swapped for a
// real backend (e.g. fetch('/api/availability?...')) without touching the pages.
//
// MOCK MODE: each provider's day is pre-filled with seeded sample appointments
// so the same date always shows the same openings. Real bookings, waitlist
// entries and time off are saved in this browser's localStorage, so the client
// pages and the front desk (staff.html) see the same data on one device.

(function () {
  var CFG = window.BUFF_CONFIG;
  var KEY = 'buff-mock-v1';

  function toMin(hhmm) { var p = hhmm.split(':'); return +p[0] * 60 + +p[1]; }
  function toHHMM(m) { var h = Math.floor(m / 60), mm = m % 60; return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm; }
  function newId(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 8).toUpperCase(); }
  function digits(s) { return String(s || '').replace(/\D/g, '').slice(-10); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Small deterministic PRNG (mulberry32) seeded from a string.
  function seeded(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return function () {
      h += 0x6D2B79F5; var t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- local "database" ----------
  // Re-read at the start of every call so a tab that's been open a while
  // sees changes made in another tab (e.g. the front desk approving time off).
  var db = {};
  function sync() {
    try { var raw = localStorage.getItem(KEY); if (raw) { db = JSON.parse(raw); } } catch (e) { /* private mode: keep what's in memory */ }
    db.bookings = db.bookings || [];
    db.waitlist = db.waitlist || [];
    db.timeOff = db.timeOff || [];
    db.sampleStatus = db.sampleStatus || {}; // status changes made to seeded sample appointments
    db.clients = db.clients || [];          // client records (see clientFor)
    if (db.providers) { CFG.providers = db.providers.filter(function (p) { return p.active; }); } // edited on the Team tab
    if (db.services) { CFG.services = db.services.filter(function (s) { return s.active; }); }    // edited on the Menu tab
    if (db.categoryOrder) { CFG.categoryOrder = db.categoryOrder; }
  }
  sync();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* keep working in memory */ } }

  function hoursOn(dateISO) {
    var h = CFG.hours[new Date(dateISO + 'T00:00:00').getDay()];
    return h ? { open: toMin(h.open), close: toMin(h.close) } : null;
  }

  // ---------- seeded sample appointments ----------
  var SAMPLE_NAMES = ['Ava B.', 'Camille R.', 'Simone T.', 'Lauren M.', 'Josie K.', 'Margot D.', 'Tess L.', 'Brielle H.', 'Nina P.', 'Claire F.', 'Maya S.', 'Delphine G.'];

  function samplesFor(providerId, dateISO) {
    var hrs = hoursOn(dateISO);
    if (!hrs) { return []; }
    var rnd = seeded(providerId + '|' + dateISO);
    var out = [], t = hrs.open, i = 0;
    while (t < hrs.close) {
      var len = [30, 45, 60, 60, 90][Math.floor(rnd() * 5)];
      if (rnd() < 0.55) {
        var id = 'S-' + providerId + '-' + dateISO.replace(/-/g, '') + '-' + (i++);
        var s = CFG.services[Math.floor(rnd() * CFG.services.length)];
        out.push({
          id: id, sample: true, date: dateISO, time: toHHMM(t), start: t, mins: len,
          providerIds: [providerId], services: [s.name], guests: 1, total: s.price,
          client: { name: SAMPLE_NAMES[Math.floor(rnd() * SAMPLE_NAMES.length)], phone: '', email: '', note: '' },
          status: db.sampleStatus[id] || 'booked',
        });
      }
      t += len;
    }
    return out;
  }

  function bookingsOn(dateISO) {
    var list = [];
    CFG.providers.forEach(function (p) { list = list.concat(samplesFor(p.id, dateISO)); });
    db.bookings.forEach(function (b) { if (b.date === dateISO) { list.push(b); } });
    return list.sort(function (a, b) { return a.start - b.start; });
  }

  function findAny(id) {
    var real = db.bookings.filter(function (b) { return b.id === id; })[0];
    if (real) { return real; }
    var m = /^S-(.+)-(\d{4})(\d{2})(\d{2})-\d+$/.exec(id);
    if (!m) { return null; }
    return samplesFor(m[1], m[2] + '-' + m[3] + '-' + m[4]).filter(function (b) { return b.id === id; })[0] || null;
  }

  // Busy intervals [start, end) in minutes for one provider on one date.
  function busyFor(providerId, dateISO) {
    var busy = [];
    bookingsOn(dateISO).forEach(function (b) {
      if (b.status !== 'cancelled' && b.providerIds.indexOf(providerId) >= 0) { busy.push([b.start, b.start + b.mins]); }
    });
    db.timeOff.forEach(function (t) {
      if (t.status === 'approved' && t.providerId === providerId && t.date === dateISO) { busy.push([t.start, t.end]); }
    });
    return busy;
  }

  function isFree(busy, start, end) {
    for (var i = 0; i < busy.length; i++) { if (start < busy[i][1] && end > busy[i][0]) { return false; } }
    return true;
  }

  function slotsFor(dateISO, mins, providerId, guests) {
    var hrs = hoursOn(dateISO);
    if (!hrs) { return { closed: true, slots: [] }; }
    var busyMap = {};
    CFG.providers.forEach(function (p) { busyMap[p.id] = busyFor(p.id, dateISO); });

    var now = new Date(), d = new Date(dateISO + 'T00:00:00');
    var isToday = now.toDateString() === d.toDateString();
    var earliest = d < new Date(now.toDateString()) ? Infinity
      : isToday ? now.getHours() * 60 + now.getMinutes() + CFG.booking.minNoticeMinutes : 0;

    var slots = [];
    for (var t = hrs.open; t + mins <= hrs.close; t += CFG.booking.slotStepMinutes) {
      var free = CFG.providers.filter(function (p) { return isFree(busyMap[p.id], t, t + mins); }).map(function (p) { return p.id; });
      var ok = t >= earliest && free.length >= guests && (providerId === 'any' || free.indexOf(providerId) >= 0);
      var chosen = [];
      if (ok) {
        if (providerId !== 'any') { chosen.push(providerId); }
        free.forEach(function (id) { if (chosen.length < guests && chosen.indexOf(id) < 0) { chosen.push(id); } });
      }
      slots.push({ time: toHHMM(t), label: formatTime(t), available: ok, providerIds: chosen });
    }
    return { closed: false, slots: slots };
  }

  function delay(v) { return new Promise(function (res) { setTimeout(function () { res(clone(v)); }, 150); }); }
  function fail(code, message) {
    return new Promise(function (res, rej) { setTimeout(function () { var e = new Error(message); e.code = code; rej(e); }, 150); });
  }

  window.BuffAPI = {
    mode: 'demo',
    ready: Promise.resolve(),

    // ======== client booking ========

    /**
     * @param {string} dateISO  'YYYY-MM-DD'
     * @param {number} mins     total visit length per guest
     * @param {string} providerId provider id or 'any'
     * @param {number} guests   1..maxGuests (each guest needs their own provider at the same time)
     * @returns {Promise<{closed:boolean, slots:Array<{time:string,label:string,available:boolean,providerIds:string[]}>}>}
     */
    getAvailability: function (dateISO, mins, providerId, guests) {
      sync();
      return delay(slotsFor(dateISO, mins, providerId, guests));
    },

    /**
     * Creates a booking. Rejects with code 'taken' if the slot filled up meanwhile.
     * Real version: POST /api/bookings (and save card via Stripe SetupIntent).
     */
    createBooking: function (payload) {
      sync();
      var start = toMin(payload.time);
      var clash = payload.providerIds.some(function (id) { return !isFree(busyFor(id, payload.date), start, start + payload.mins); });
      if (clash) { return fail('taken', 'That time was just taken.'); }
      var rec = Object.assign({ id: newId('BB'), createdAt: new Date().toISOString(), status: 'booked' }, clone(payload));
      rec.start = start;
      rec.client.email = String(rec.client.email || '').trim().toLowerCase();
      rec.clientId = clientFor(payload, payload._staff);
      delete rec._staff; delete rec.client.staffNote;
      db.bookings.push(rec); save();
      return delay(rec);
    },

    /**
     * Staff book for a client (book.html): managers and reservationists only.
     * Same rules as online, plus the cancellation policy must be confirmed.
     */
    staffCreateBooking: function (payload) {
      var api = this;
      var roles = demoStaff().roles;
      if (roles.indexOf('manager') < 0 && roles.indexOf('reservationist') < 0) { return fail('not_allowed', 'Not allowed.'); }
      if (!payload.policyAgreed) { return fail('policy_required', 'Policy not confirmed.'); }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((payload.client && payload.client.email) || '')) { return fail('invalid_client', 'Email required.'); }
      if (payload.clientId && db.clients.some(function (c) { return c.email === payload.client.email.trim().toLowerCase() && c.id !== payload.clientId; })) {
        return fail('email_in_use', 'Another client already uses that email.');
      }
      return api.createBooking(Object.assign({ _staff: true }, payload)).then(function (rec) {
        sync();
        var b = db.bookings.filter(function (x) { return x.id === rec.id; })[0];
        b.bookedBy = 'demo'; save();
        return clone(b);
      });
    },

    /** Adds the client to the waitlist for a date. Real version: POST /api/waitlist. */
    joinWaitlist: function (payload) {
      sync();
      var rec = Object.assign({ id: newId('WL'), createdAt: new Date().toISOString() }, clone(payload));
      db.waitlist.push(rec); save();
      return delay(rec);
    },

    /** Looks up a booking by reference + mobile number. Resolves null if no match. */
    findBooking: function (ref, phone) {
      sync();
      var r = String(ref || '').trim().toUpperCase();
      var b = db.bookings.filter(function (x) { return x.id === r && digits(x.client.phone) === digits(phone); })[0];
      return delay(b || null);
    },

    /** Client cancels their own booking. Rejects with code 'not_found' if no match or not cancellable. */
    cancelBooking: function (ref, phone) {
      sync();
      var r = String(ref || '').trim().toUpperCase();
      var b = db.bookings.filter(function (x) { return x.id === r && digits(x.client.phone) === digits(phone) && x.status === 'booked'; })[0];
      if (!b) { return fail('not_found', 'Booking not found.'); }
      b.status = 'cancelled'; b.cancelledBy = 'client'; b.cancelledAt = new Date().toISOString(); save();
      return delay(b);
    },

    // ======== staff sign-in ========
    // Demo: you're a manager. Add ?as=reservationist or ?as=provider (or
    // ?as=manager,provider) to a staff page's address to preview other roles.
    getStaff: function () { return delay(demoStaff()); },
    signIn: function () { return delay(true); },
    signOut: function () { return delay(true); },

    // ======== front desk ========

    /** Every appointment on a date (sample + real, all statuses), sorted by start time. */
    listBookings: function (dateISO) { sync(); return delay(bookingsOn(dateISO)); },

    /** status: 'booked' | 'arrived' | 'no-show' | 'cancelled'. by: 'client' | 'staff'. */
    setBookingStatus: function (id, status, by) {
      sync();
      var b = findAny(id);
      if (!b) { return fail('not_found', 'Booking not found.'); }
      if (b.sample) { db.sampleStatus[id] = status; } else { b.status = status; if (status === 'cancelled') { b.cancelledBy = by || 'staff'; b.cancelledAt = new Date().toISOString(); } }
      b.status = status;
      save();
      return delay(b);
    },

    /** Waitlist entries from today on, each with the times that are open for it right now. */
    listWaitlist: function () {
      sync();
      var today = isoToday();
      var list = db.waitlist.filter(function (w) { return w.date >= today; }).map(function (w) {
        var open = slotsFor(w.date, w.mins, w.provider, w.guests).slots.filter(function (s) { return s.available; });
        return Object.assign(clone(w), { openings: open.map(function (s) { return s.label; }) });
      });
      return delay(list.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }));
    },

    removeWaitlist: function (id) {
      sync();
      db.waitlist = db.waitlist.filter(function (w) { return w.id !== id; }); save();
      return delay(true);
    },

    /** All time off from today on, each with the appointments it overlaps. */
    listTimeOff: function () {
      sync();
      var today = isoToday();
      var list = db.timeOff.filter(function (t) { return t.date >= today; }).map(function (t) {
        var clashes = bookingsOn(t.date).filter(function (b) {
          return b.status !== 'cancelled' && b.providerIds.indexOf(t.providerId) >= 0 && b.start < t.end && b.start + b.mins > t.start;
        });
        return Object.assign(clone(t), { conflicts: clashes.map(function (b) { return { id: b.id, label: formatTime(b.start), client: b.client.name }; }) });
      });
      return delay(list.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start; }));
    },

    /** Time off for one date (any status) — for drawing on the schedule. */
    timeOffOn: function (dateISO) {
      sync();
      return delay(db.timeOff.filter(function (t) { return t.date === dateISO && t.status !== 'denied'; }));
    },

    /**
     * A provider asks for time off. payload: { providerId, date, allDay, start:'HH:MM', end:'HH:MM', reason }.
     * Real version: POST /api/time-off — then notify the manager.
     */
    requestTimeOff: function (payload) {
      sync();
      var rec = {
        id: newId('TO'), providerId: payload.providerId, date: payload.date, allDay: !!payload.allDay,
        start: payload.allDay ? 0 : toMin(payload.start), end: payload.allDay ? 24 * 60 : toMin(payload.end),
        reason: payload.reason || '', status: 'pending', createdAt: new Date().toISOString(),
      };
      db.timeOff.push(rec); save();
      return delay(rec);
    },

    /** Manager decision. status: 'approved' | 'denied'. Approved time off blocks online booking. */
    decideTimeOff: function (id, status) {
      sync();
      var t = db.timeOff.filter(function (x) { return x.id === id; })[0];
      if (!t) { return fail('not_found', 'Request not found.'); }
      t.status = status; t.decidedAt = new Date().toISOString(); save();
      return delay(t);
    },

    // ======== team (managers) ========

    /** Every provider, including hidden ones, in display order. */
    listProviders: function () {
      sync();
      return delay(allProviders());
    },

    /** Creates (isNew) or updates a provider: { id, name, initials, blurb, sort, active }. */
    saveProvider: function (p, isNew) {
      sync();
      var list = allProviders();
      if (isNew) { list.push(p); } else { list = list.map(function (x) { return x.id === p.id ? Object.assign({}, x, p) : x; }); }
      db.providers = list.sort(function (a, b) { return a.sort - b.sort; });
      CFG.providers = db.providers.filter(function (x) { return x.active; });
      save();
      return delay(p);
    },

    // ======== staff logins (managers) ========

    /** Everyone on the staff list: [{ email, roles: [...], providerId }]. */
    listStaff: function () { sync(); return delay(allStaff()); },

    saveStaff: function (s, isNew) {
      sync();
      var list = allStaff(), email = s.email.trim().toLowerCase();
      if (isNew && list.some(function (x) { return x.email === email; })) { return fail('duplicate', email + ' is already on the staff list.'); }
      var rec = { email: email, roles: s.roles.slice(), providerId: s.roles.indexOf('provider') >= 0 ? (s.providerId || null) : null };
      db.staffList = isNew ? list.concat(rec) : list.map(function (x) { return x.email === email ? rec : x; });
      save();
      return delay(rec);
    },

    removeStaff: function (email) {
      sync();
      db.staffList = allStaff().filter(function (x) { return x.email !== email; }); save();
      return delay(true);
    },

    // ======== menu (managers) ========

    /** { services: every service incl. hidden, in order; categories: ordered names (may include empty ones) } */
    listMenu: function () {
      sync();
      return delay(menuNow());
    },

    /** Creates (isNew: id assigned here) or updates a service: { id, cat, name, price, mins, priceNote, sort, active }. */
    saveService: function (s, isNew) {
      sync();
      var list = allServices();
      var clash = list.filter(function (x) { return x.name.toLowerCase() === s.name.toLowerCase() && x.id !== s.id; })[0];
      if (clash) { return fail('duplicate', 'There’s already a service called ' + clash.name + '.'); }
      if (isNew) { s.id = list.reduce(function (m, x) { return Math.max(m, x.id); }, 0) + 1; list.push(s); }
      else { list = list.map(function (x) { return x.id === s.id ? Object.assign({}, x, s) : x; }); }
      setServices(list);
      return delay(s);
    },

    deleteService: function (id) {
      sync();
      setServices(allServices().filter(function (x) { return x.id !== id; }));
      return delay(true);
    },

    /** Saves the category button order (names; may include categories with no services yet). */
    saveCategories: function (order) {
      sync();
      db.categoryOrder = order.slice(); CFG.categoryOrder = db.categoryOrder; save();
      return delay(true);
    },

    /** Renames a category on every service in it, and in the category order. */
    renameCategory: function (from, to) {
      sync();
      setServices(allServices().map(function (x) { return x.cat === from ? Object.assign({}, x, { cat: to }) : x; }));
      db.categoryOrder = menuNow().categories.map(function (c) { return c === from ? to : c; })
        .filter(function (c, i, a) { return a.indexOf(c) === i; });
      CFG.categoryOrder = db.categoryOrder; save();
      return delay(true);
    },

    // ======== client accounts ========
    // Demo: "signing in" happens instantly (no email). Live: an emailed link.

    /** { email, client: { id, name, phone, email } } for a signed-in client, or null. */
    getClientAccount: function () {
      sync();
      if (!db.clientSession) { return delay(null); }
      var em = db.clientSession;
      var c = db.clients.filter(function (x) { return x.email === em; })[0];
      if (!c) { c = { id: newId('C'), name: '', phone: '', email: em, staffNote: '' }; db.clients.push(c); save(); }
      return delay({ email: em, client: { id: c.id, name: c.name, phone: c.phone, email: c.email } });
    },
    /** Resolves { instant: true } in demo (already signed in); live sends an email. */
    clientSignIn: function (email) {
      sync(); db.clientSession = email.trim().toLowerCase(); save();
      return delay({ instant: true });
    },
    clientSignOut: function () { sync(); delete db.clientSession; save(); return delay(true); },

    updateMyProfile: function (name, phone) {
      sync();
      var c = db.clients.filter(function (x) { return x.email === db.clientSession; })[0];
      if (!c) { return fail('not_signed_in', 'Not signed in.'); }
      c.name = name.trim(); c.phone = phone.trim(); save();
      return delay({ id: c.id, name: c.name, phone: c.phone, email: c.email });
    },

    /** The signed-in client's bookings, newest first. */
    myBookings: function () {
      sync();
      var c = db.clients.filter(function (x) { return x.email === db.clientSession; })[0];
      if (!c) { return delay([]); }
      return delay(db.bookings.filter(function (b) { return b.clientId === c.id; })
        .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.start - a.start; }));
    },

    cancelMyBooking: function (id) {
      sync();
      var c = db.clients.filter(function (x) { return x.email === db.clientSession; })[0];
      var b = c && db.bookings.filter(function (x) { return x.id === id && x.clientId === c.id && x.status === 'booked'; })[0];
      if (!b) { return fail('not_found', 'Booking not found.'); }
      b.status = 'cancelled'; b.cancelledBy = 'client'; b.cancelledAt = new Date().toISOString(); save();
      return delay(b);
    },

    // ======== sample data (managers) ========
    // Demo mode always shows generated sample appointments; nothing to add.
    addSampleWeek: function () { return delay(0); },
    removeSampleData: function () { return delay(0); },

    // ======== clients (staff) ========

    /** Every client: [{ id, name, phone, email, staffNote }], by name. */
    listClients: function () {
      sync();
      return delay(db.clients.slice().sort(function (a, b) { return (a.name || a.email).localeCompare(b.name || b.email); }));
    },

    /** Deletes everything saved in this browser (prototype only). */
    resetDemo: function () {
      sync();
      db.bookings = []; db.waitlist = []; db.timeOff = []; db.sampleStatus = {}; db.clients = []; delete db.clientSession; save();
      if (db.providers || db.services || db.categoryOrder || db.staffList) { delete db.providers; delete db.services; delete db.categoryOrder; delete db.staffList; save(); location.reload(); }
      return delay(true);
    },
  };

  function allProviders() {
    return clone(db.providers || CFG.providers.map(function (p, i) { return Object.assign({ sort: i, active: true }, p); }));
  }

  // Same rules as the database's _client_for: staff may pick and update a
  // client; online, a signed-in client books as themselves; anyone else is
  // matched by email and can't change an existing record.
  function clientFor(p, staff) {
    var em = String(p.client.email || '').trim().toLowerCase(), nm = p.client.name.trim(), ph = p.client.phone.trim();
    var c;
    if (staff) {
      c = p.clientId ? db.clients.filter(function (x) { return x.id === p.clientId; })[0] : db.clients.filter(function (x) { return x.email === em; })[0];
      if (!c) { c = { id: newId('C'), name: '', phone: '', email: em, staffNote: '' }; db.clients.push(c); }
      c.name = nm; c.phone = ph; c.email = em;
      if (p.client.staffNote != null) { c.staffNote = p.client.staffNote; }
      return c.id;
    }
    if (db.clientSession) {
      c = db.clients.filter(function (x) { return x.email === db.clientSession; })[0];
      if (c) { c.name = nm; c.phone = ph; return c.id; }
    }
    c = db.clients.filter(function (x) { return x.email === em; })[0];
    if (!c) { c = { id: newId('C'), name: nm, phone: ph, email: em, staffNote: '' }; db.clients.push(c); }
    return c.id;
  }

  function demoStaff() {
    var as = new URLSearchParams(location.search).get('as');
    var roles = as ? as.split(',').filter(function (r) { return ['manager', 'reservationist', 'provider'].indexOf(r) >= 0; }) : ['manager'];
    if (!roles.length) { roles = ['manager']; }
    return { email: 'demo', roles: roles, providerId: roles.indexOf('provider') >= 0 ? CFG.providers[0].id : null };
  }
  function allStaff() {
    return clone(db.staffList || [{ email: 'demo', roles: ['manager'], providerId: null }]);
  }

  function allServices() {
    return clone(db.services || CFG.services.map(function (s, i) { return Object.assign({ id: i + 1, sort: i, active: true }, s); }));
  }
  function setServices(list) {
    db.services = list.sort(function (a, b) { return a.sort - b.sort; });
    CFG.services = db.services.filter(function (x) { return x.active; });
    save();
  }
  function menuNow() {
    var services = allServices();
    var order = (db.categoryOrder || CFG.categoryOrder || []).slice();
    services.forEach(function (s) { if (order.indexOf(s.cat) < 0) { order.push(s.cat); } });
    return { services: services, categories: order };
  }

  function isoToday() {
    var d = new Date(), m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function formatTime(m) {
    var h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ap;
  }
  window.BuffAPI.formatTime = formatTime;
  window.BuffAPI.toMin = toMin;
})();
