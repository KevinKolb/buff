// Buff Beauty Bar — staff booking (book.html).
// One screen for booking a client on the phone or at the desk, with the day's
// schedule alongside so staff can see what's already booked. Same rules as
// online booking: email required, minimum notice, and the cancellation policy
// read to the client. Managers and reservationists only.

window.BuffAPI.ready.then(function () {
  var CFG = window.BUFF_CONFIG;
  var API = window.BuffAPI;
  var PX = 1.2; // day schedule: pixels per minute

  var CATS = [];
  CFG.services.forEach(function (s) { if (CATS.indexOf(s.cat) < 0) { CATS.push(s.cat); } });
  var ORDER = CFG.categoryOrder || [];
  function rank(c) { var i = ORDER.indexOf(c); return i < 0 ? ORDER.length : i; }
  CATS.sort(function (a, b) { return rank(a) - rank(b); });

  var params = new URLSearchParams(location.search);
  var state = {
    auth: 'checking',   // checking → ok | signin | denied
    staff: null,
    cat: CATS[0],
    selected: [],
    guests: 1,
    provider: 'any',
    date: /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') && params.get('date') >= isoDate(new Date()) ? params.get('date') : isoDate(new Date()),
    slots: null,
    slotsLoading: false,
    slot: null,
    day: null,          // { bookings, timeOff } for state.date
    picked: null,       // appointment tapped on the day schedule
    client: { name: '', phone: '', email: '', note: '', staffNote: '' },
    clients: null,      // every client, for the picker
    clientId: null,     // picked existing client
    clientQuery: '',
    policy: false,
    errors: {},
    notice: '',
    submitting: false,
    result: null,
  };

  // ---------- helpers ----------
  function $(sel) { return document.querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return '$' + n.toLocaleString('en-US'); }
  function isoDate(d) { var m = d.getMonth() + 1, day = d.getDate(); return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day; }
  function fromISO(iso) { return new Date(iso + 'T00:00:00'); }
  function addDays(iso, n) { var d = fromISO(iso); d.setDate(d.getDate() + n); return isoDate(d); }
  function longDate(iso) { return fromISO(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }
  function svc(name) { return CFG.services.filter(function (s) { return s.name === name; })[0]; }
  function providerName(id) { if (id === 'any') { return 'First available'; } var p = CFG.providers.filter(function (x) { return x.id === id; })[0]; return p ? p.name : id; }
  function hoursOn(iso) { var h = CFG.hours[fromISO(iso).getDay()]; return h ? { open: API.toMin(h.open), close: API.toMin(h.close) } : null; }
  function fmt(m) { return API.formatTime(m); }
  function totals() {
    var mins = 0, price = 0;
    state.selected.forEach(function (n) { var s = svc(n); if (s) { mins += s.mins; price += s.price; } });
    return { mins: mins, price: price * state.guests };
  }
  function hasRole(r) { return !!(state.staff && state.staff.roles && state.staff.roles.indexOf(r) >= 0); }

  // ---------- data ----------
  function loadDay() {
    var d = state.date;
    state.day = null; state.picked = null; render();
    return Promise.all([API.listBookings(d), API.timeOffOn(d)]).then(function (r) {
      if (d !== state.date) { return; }
      state.day = { bookings: r[0], timeOff: r[1] }; render();
    }, function () {
      if (d !== state.date) { return; }
      state.day = { error: true }; render();
    });
  }

  function loadSlots() {
    state.slot = null;
    if (!state.selected.length) { state.slots = null; render(); return; }
    var d = state.date, t = totals();
    state.slotsLoading = true; render();
    API.getAvailability(d, t.mins, state.provider, state.guests).then(function (res) {
      if (d !== state.date) { return; }
      state.slots = res; state.slotsLoading = false; render();
    }, function () {
      if (d !== state.date) { return; }
      state.slots = { error: true, slots: [] }; state.slotsLoading = false; render();
    });
  }

  function setDate(iso) {
    state.date = iso; state.notice = '';
    try { history.replaceState(null, '', 'book.html?date=' + iso + location.hash); } catch (e) { /* ignore */ }
    $('#to-desk').href = 'staff.html?date=' + iso;
    loadDay(); loadSlots();
  }

  // ---------- views ----------
  function viewServices() {
    var chips = CATS.map(function (c) {
      return '<button class="chip' + (c === state.cat ? ' is-on' : '') + '" data-act="cat" data-v="' + esc(c) + '" aria-pressed="' + (c === state.cat) + '">' + esc(c) + '</button>';
    }).join('');
    var rows = CFG.services.filter(function (s) { return s.cat === state.cat; }).map(function (s) {
      var on = state.selected.indexOf(s.name) >= 0;
      return '<li><button class="svc' + (on ? ' is-on' : '') + '" data-act="svc" data-v="' + esc(s.name) + '" aria-pressed="' + on + '">' +
        '<span class="svc-main"><span class="svc-name">' + esc(s.name) + '</span><span class="muted sm">' + s.mins + ' min</span></span>' +
        '<span class="svc-price">' + money(s.price) + (s.priceNote || '') + '</span>' +
        '<span class="tick">' + (on ? '✓' : '+') + '</span></button></li>';
    }).join('');
    var picked = state.selected.length
      ? '<p class="sm"><b>Selected:</b> ' + esc(state.selected.join(' + ')) + ' · ' + totals().mins + ' min</p>'
      : '<p class="muted sm">Pick one or more services.</p>';
    return '<div class="card form bk-svc"><div class="row-between"><div class="b">1. Services</div>' +
        '<div class="stepper" role="group" aria-label="Number of guests">' +
          '<span class="muted sm">Guests</span>' +
          '<button class="round" data-act="guests" data-v="-1" aria-label="Fewer guests"' + (state.guests <= 1 ? ' disabled' : '') + '>−</button>' +
          '<output aria-live="polite">' + state.guests + '</output>' +
          '<button class="round" data-act="guests" data-v="1" aria-label="More guests"' + (state.guests >= CFG.booking.maxGuests ? ' disabled' : '') + '>+</button>' +
        '</div></div>' +
      '<div class="chips" role="toolbar" aria-label="Service categories">' + chips + '</div>' +
      '<ul class="list bk-list" aria-label="' + esc(state.cat) + ' services">' + rows + '</ul>' + picked + '</div>';
  }

  function viewWhen() {
    var pros = [['any', 'First available']].concat(CFG.providers.map(function (p) { return [p.id, p.name]; })).map(function (p) {
      return '<option value="' + esc(p[0]) + '"' + (p[0] === state.provider ? ' selected' : '') + '>' + esc(p[1]) + '</option>';
    }).join('');
    var body;
    if (!state.selected.length) { body = '<p class="muted sm">Pick services to see open times.</p>'; }
    else if (state.slotsLoading || !state.slots) { body = '<p class="muted sm" role="status">Finding open times…</p>'; }
    else if (state.slots.error) { body = '<p class="muted sm">Couldn’t load open times. <button class="link sm" data-act="retry">Try again</button></p>'; }
    else if (state.slots.closed) { body = '<p class="muted sm">Closed this day.</p>'; }
    else {
      var open = state.slots.slots.filter(function (s) { return s.available; });
      body = open.length
        ? '<div class="times">' + open.map(function (s) {
            var on = state.slot && state.slot.time === s.time;
            return '<button class="time' + (on ? ' is-on' : '') + '" data-act="slot" data-v="' + s.time + '" aria-pressed="' + on + '">' + s.label + '</button>';
          }).join('') + '</div>'
        : '<p class="muted sm">No openings this day for ' + totals().mins + ' minutes' + (state.guests > 1 ? ' and ' + state.guests + ' guests' : '') + '. Try another day or provider.</p>';
    }
    return '<div class="card form bk-when"><div class="b">2. Provider, day and time</div>' +
      '<div class="field"><label for="bk-pro">Provider</label><select id="bk-pro" name="provider">' + pros + '</select></div>' +
      '<div class="field"><label for="bk-date">Day</label><div class="bk-datenav">' +
        '<button class="round" data-act="day" data-v="-1" aria-label="Previous day"' + (state.date <= isoDate(new Date()) ? ' disabled' : '') + '>‹</button>' +
        '<input id="bk-date" name="date" type="date" min="' + isoDate(new Date()) + '" value="' + esc(state.date) + '">' +
        '<button class="round" data-act="day" data-v="1" aria-label="Next day">›</button></div>' +
        '<span class="muted xs">' + esc(longDate(state.date)) + '</span></div>' +
      (state.notice ? '<p class="notice" role="alert">' + esc(state.notice) + '</p>' : '') +
      body + '</div>';
  }

  function field(id, label, type, ph, hint) {
    var err = state.errors[id];
    return '<div class="field' + (err ? ' has-err' : '') + '"><label for="bk-' + id + '">' + label + '</label>' +
      '<input id="bk-' + id + '" name="' + id + '" type="' + type + '" autocomplete="off" placeholder="' + esc(ph) + '" value="' + esc(state.client[id]) + '"' + (err ? ' aria-invalid="true" aria-describedby="be-' + id + '"' : '') + '>' +
      (err ? '<span class="err" id="be-' + id + '">' + esc(err) + '</span>' : (hint ? '<span class="muted xs">' + hint + '</span>' : '')) + '</div>';
  }

  // ----- client picker -----
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function matches(q) {
    q = q.trim().toLowerCase();
    if (!q || !state.clients) { return []; }
    var qd = digits(q);
    return state.clients.filter(function (c) {
      return (c.name || '').toLowerCase().indexOf(q) >= 0 || (c.email || '').indexOf(q) >= 0 ||
        (qd.length >= 3 && digits(c.phone).indexOf(qd) >= 0);
    }).slice(0, 8);
  }
  function matchList() {
    var q = state.clientQuery.trim();
    if (!q) { return ''; }
    var list = matches(q);
    if (!list.length) { return '<li class="bk-nomatch muted sm">No client matches “' + esc(q) + '”. Fill in their details below to add them.</li>'; }
    return list.map(function (c) {
      return '<li><button type="button" class="bk-match" data-act="pick-client" data-v="' + esc(c.id) + '">' +
        '<span class="b">' + esc(c.name || '(no name)') + '</span><span class="muted xs">' + esc([c.phone, c.email].filter(Boolean).join(' · ')) + '</span></button></li>';
    }).join('');
  }
  function viewPicker() {
    if (state.clientId) {
      return '<div class="bk-picked"><span>Booking for an existing client. Changes below update their record.</span>' +
        '<button class="link sm" data-act="new-client">New client instead</button></div>';
    }
    return '<div class="field bk-pick"><label for="bk-find">Find a client</label>' +
      '<input id="bk-find" type="search" autocomplete="off" placeholder="' + (state.clients ? 'Name, mobile or email' : 'Loading clients…') + '" value="' + esc(state.clientQuery) + '" aria-controls="bk-matches">' +
      '<ul id="bk-matches" class="bk-matches" aria-label="Matching clients">' + matchList() + '</ul>' +
      '<span class="muted xs">Or fill in a new client’s details below.</span></div>';
  }
  function pickClient(id) {
    var c = (state.clients || []).filter(function (x) { return x.id === id; })[0];
    if (!c) { return; }
    state.clientId = c.id; state.clientQuery = '';
    state.client = { name: c.name || '', phone: c.phone || '', email: c.email || '', note: '', staffNote: c.staffNote || '' };
    state.errors = {};
    render();
    var f = $('#bk-name'); if (f) { f.focus(); }
  }
  function loadClients() {
    return API.listClients().then(function (list) { state.clients = list; render(); }, function () { state.clients = []; render(); });
  }

  function viewClient() {
    var t = totals();
    var summary = state.slot
      ? '<div class="card summary bk-summary"><div class="label">Booking</div>' +
          '<div class="b lg">' + esc(longDate(state.date)) + ' at ' + esc(state.slot.label) + '</div>' +
          '<div>' + esc(state.selected.join(' + ')) + '</div>' +
          '<div class="muted sm">' + esc(state.slot.providerIds.map(providerName).join(', ')) + ' · ' + t.mins + ' min' + (state.guests > 1 ? ' · ' + state.guests + ' guests' : '') + ' · ' + money(t.price) + '</div></div>'
      : '<p class="muted sm">Pick a time above.</p>';
    var policyErr = state.errors.policy;
    return '<div class="card form bk-client"><div class="b">3. Client</div>' + viewPicker() +
      '<form id="bk-form" class="bk-fields" novalidate>' +
        field('name', 'Name', 'text', 'First and last') +
        field('phone', 'Mobile', 'tel', '(504) 555-0123') +
        field('email', 'Email', 'email', 'client@email.com', 'For their confirmation') +
        field('note', 'Note for this visit (optional)', 'text', 'Nail art idea, guest names…') +
        '<div class="field"><label for="bk-staffNote">Client notes (staff only)</label>' +
          '<textarea id="bk-staffNote" name="staffNote" rows="2" placeholder="Allergies, preferences… Saved on their record, never shown to the client.">' + esc(state.client.staffNote) + '</textarea></div>' +
      '</form>' +
      '<div class="bk-card"><div class="row-between"><span class="b sm">Card on file</span><span class="muted xs">Secured by Stripe</span></div>' +
        '<div class="card-mock" aria-label="Card details (coming soon)"><span>Card number · MM/YY · CVC</span></div>' +
        '<p class="muted xs">Card entry connects to Stripe in a later build.</p></div>' +
      '<label class="agree' + (policyErr ? ' has-err' : '') + '"><input type="checkbox" id="bk-policy"' + (state.policy ? ' checked' : '') + '>' +
        '<span>I read the <a href="' + CFG.business.cancellationPolicyUrl + '" target="_blank" rel="noopener">cancellation policy</a> to the client and they agreed: cancellations within ' + CFG.business.cancellationWindowHours + ' hours or no-shows may be charged.</span></label>' +
      (policyErr ? '<span class="err">' + esc(policyErr) + '</span>' : '') +
      summary +
      (state.errors.form ? '<p class="notice" role="alert">' + esc(state.errors.form) + '</p>' : '') +
      '<button class="btn-primary" data-act="book"' + (state.submitting ? ' disabled' : '') + '>' + (state.submitting ? 'Booking…' : 'Book for client') + '</button>' +
    '</div>';
  }

  function viewDone() {
    var r = state.result;
    return '<div class="card form bk-client bk-done">' +
      '<div class="done-badge">✓</div>' +
      '<h2 class="h1 center">Booked for ' + esc(r.client.name) + '</h2>' +
      '<p class="center">Read them their reference: <b>' + esc(r.id) + '</b></p>' +
      '<p class="center muted sm">' + esc(longDate(r.date)) + ' at ' + esc(fmt(r.start)) + ' · ' + esc(r.services.join(' + ')) + '</p>' +
      '<p class="center muted xs">They can cancel online with this reference and their mobile number.</p>' +
      '<button class="btn-primary" data-act="another">Book another client</button>' +
      '<a class="btn-outline as-link" href="staff.html?date=' + esc(r.date) + '">Open the schedule</a></div>';
  }

  function viewDay() {
    var hrs = hoursOn(state.date);
    var head = '<div class="row-between"><div class="b">' + esc(longDate(state.date)) + '</div>';
    if (!state.day) { return '<div class="card form bk-day">' + head + '</div><p class="muted sm" role="status">Loading the day…</p></div>'; }
    if (state.day.error) { return '<div class="card form bk-day">' + head + '</div><p class="muted sm">Couldn’t load the day’s bookings.</p></div>'; }
    var live = state.day.bookings.filter(function (b) { return b.status !== 'cancelled'; });
    head += '<span class="muted sm">' + live.length + ' booked</span></div>';
    if (!hrs) { return '<div class="card form bk-day">' + head + '<p class="muted sm">Closed this day.</p></div>'; }

    var height = (hrs.close - hrs.open) * PX;
    var rail = '';
    for (var m = hrs.open; m < hrs.close; m += 60) { rail += '<div class="s-hour" style="top:' + ((m - hrs.open) * PX) + 'px">' + fmt(m).replace(':00', '') + '</div>'; }
    var ghostStart = state.slot ? API.toMin(state.slot.time) : null;
    var cols = CFG.providers.map(function (p) {
      var blocks = '';
      state.day.timeOff.filter(function (t) { return t.providerId === p.id; }).forEach(function (t) {
        var s = Math.max(t.start, hrs.open), e = Math.min(t.end, hrs.close);
        if (e <= s) { return; }
        blocks += '<div class="s-off' + (t.status === 'pending' ? ' is-pending' : '') + '" style="top:' + ((s - hrs.open) * PX) + 'px;height:' + ((e - s) * PX - 2) + 'px"><span class="b">' + (t.status === 'pending' ? 'Off (requested)' : 'Off') + '</span></div>';
      });
      live.filter(function (b) { return b.providerIds.indexOf(p.id) >= 0; }).forEach(function (b) {
        var h = b.mins * PX - 2;
        blocks += '<button class="s-appt is-' + b.status + (b.sample ? ' is-sample' : '') + (h < 34 ? ' is-short' : '') + '" data-act="pick" data-v="' + esc(b.id) + '" style="top:' + ((b.start - hrs.open) * PX) + 'px;height:' + h + 'px">' +
          '<span class="s-appt-time">' + fmt(b.start) + '</span><span class="s-appt-name">' + esc(b.client.name) + '</span></button>';
      });
      if (state.slot && state.slot.providerIds.indexOf(p.id) >= 0) {
        blocks += '<div class="s-ghost" style="top:' + ((ghostStart - hrs.open) * PX) + 'px;height:' + (totals().mins * PX - 2) + 'px"><span class="b">New: ' + esc(state.slot.label) + '</span></div>';
      }
      return '<div class="s-col"><div class="s-colhead"><span class="avatar sm">' + esc(p.initials) + '</span><span>' + esc(p.name) + '</span></div>' +
        '<div class="s-colbody" style="height:' + height + 'px">' + blocks + '</div></div>';
    }).join('');

    var b = state.picked && state.day.bookings.filter(function (x) { return x.id === state.picked; })[0];
    var info = b
      ? '<div class="bk-info"><div class="b">' + esc(b.client.name) + '</div>' +
          '<div class="sm">' + fmt(b.start) + '–' + fmt(b.start + b.mins) + ' · ' + esc(b.services.join(', ')) + '</div>' +
          '<div class="muted sm">' + esc(b.providerIds.map(providerName).join(', ')) + (b.client.phone ? ' · <a href="tel:' + esc(b.client.phone.replace(/[^\d+]/g, '')) + '">' + esc(b.client.phone) + '</a>' : '') + '</div>' +
          (b.client.note ? '<div class="muted sm">“' + esc(b.client.note) + '”</div>' : '') + '</div>'
      : '<p class="muted xs">Tap an appointment for details. The dashed block is the booking you’re making.</p>';

    return '<div class="card form bk-day">' + head +
      '<div class="s-sched bk-sched" tabindex="0" aria-label="Bookings for ' + esc(longDate(state.date)) + '">' +
        '<div class="s-grid" style="--cols:' + CFG.providers.length + '">' +
          '<div class="s-rail"><div class="s-colhead"></div><div class="s-railbody" style="height:' + height + 'px">' + rail + '</div></div>' +
          '<div class="s-cols" style="background-size:100% ' + (60 * PX) + 'px">' + cols + '</div>' +
        '</div></div>' + info + '</div>';
  }

  function viewAuth() {
    if (state.auth === 'checking') { return '<p class="muted center pad" role="status">Checking sign-in…</p>'; }
    if (state.auth === 'signin') {
      return '<div class="card form s-auth"><h1 class="h1">Sign in first</h1><p>Booking for clients is for staff. Sign in at the front desk, then come back here.</p>' +
        '<a class="btn-primary as-link" href="staff.html">Go to the front desk</a></div>';
    }
    return '<div class="card form s-auth"><h1 class="h1">Not available</h1><p>Booking for clients needs the <b>Reservationist</b> or <b>Manager</b> role. Ask a manager to add it on the Team tab.</p>' +
      '<a class="btn-outline as-link" href="staff.html">Back to the front desk</a></div>';
  }

  function render() {
    var main = $('#b-main');
    if (state.auth !== 'ok') { main.innerHTML = viewAuth(); return; }
    var sched = $('.bk-sched');
    var keep = sched ? { top: sched.scrollTop, left: sched.scrollLeft } : null;
    main.innerHTML = '<h1 class="h1">Book a client</h1>' +
      '<div class="bk">' + viewServices() + viewWhen() + viewDay() + (state.result ? viewDone() : viewClient()) + '</div>';
    sched = $('.bk-sched');
    if (sched) {
      if (keep) { sched.scrollTop = keep.top; sched.scrollLeft = keep.left; }
      if (state.scrollToSlot && state.slot) { // bring the new booking into view
        var hrs = hoursOn(state.date);
        sched.scrollTop = Math.max(0, (API.toMin(state.slot.time) - hrs.open - 30) * PX);
        state.scrollToSlot = false;
      }
    }
  }

  // ---------- booking ----------
  function validate() {
    var c = state.client, e = {};
    if (!state.selected.length || !state.slot) { e.form = 'Pick services and a time first.'; }
    if (c.name.trim().length < 2) { e.name = 'Please enter the client’s name.'; }
    if (c.phone.replace(/\D/g, '').length < 10) { e.phone = 'Please enter a 10-digit mobile number.'; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) { e.email = 'Please enter the client’s email.'; }
    if (!state.policy) { e.policy = 'Read the cancellation policy to the client and tick this box.'; }
    state.errors = e;
    return Object.keys(e).length === 0;
  }

  function book() {
    if (!validate()) {
      render();
      var first = document.querySelector('[aria-invalid="true"], .agree.has-err input');
      if (first) { first.focus(); }
      return;
    }
    state.submitting = true; render();
    var t = totals();
    API.staffCreateBooking({
      services: state.selected.slice(), guests: state.guests, mins: t.mins, total: t.price,
      provider: state.provider, date: state.date, time: state.slot.time, providerIds: state.slot.providerIds,
      policyAgreed: true, clientId: state.clientId || undefined,
      client: { name: state.client.name.trim(), phone: state.client.phone.trim(), email: state.client.email.trim(), note: state.client.note.trim(), staffNote: state.client.staffNote.trim() },
    }).then(function (rec) {
      state.submitting = false; state.result = rec; state.errors = {};
      state.slot = null; // the dashed preview becomes the real booking on the day schedule
      loadDay(); loadSlots(); loadClients();
    }, function (err) {
      state.submitting = false;
      if (err.code === 'taken') { state.notice = 'That time was just booked. Please pick another.'; loadSlots(); loadDay(); return; }
      var msg = {
        not_allowed: 'Your login doesn’t have the Reservationist or Manager role.',
        policy_required: 'Tick the cancellation policy box.',
        invalid_client: 'Check the client’s name, mobile and email.',
        invalid_services: 'One of those services is no longer on the menu. Refresh the page.',
        email_in_use: 'Another client already uses that email. Find them with the search instead.',
        client_not_found: 'That client record is gone. Tap “New client instead” and try again.',
      }[err.code];
      state.errors = { form: msg || 'Something went wrong. Check your connection and try again.' };
      render();
    });
  }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled) { return; }
    var act = el.getAttribute('data-act'), v = el.getAttribute('data-v');
    if (act === 'cat') { state.cat = v; render(); }
    else if (act === 'svc') {
      var i = state.selected.indexOf(v);
      if (i >= 0) { state.selected.splice(i, 1); } else { state.selected.push(v); }
      loadSlots();
    }
    else if (act === 'guests') { state.guests = Math.max(1, Math.min(CFG.booking.maxGuests, state.guests + +v)); loadSlots(); }
    else if (act === 'day') { setDate(addDays(state.date, +v)); }
    else if (act === 'retry') { loadSlots(); }
    else if (act === 'slot') {
      state.slot = state.slots.slots.filter(function (x) { return x.time === v; })[0];
      state.notice = ''; state.scrollToSlot = true; render();
    }
    else if (act === 'pick') { state.picked = state.picked === v ? null : v; render(); }
    else if (act === 'book') { book(); }
    else if (act === 'pick-client') { pickClient(v); }
    else if (act === 'new-client') {
      state.clientId = null; state.client = { name: '', phone: '', email: '', note: '', staffNote: '' }; state.errors = {};
      render(); var q = $('#bk-find'); if (q) { q.focus(); }
    }
    else if (act === 'another') {
      state.result = null; state.selected = []; state.guests = 1; state.provider = 'any'; state.slot = null; state.slots = null;
      state.client = { name: '', phone: '', email: '', note: '', staffNote: '' }; state.policy = false; state.errors = {};
      state.clientId = null; state.clientQuery = '';
      render(); window.scrollTo(0, 0);
    }
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.form && t.form.id === 'bk-form' && t.name) { state.client[t.name] = t.value; }
    if (t.id === 'bk-find') { state.clientQuery = t.value; $('#bk-matches').innerHTML = matchList(); } // only the list, so typing isn't interrupted
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'bk-policy') { state.policy = t.checked; if (t.checked) { delete state.errors.policy; } }
    else if (t.id === 'bk-pro') { state.provider = t.value; loadSlots(); }
    else if (t.id === 'bk-date' && /^\d{4}-\d{2}-\d{2}$/.test(t.value)) { setDate(t.value < isoDate(new Date()) ? isoDate(new Date()) : t.value); }
  });

  // ---------- start ----------
  $('#to-desk').href = 'staff.html?date=' + state.date;
  render();
  API.getStaff().then(function (s) {
    state.staff = s;
    state.auth = !s ? 'signin' : (hasRole('manager') || hasRole('reservationist')) ? 'ok' : 'denied';
    render();
    if (state.auth === 'ok') { loadDay(); loadClients(); }
  }, function () {
    state.auth = 'signin'; render();
  });
});
