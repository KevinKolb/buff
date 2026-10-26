// Live data layer: Supabase. Loads after api.js (the mock) and replaces
// window.BuffAPI when BUFF_CONFIG.backend is filled in. Same functions,
// same shapes, so the pages don't care which one they're talking to.
//
// It also loads the menu, hours and providers from the database before
// the pages start (BuffAPI.ready), so the shop edits them in Supabase.

(function () {
  var CFG = window.BUFF_CONFIG;
  var be = CFG.backend || {};
  if (!be.supabaseUrl || !be.supabaseKey) { return; } // stay in demo mode

  var mock = window.BuffAPI;
  var sb = window.supabase.createClient(be.supabaseUrl, be.supabaseKey);

  function hhmm(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
  function toMin(s) { var p = s.split(':'); return +p[0] * 60 + +p[1]; }
  function isoToday() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  // Supabase replies { data, error }. Turn that into resolve/reject, with
  // the database's error names (slot_taken, not_found…) as err.code.
  var CODES = { slot_taken: 'taken' };
  function unwrap(res) {
    if (res.error) {
      var msg = res.error.message || 'error';
      var e = new Error(msg); e.code = CODES[msg] || msg;
      throw e;
    }
    return res.data;
  }

  function toBooking(r) {
    return {
      id: r.id, date: r.date, start: r.start_min, time: hhmm(r.start_min), mins: r.mins,
      provider: r.provider_pref, providerIds: r.provider_ids, services: r.services, guests: r.guests,
      total: +r.total, status: r.status, cancelledBy: r.cancelled_by, createdAt: r.created_at,
      client: { name: r.client_name, phone: r.client_phone, email: r.client_email, note: r.note },
    };
  }
  function toWaitlist(r) {
    return {
      id: r.id, date: r.date, mins: r.mins, provider: r.provider_pref, services: r.services, guests: r.guests, total: +r.total,
      client: { name: r.client_name, phone: r.client_phone, email: r.client_email, note: r.note },
    };
  }
  function toTimeOff(r) {
    return { id: r.id, providerId: r.provider_id, date: r.date, start: r.start_min, end: r.end_min, allDay: r.all_day, reason: r.reason, status: r.status };
  }

  function availability(dateISO, mins, providerId, guests) {
    return sb.rpc('get_availability', { p_date: dateISO, p_mins: mins, p_provider: providerId, p_guests: guests }).then(unwrap).then(function (res) {
      res.slots.forEach(function (s) { s.label = mock.formatTime(toMin(s.time)); });
      return res;
    });
  }

  // Pages render once `ready` resolves; until then, say so.
  var main = document.querySelector('main');
  if (main && !main.innerHTML.trim()) { main.innerHTML = '<p class="muted center pad" role="status">Loading…</p>'; }

  // Menu, hours, providers and settings from the database.
  var ready = Promise.all([
    sb.from('settings').select('*').eq('id', 1).single().then(unwrap),
    sb.from('business_hours').select('*').then(unwrap),
    sb.from('providers').select('*').eq('active', true).order('sort').then(unwrap),
    sb.from('services').select('*').eq('active', true).order('sort').then(unwrap),
  ]).then(function (r) {
    var s = r[0];
    CFG.booking.slotStepMinutes = s.slot_step_min;
    CFG.booking.daysAhead = s.days_ahead;
    CFG.booking.minNoticeMinutes = s.min_notice_min;
    CFG.booking.maxGuests = s.max_guests;
    var hours = {};
    for (var d = 0; d < 7; d++) { hours[d] = null; }
    r[1].forEach(function (h) { hours[h.dow] = { open: h.open_time.slice(0, 5), close: h.close_time.slice(0, 5) }; });
    CFG.hours = hours;
    CFG.providers = r[2].map(function (p) { return { id: p.id, name: p.name, initials: p.initials, blurb: p.blurb }; });
    CFG.services = r[3].map(function (v) { var o = { cat: v.cat, name: v.name, price: +v.price, mins: v.mins }; if (v.price_note) { o.priceNote = v.price_note; } return o; });
  });
  ready.catch(function () {
    var main = document.querySelector('main');
    if (main) {
      main.innerHTML = '<p class="notice" role="alert">We couldn’t load the booking page. Check your connection and refresh, or call us at ' +
        '<a href="' + CFG.business.phoneHref + '">' + CFG.business.phone + '</a>.</p>';
    }
  });

  window.BuffAPI = {
    mode: 'live',
    ready: ready,
    formatTime: mock.formatTime,
    toMin: mock.toMin,

    // ======== client booking ========
    getAvailability: availability,

    createBooking: function (payload) {
      return sb.rpc('create_booking', { p: payload }).then(unwrap).then(toBooking);
    },

    joinWaitlist: function (payload) {
      return sb.rpc('join_waitlist', { p: payload }).then(unwrap);
    },

    findBooking: function (ref, phone) {
      return sb.rpc('find_booking', { p_ref: ref, p_phone: phone }).then(unwrap).then(function (r) { return r ? toBooking(r) : null; });
    },

    cancelBooking: function (ref, phone) {
      return sb.rpc('cancel_booking', { p_ref: ref, p_phone: phone }).then(unwrap).then(toBooking);
    },

    // ======== staff sign-in ========

    /** Resolves { email, role, providerId } for a signed-in user (role null if not on staff), or null. */
    getStaff: function () {
      return sb.auth.getSession().then(function (res) {
        var session = res.data && res.data.session;
        if (!session) { return null; }
        return Promise.all([sb.rpc('staff_role').then(unwrap), sb.rpc('staff_provider_id').then(unwrap)]).then(function (r) {
          return { email: session.user.email, role: r[0], providerId: r[1] };
        });
      });
    },

    /** Emails a sign-in link that comes back to this page. */
    signIn: function (email) {
      return sb.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: location.origin + location.pathname },
      }).then(unwrap);
    },

    signOut: function () { return sb.auth.signOut(); },

    // ======== front desk ========
    listBookings: function (dateISO) {
      return sb.from('bookings').select('*').eq('date', dateISO).order('start_min').then(unwrap).then(function (rows) { return rows.map(toBooking); });
    },

    setBookingStatus: function (id, status) {
      var patch = { status: status };
      if (status === 'cancelled') { patch.cancelled_by = 'staff'; patch.cancelled_at = new Date().toISOString(); }
      else { patch.cancelled_by = null; patch.cancelled_at = null; }
      return sb.from('bookings').update(patch).eq('id', id).select().single().then(unwrap).then(toBooking);
    },

    listWaitlist: function () {
      return sb.from('waitlist').select('*').gte('date', isoToday()).order('date').order('created_at').then(unwrap).then(function (rows) {
        return Promise.all(rows.map(function (r) {
          var w = toWaitlist(r);
          return availability(w.date, w.mins, w.provider, w.guests).then(function (a) {
            w.openings = a.slots.filter(function (s) { return s.available; }).map(function (s) { return s.label; });
            return w;
          }, function () { w.openings = []; return w; });
        }));
      });
    },

    removeWaitlist: function (id) {
      return sb.from('waitlist').delete().eq('id', id).then(unwrap);
    },

    listTimeOff: function () {
      return sb.from('time_off').select('*').gte('date', isoToday()).order('date').order('start_min').then(unwrap).then(function (rows) {
        var list = rows.map(toTimeOff);
        var dates = list.map(function (t) { return t.date; }).filter(function (d, i, a) { return a.indexOf(d) === i; });
        if (!dates.length) { return list; }
        return sb.from('bookings').select('*').in('date', dates).neq('status', 'cancelled').then(unwrap).then(function (bs) {
          list.forEach(function (t) {
            t.conflicts = bs.map(toBooking).filter(function (b) {
              return b.date === t.date && b.providerIds.indexOf(t.providerId) >= 0 && b.start < t.end && b.start + b.mins > t.start;
            }).map(function (b) { return { id: b.id, label: mock.formatTime(b.start), client: b.client.name }; });
          });
          return list;
        });
      });
    },

    timeOffOn: function (dateISO) {
      return sb.from('time_off').select('*').eq('date', dateISO).neq('status', 'denied').then(unwrap).then(function (rows) { return rows.map(toTimeOff); });
    },

    requestTimeOff: function (p) {
      return sb.auth.getSession().then(function (res) {
        var email = res.data.session ? res.data.session.user.email : null;
        return sb.from('time_off').insert({
          provider_id: p.providerId, date: p.date, all_day: !!p.allDay,
          start_min: p.allDay ? 0 : toMin(p.start), end_min: p.allDay ? 1440 : toMin(p.end),
          reason: p.reason || '', requested_by: email,
        }).select().single().then(unwrap).then(toTimeOff);
      });
    },

    decideTimeOff: function (id, status) {
      return sb.auth.getSession().then(function (res) {
        return sb.from('time_off').update({ status: status, decided_by: res.data.session.user.email, decided_at: new Date().toISOString() })
          .eq('id', id).select().single().then(unwrap).then(toTimeOff);
      });
    },
  };
})();
