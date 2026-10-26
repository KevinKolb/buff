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
      total: +r.total, status: r.status, cancelledBy: r.cancelled_by, createdAt: r.created_at, bookedBy: r.booked_by, clientId: r.client_id, sample: !!r.is_sample, occasion: r.occasion || '',
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

  function fromServiceRow(v) {
    return { id: v.id, cat: v.cat, name: v.name, price: +v.price, mins: v.mins, priceNote: v.price_note || '', sort: v.sort, active: v.active };
  }
  // keep this page's copy of the menu (CFG.services) in step after an edit
  function refreshMenu() {
    return sb.from('services').select('*').eq('active', true).order('sort').then(unwrap).then(function (rows) {
      CFG.services = rows.map(function (v) { var o = { cat: v.cat, name: v.name, price: +v.price, mins: v.mins }; if (v.price_note) { o.priceNote = v.price_note; } return o; });
    });
  }
  // unwrap, but turn a unique-name clash into a readable message
  function unwrapDupe(res) {
    if (res.error && res.error.code === '23505') { throw Object.assign(new Error('There’s already a service with that name.'), { code: 'duplicate' }); }
    return unwrap(res);
  }

  function availability(dateISO, mins, providerId, guests, services, holdToken) {
    var args = { p_date: dateISO, p_mins: mins, p_provider: providerId, p_guests: guests };
    if (holdToken) { args.p_hold_token = holdToken; } // only sent while a hold exists, so older databases still work
    // only once the provider-services table exists (older databases don't take this)
    if (services && services.length && CFG.qualified) { args.p_services = services; }
    return sb.rpc('get_availability', args).then(unwrap).then(function (res) {
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
    // who does which services; null if that table isn't set up yet (then no filtering)
    sb.from('provider_services').select('provider_id,service_id').then(function (res) { return res.error ? null : res.data; }),
    // closed days from today on; empty if that table isn't set up yet
    sb.from('closed_dates').select('date,label').gte('date', isoToday()).then(function (res) { return res.error ? [] : res.data; }),
  ]).then(function (r) {
    var s = r[0];
    CFG.booking.slotStepMinutes = s.slot_step_min;
    CFG.booking.daysAhead = s.days_ahead;
    CFG.booking.minNoticeMinutes = s.min_notice_min;
    CFG.booking.maxGuests = s.max_guests;
    if (s.category_order && s.category_order.length) { CFG.categoryOrder = s.category_order; }
    applyBusiness(s);
    var hours = {};
    for (var d = 0; d < 7; d++) { hours[d] = null; }
    r[1].forEach(function (h) { hours[h.dow] = { open: h.open_time.slice(0, 5), close: h.close_time.slice(0, 5) }; });
    CFG.hours = hours;
    CFG.providers = r[2].map(function (p) { return { id: p.id, name: p.name, initials: p.initials, blurb: p.blurb }; });
    CFG.services = r[3].map(function (v) { var o = { cat: v.cat, name: v.name, price: +v.price, mins: v.mins }; if (v.price_note) { o.priceNote = v.price_note; } return o; });
    CFG.qualified = qualifiedFrom(r[4], r[3]);
    CFG.closedDates = {};
    r[5].forEach(function (c) { CFG.closedDates[c.date] = c.label || ''; });
  });

  // business details from settings (older databases don't have them: keep config.js values)
  function applyBusiness(s) {
    if (s.timezone) { CFG.business.timezone = s.timezone; }
    if (s.address == null) { return; }
    CFG.business.name = s.business_name;
    CFG.business.phone = s.phone;
    CFG.business.phoneHref = 'tel:' + String(s.phone || '').replace(/[^\d+]/g, '');
    CFG.business.address = s.address;
    CFG.business.cancellationPolicyUrl = s.cancellation_policy_url;
    CFG.business.cancellationWindowHours = s.cancellation_window_hours;
  }

  function qualifiedFrom(rows, services) {
    if (!rows) { return null; }
    var byId = {}, out = {};
    services.forEach(function (v) { byId[v.id] = v.name; });
    CFG.providers.forEach(function (p) { out[p.id] = []; });
    rows.forEach(function (r) { if (byId[r.service_id]) { (out[r.provider_id] = out[r.provider_id] || []).push(byId[r.service_id]); } });
    return out;
  }
  ready.catch(function (err) {
    console.error('[Buff] could not load from Supabase', err);
    var main = document.querySelector('main');
    if (main) {
      main.innerHTML = '<p class="notice" role="alert">We couldn’t load the booking page. Check your connection and refresh, or call us at ' +
        '<a href="' + CFG.business.phoneHref + '">' + CFG.business.phone + '</a>.</p>' +
        // technical detail for whoever is fixing it; harmless for clients
        '<p class="muted xs center">' + String((err && (err.message || err.code)) || err).replace(/[&<>]/g, '') + '</p>';
    }
  });

  window.BuffAPI = {
    mode: 'live',
    ready: ready,
    formatTime: mock.formatTime,
    toMin: mock.toMin,
    canDo: mock.canDo,

    // ======== client booking ========
    getAvailability: availability,

    createBooking: function (payload) {
      return sb.rpc('create_booking', { p: payload }).then(unwrap).then(toBooking);
    },

    // ======== client accounts ========

    /** { email, client: { id, name, phone, email } } for a signed-in client, or null. Links the login on first use. */
    getClientAccount: function () {
      return sb.auth.getSession().then(function (res) {
        var session = res.data && res.data.session;
        if (!session) { return null; }
        return sb.rpc('claim_client').then(unwrap).then(function (c) { return { email: session.user.email, client: c }; });
      });
    },

    /** Emails a sign-in link that comes back to this page. */
    clientSignIn: function (email) {
      return sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: location.origin + location.pathname } }).then(unwrap);
    },

    clientSignOut: function () { return sb.auth.signOut(); },

    updateMyProfile: function (name, phone) {
      return sb.rpc('update_my_profile', { p_name: name, p_phone: phone }).then(unwrap);
    },

    myBookings: function () {
      return sb.rpc('my_bookings').then(unwrap).then(function (rows) { return (rows || []).map(toBooking); });
    },

    cancelMyBooking: function (id) {
      return sb.rpc('cancel_my_booking', { p_id: id }).then(unwrap).then(toBooking);
    },

    // ======== sample data (managers) ========
    addSampleWeek: function () { return sb.rpc('add_sample_week').then(unwrap); },
    removeSampleData: function () { return sb.rpc('remove_sample_data').then(unwrap); },

    // ======== clients (staff) ========

    listClients: function () {
      return sb.from('clients').select('id,name,phone,email,staff_note').order('name').order('email').then(unwrap).then(function (rows) {
        return rows.map(function (c) { return { id: c.id, name: c.name, phone: c.phone, email: c.email, staffNote: c.staff_note }; });
      });
    },

    // ======== holding a time while a client finishes booking ========

    holdSlot: function (h) {
      return sb.rpc('hold_slot', { p: { holdToken: h.token, date: h.date, time: h.time, provider: h.provider, guests: h.guests, services: h.services } })
        .then(unwrap).then(function (r) { return { expiresAt: Date.parse(r.expiresAt), providerIds: r.providerIds }; });
    },
    releaseHold: function (token) { return sb.rpc('release_hold', { p_token: token }).then(unwrap); },
    /** Best-effort release while the page is closing: keepalive lets the request finish after the page is gone. */
    releaseHoldOnExit: function (token) {
      try {
        fetch(be.supabaseUrl + '/rest/v1/rpc/release_hold', {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json', apikey: be.supabaseKey },
          body: JSON.stringify({ p_token: token }),
        });
      } catch (e) { /* the hold expires on its own */ }
    },
    listHolds: function (dateISO) {
      return sb.rpc('list_holds', { p_date: dateISO }).then(function (res) {
        if (res.error) { return []; } // database without holds yet
        return (res.data || []).map(function (h) { return { id: h.id, start: h.start, mins: h.mins, providerIds: h.providerIds, expiresAt: Date.parse(h.expiresAt) }; });
      });
    },
    staffReleaseHold: function (id) { return sb.rpc('staff_release_hold', { p_id: id }).then(unwrap); },

    staffCreateBooking: function (payload) {
      return sb.rpc('staff_create_booking', { p: payload }).then(unwrap).then(toBooking);
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

    /** Resolves { email, roles: [...], providerId } for a signed-in user (roles empty if not on staff), or null. */
    getStaff: function () {
      return sb.auth.getSession().then(function (res) {
        var session = res.data && res.data.session;
        if (!session) { return null; }
        return Promise.all([sb.rpc('staff_roles').then(unwrap), sb.rpc('staff_provider_id').then(unwrap)]).then(function (r) {
          return { email: session.user.email, roles: r[0] || [], providerId: r[1] };
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

    // ======== team (managers) ========

    listProviders: function () {
      return sb.from('providers').select('*').order('sort').order('id').then(unwrap).then(function (rows) {
        return rows.map(function (p) { return { id: p.id, name: p.name, initials: p.initials, blurb: p.blurb, sort: p.sort, active: p.active }; });
      });
    },

    saveProvider: function (p, isNew) {
      var row = { name: p.name, initials: p.initials, blurb: p.blurb, sort: p.sort, active: p.active };
      var q = isNew ? sb.from('providers').insert(Object.assign({ id: p.id }, row)) : sb.from('providers').update(row).eq('id', p.id);
      return q.select().single().then(unwrap).then(function () {
        // keep this page's provider list (schedule columns, menus) in step
        return sb.from('providers').select('*').eq('active', true).order('sort').then(unwrap);
      }).then(function (rows) {
        CFG.providers = rows.map(function (x) { return { id: x.id, name: x.name, initials: x.initials, blurb: x.blurb }; });
        return p;
      });
    },

    // ======== business details, hours, booking rules (managers) ========

    getSettings: function () {
      return Promise.all([
        sb.from('settings').select('*').eq('id', 1).single().then(unwrap),
        sb.from('business_hours').select('*').then(unwrap),
      ]).then(function (r) {
        var s = r[0], hours = {};
        for (var d = 0; d < 7; d++) { hours[d] = null; }
        r[1].forEach(function (h) { hours[h.dow] = { open: h.open_time.slice(0, 5), close: h.close_time.slice(0, 5) }; });
        return {
          hasBusiness: s.address != null,
          business: s.address != null
            ? { name: s.business_name, phone: s.phone, address: s.address, cancellationPolicyUrl: s.cancellation_policy_url, cancellationWindowHours: s.cancellation_window_hours }
            : { name: CFG.business.name, phone: CFG.business.phone, address: CFG.business.address, cancellationPolicyUrl: CFG.business.cancellationPolicyUrl, cancellationWindowHours: CFG.business.cancellationWindowHours },
          hours: hours,
          rules: { slotStepMinutes: s.slot_step_min, daysAhead: s.days_ahead, minNoticeMinutes: s.min_notice_min, maxGuests: s.max_guests },
        };
      });
    },

    saveBusiness: function (b) {
      return sb.from('settings').update({
        business_name: b.name, phone: b.phone, address: b.address,
        cancellation_policy_url: b.cancellationPolicyUrl, cancellation_window_hours: b.cancellationWindowHours,
      }).eq('id', 1).select().single().then(unwrap).then(function (s) { applyBusiness(s); return true; });
    },

    /** hours: { 0..6: { open: 'HH:MM', close: 'HH:MM' } | null } — null = closed */
    saveHours: function (hours) {
      var open = [], closed = [];
      for (var d = 0; d < 7; d++) {
        if (hours[d]) { open.push({ dow: d, open_time: hours[d].open, close_time: hours[d].close }); } else { closed.push(d); }
      }
      return (open.length ? sb.from('business_hours').upsert(open).then(unwrap) : Promise.resolve()).then(function () {
        return closed.length ? sb.from('business_hours').delete().in('dow', closed).then(unwrap) : null;
      }).then(function () { CFG.hours = JSON.parse(JSON.stringify(hours)); return true; });
    },

    saveRules: function (r) {
      return sb.from('settings').update({
        slot_step_min: r.slotStepMinutes, days_ahead: r.daysAhead, min_notice_min: r.minNoticeMinutes, max_guests: r.maxGuests,
      }).eq('id', 1).then(unwrap).then(function () { Object.assign(CFG.booking, r); return true; });
    },

    // ======== closed days (managers) ========

    listClosedDates: function () {
      return sb.from('closed_dates').select('date,label').gte('date', isoToday()).order('date').then(unwrap);
    },
    addClosedDate: function (date, label) {
      return sb.from('closed_dates').upsert({ date: date, label: label || '' }).then(unwrap).then(function () { CFG.closedDates[date] = label || ''; return true; });
    },
    removeClosedDate: function (date) {
      return sb.from('closed_dates').delete().eq('date', date).then(unwrap).then(function () { delete CFG.closedDates[date]; return true; });
    },

    // ======== who does which services (managers) ========

    listQualifications: function () {
      return sb.from('provider_services').select('provider_id,service_id').then(unwrap).then(function (rows) {
        var q = {};
        rows.forEach(function (r) { (q[r.provider_id] = q[r.provider_id] || []).push(r.service_id); });
        return q;
      });
    },

    setQualifications: function (providerId, serviceIds) {
      return sb.from('provider_services').delete().eq('provider_id', providerId).then(unwrap).then(function () {
        if (!serviceIds.length) { return null; }
        return sb.from('provider_services').insert(serviceIds.map(function (id) { return { provider_id: providerId, service_id: id }; })).then(unwrap);
      }).then(function () {
        // keep this page's copy in step
        return Promise.all([sb.from('provider_services').select('provider_id,service_id').then(unwrap), sb.from('services').select('id,name').eq('active', true).then(unwrap)]);
      }).then(function (r) { CFG.qualified = qualifiedFrom(r[0], r[1]); return true; });
    },

    // ======== staff logins (managers) ========

    listStaff: function () {
      return sb.from('staff').select('*').order('email').then(unwrap).then(function (rows) {
        return rows.map(function (r) { return { email: r.email, roles: r.roles || [], providerId: r.provider_id }; });
      });
    },

    saveStaff: function (s, isNew) {
      var row = { email: s.email.trim().toLowerCase(), roles: s.roles, provider_id: s.roles.indexOf('provider') >= 0 ? (s.providerId || null) : null };
      var q = isNew ? sb.from('staff').insert(row) : sb.from('staff').update({ roles: row.roles, provider_id: row.provider_id }).eq('email', row.email);
      return q.select().single().then(function (res) {
        if (res.error && res.error.code === '23505') { throw Object.assign(new Error(row.email + ' is already on the staff list.'), { code: 'duplicate' }); }
        return unwrap(res);
      });
    },

    removeStaff: function (email) {
      return sb.from('staff').delete().eq('email', email).then(unwrap);
    },

    // ======== menu (managers) ========

    listMenu: function () {
      return Promise.all([
        sb.from('services').select('*').order('sort').order('id').then(unwrap),
        sb.from('settings').select('*').eq('id', 1).single().then(unwrap),
      ]).then(function (r) {
        var services = r[0].map(fromServiceRow);
        var order = (r[1].category_order || CFG.categoryOrder || []).slice();
        services.forEach(function (s) { if (order.indexOf(s.cat) < 0) { order.push(s.cat); } });
        return { services: services, categories: order };
      });
    },

    saveService: function (s, isNew) {
      var row = { cat: s.cat, name: s.name, price: s.price, mins: s.mins, price_note: s.priceNote || null, sort: s.sort, active: s.active };
      var q = isNew ? sb.from('services').insert(row) : sb.from('services').update(row).eq('id', s.id);
      return q.select().single().then(unwrapDupe).then(function (r) { return refreshMenu().then(function () { return fromServiceRow(r); }); });
    },

    deleteService: function (id) {
      return sb.from('services').delete().eq('id', id).then(unwrap).then(refreshMenu);
    },

    saveCategories: function (order) {
      return sb.from('settings').update({ category_order: order }).eq('id', 1).then(unwrap).then(function () { CFG.categoryOrder = order.slice(); });
    },

    renameCategory: function (from, to) {
      var api = this;
      return sb.from('services').update({ cat: to }).eq('cat', from).then(unwrap).then(function () {
        return api.listMenu();
      }).then(function (m) {
        return api.saveCategories(m.categories.map(function (c) { return c === from ? to : c; }).filter(function (c, i, a) { return a.indexOf(c) === i; }));
      }).then(refreshMenu);
    },

    decideTimeOff: function (id, status) {
      return sb.auth.getSession().then(function (res) {
        return sb.from('time_off').update({ status: status, decided_by: res.data.session.user.email, decided_at: new Date().toISOString() })
          .eq('id', id).select().single().then(unwrap).then(toTimeOff);
      });
    },
  };
})();
