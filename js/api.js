// Data layer. Every call returns a Promise so the mock can be swapped for a
// real backend (e.g. fetch('/api/availability?...')) without touching app.js.
//
// MOCK MODE: availability is generated from a seeded random schedule so the
// same date always shows the same openings. Bookings live in memory only.

(function () {
  var CFG = window.BUFF_CONFIG;

  function toMin(hhmm) { var p = hhmm.split(':'); return +p[0] * 60 + +p[1]; }
  function toHHMM(m) { var h = Math.floor(m / 60), mm = m % 60; return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm; }

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

  // In-memory "database" of bookings made during this session.
  var sessionBookings = [];
  var waitlist = [];

  // Busy intervals [start, end) in minutes for one provider on one date.
  function busyFor(providerId, dateISO, open, close) {
    var rnd = seeded(providerId + '|' + dateISO);
    var busy = [];
    var t = open;
    while (t < close) {
      var len = [30, 45, 60, 60, 90][Math.floor(rnd() * 5)];
      if (rnd() < 0.55) { busy.push([t, t + len]); }
      t += len;
    }
    sessionBookings.forEach(function (b) {
      if (b.date === dateISO && b.providerIds.indexOf(providerId) >= 0) { busy.push([b.start, b.start + b.mins]); }
    });
    return busy;
  }

  function isFree(busy, start, end) {
    for (var i = 0; i < busy.length; i++) { if (start < busy[i][1] && end > busy[i][0]) { return false; } }
    return true;
  }

  function delay(v) { return new Promise(function (res) { setTimeout(function () { res(v); }, 150); }); }

  window.BuffAPI = {
    /**
     * @param {string} dateISO  'YYYY-MM-DD'
     * @param {number} mins     total visit length per guest
     * @param {string} providerId provider id or 'any'
     * @param {number} guests   1..maxGuests (each guest needs their own provider at the same time)
     * @returns {Promise<{closed:boolean, slots:Array<{time:string,label:string,available:boolean,providerIds:string[]}>}>}
     */
    getAvailability: function (dateISO, mins, providerId, guests) {
      var d = new Date(dateISO + 'T00:00:00');
      var hours = CFG.hours[d.getDay()];
      if (!hours) { return delay({ closed: true, slots: [] }); }
      var open = toMin(hours.open), close = toMin(hours.close);
      var busyMap = {};
      CFG.providers.forEach(function (p) { busyMap[p.id] = busyFor(p.id, dateISO, open, close); });

      var now = new Date();
      var isToday = now.toDateString() === d.toDateString();
      var earliest = isToday ? now.getHours() * 60 + now.getMinutes() + CFG.booking.minNoticeMinutes : 0;

      var slots = [];
      for (var t = open; t + mins <= close; t += CFG.booking.slotStepMinutes) {
        var free = CFG.providers.filter(function (p) { return isFree(busyMap[p.id], t, t + mins); }).map(function (p) { return p.id; });
        var ok = t >= earliest && free.length >= guests && (providerId === 'any' || free.indexOf(providerId) >= 0);
        var chosen = [];
        if (ok) {
          if (providerId !== 'any') { chosen.push(providerId); }
          free.forEach(function (id) { if (chosen.length < guests && chosen.indexOf(id) < 0) { chosen.push(id); } });
        }
        slots.push({ time: toHHMM(t), label: formatTime(t), available: ok, providerIds: chosen });
      }
      return delay({ closed: false, slots: slots });
    },

    /** Creates a booking. Real version: POST /api/bookings (and save card via Stripe SetupIntent). */
    createBooking: function (payload) {
      var rec = Object.assign({ id: 'BB-' + Math.random().toString(36).slice(2, 8).toUpperCase(), createdAt: new Date().toISOString() }, payload);
      rec.start = toMin(payload.time);
      sessionBookings.push(rec);
      console.info('[BuffAPI mock] booking created', rec);
      return delay(rec);
    },

    /** Adds the client to the waitlist for a date. Real version: POST /api/waitlist. */
    joinWaitlist: function (payload) {
      var rec = Object.assign({ id: 'WL-' + Math.random().toString(36).slice(2, 8).toUpperCase() }, payload);
      waitlist.push(rec);
      console.info('[BuffAPI mock] waitlist entry', rec);
      return delay(rec);
    },
  };

  function formatTime(m) {
    var h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ap;
  }
  window.BuffAPI.formatTime = formatTime;
})();
