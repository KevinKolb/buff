// Buff Beauty Bar — client booking flow.
// Steps: 1 services → 2 provider → 3 date & time → 4 details → 5 confirmation.

(function () {
  var CFG = window.BUFF_CONFIG;
  var API = window.BuffAPI;

  var CATS = [];
  CFG.services.forEach(function (s) { if (CATS.indexOf(s.cat) < 0) { CATS.push(s.cat); } });

  var state = {
    step: 1,
    cat: CATS[0],
    selected: [],          // service names
    guests: 1,
    provider: 'any',
    date: null,            // 'YYYY-MM-DD'
    slot: null,            // { time, label, providerIds }
    waitlist: false,
    slotsLoading: false,
    slots: null,           // result of getAvailability
    client: { name: '', phone: '', email: '', note: '', agree: false },
    errors: {},
    submitting: false,
    result: null,
  };

  var STEP_LABELS = ['Services', 'Provider', 'Date & time', 'Your details'];

  // ---------- helpers ----------
  function $(sel) { return document.querySelector(sel); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function svc(name) { return CFG.services.filter(function (s) { return s.name === name; })[0]; }
  function totals() {
    var mins = 0, price = 0;
    state.selected.forEach(function (n) { var s = svc(n); mins += s.mins; price += s.price; });
    return { mins: mins, price: price * state.guests, perGuest: price };
  }
  function money(n) { return '$' + n.toLocaleString('en-US'); }
  function isoDate(d) { var m = d.getMonth() + 1, day = d.getDate(); return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day; }
  function fromISO(iso) { return new Date(iso + 'T00:00:00'); }
  function longDate(iso) { return fromISO(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }
  function providerName(id) { if (id === 'any') { return 'First available'; } return CFG.providers.filter(function (p) { return p.id === id; })[0].name; }
  function icon(name) {
    var paths = {
      check: '<path d="M20 6L9 17l-5-5"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      minus: '<path d="M5 12h14"/>',
      star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
      card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    };
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';
  }

  function go(step) {
    state.step = step;
    render();
    var main = $('#main');
    main.scrollTop = 0;
    var h = main.querySelector('h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  function loadSlots() {
    if (!state.date) { return; }
    state.slotsLoading = true; state.slot = null; state.waitlist = false;
    render();
    var t = totals();
    var reqDate = state.date;
    API.getAvailability(reqDate, t.mins, state.provider, state.guests).then(function (res) {
      if (reqDate !== state.date) { return; } // a newer request is in flight
      state.slots = res; state.slotsLoading = false;
      render();
    });
  }

  // ---------- step views ----------
  function viewServices() {
    var chips = CATS.map(function (c) {
      return '<button class="chip' + (c === state.cat ? ' is-on' : '') + '" data-act="cat" data-v="' + esc(c) + '" aria-pressed="' + (c === state.cat) + '">' + esc(c) + '</button>';
    }).join('');
    var rows = CFG.services.filter(function (s) { return s.cat === state.cat; }).map(function (s) {
      var on = state.selected.indexOf(s.name) >= 0;
      return '<li><button class="svc' + (on ? ' is-on' : '') + '" data-act="svc" data-v="' + esc(s.name) + '" aria-pressed="' + on + '">' +
        '<span class="svc-main"><span class="svc-name">' + esc(s.name) + '</span><span class="muted sm">' + s.mins + ' min</span></span>' +
        '<span class="svc-price">' + money(s.price) + (s.priceNote || '') + '</span>' +
        '<span class="tick">' + icon(on ? 'check' : 'plus') + '</span></button></li>';
    }).join('');
    return '' +
      '<h1 class="h1">What are we doing today?</h1>' +
      '<div class="card row-between guests">' +
        '<div><div class="b">Who’s coming?</div><div class="muted sm">Up to ' + CFG.booking.maxGuests + ' people, same time</div></div>' +
        '<div class="stepper" role="group" aria-label="Number of guests">' +
          '<button class="round" data-act="guests" data-v="-1" aria-label="Fewer guests"' + (state.guests <= 1 ? ' disabled' : '') + '>' + icon('minus') + '</button>' +
          '<output aria-live="polite">' + state.guests + '</output>' +
          '<button class="round" data-act="guests" data-v="1" aria-label="More guests"' + (state.guests >= CFG.booking.maxGuests ? ' disabled' : '') + '>' + icon('plus') + '</button>' +
        '</div>' +
      '</div>' +
      (state.guests > 1 ? '<p class="muted sm center">Each guest gets the same services, side by side. Need something different for each? Add a note at checkout.</p>' : '') +
      '<div class="chips" role="toolbar" aria-label="Service categories">' + chips + '</div>' +
      '<ul class="card list" aria-label="' + esc(state.cat) + ' services">' + rows + '</ul>' +
      '<p class="muted sm center">Nail art, extra styling time or something not listed? Add a note at checkout.</p>';
  }

  function viewProvider() {
    var opts = [{ id: 'any', name: 'First available', initials: '', blurb: 'Most openings' }].concat(CFG.providers);
    var rows = opts.map(function (p) {
      var on = state.provider === p.id;
      return '<li><button class="pro' + (on ? ' is-on' : '') + '" data-act="pro" data-v="' + p.id + '" aria-pressed="' + on + '">' +
        '<span class="avatar">' + (p.id === 'any' ? icon('star') : esc(p.initials)) + '</span>' +
        '<span class="svc-main"><span class="svc-name">' + esc(p.name) + '</span><span class="muted sm">' + esc(p.blurb) + '</span></span>' +
        (on ? '<span class="tick is-on">' + icon('check') + '</span>' : '') + '</button></li>';
    }).join('');
    return '<h1 class="h1">Who would you like?</h1>' +
      (state.guests > 1 ? '<p class="muted sm">With ' + state.guests + ' guests, your pick is for you — we’ll pair your guests with other pros working at the same time.</p>' : '') +
      '<ul class="stack">' + rows + '</ul>';
  }

  function viewTime() {
    var days = [];
    var start = new Date(); start.setHours(0, 0, 0, 0);
    for (var i = 0; i < CFG.booking.daysAhead; i++) {
      var d = new Date(start); d.setDate(start.getDate() + i);
      var iso = isoDate(d), closed = !CFG.hours[d.getDay()];
      var on = iso === state.date;
      days.push('<button class="day' + (on ? ' is-on' : '') + '" data-act="date" data-v="' + iso + '"' + (closed ? ' disabled aria-label="' + esc(longDate(iso)) + ', closed"' : ' aria-label="' + esc(longDate(iso)) + '"') + ' aria-pressed="' + on + '">' +
        '<span class="dow">' + (i === 0 ? 'TODAY' : d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()) + '</span>' +
        '<span class="dnum">' + d.getDate() + '</span>' +
        '<span class="mon">' + d.toLocaleDateString('en-US', { month: 'short' }) + '</span></button>');
    }

    var body = '';
    if (!state.date) {
      body = '<p class="muted center pad">Pick a day to see open times.</p>';
    } else if (state.slotsLoading || !state.slots) {
      body = '<p class="muted center pad" role="status">Finding open times…</p>';
    } else if (state.slots.closed) {
      body = '<p class="muted center pad">We’re closed this day.</p>';
    } else {
      var avail = state.slots.slots.filter(function (s) { return s.available; });
      var groups = [['Morning', 0, 12 * 60], ['Afternoon', 12 * 60, 17 * 60], ['Evening', 17 * 60, 24 * 60]];
      body = groups.map(function (g) {
        var inG = avail.filter(function (s) { var p = s.time.split(':'); var m = +p[0] * 60 + +p[1]; return m >= g[1] && m < g[2]; });
        if (!inG.length) { return ''; }
        return '<h2 class="label">' + g[0] + '</h2><div class="times">' + inG.map(function (s) {
          var on = state.slot && state.slot.time === s.time;
          return '<button class="time' + (on ? ' is-on' : '') + '" data-act="slot" data-v="' + s.time + '" aria-pressed="' + on + '">' + s.label + '</button>';
        }).join('') + '</div>';
      }).join('');
      if (!avail.length) { body = '<p class="muted center pad">No openings this day for ' + totals().mins + ' minutes.</p>'; }
    }

    var wl = state.date && state.slots && !state.slots.closed && !state.slotsLoading
      ? '<button class="ghost-dashed' + (state.waitlist ? ' is-on' : '') + '" data-act="waitlist" aria-pressed="' + state.waitlist + '">' + icon('clock') +
        (state.waitlist ? 'You’ll join the waitlist for ' + esc(longDate(state.date)) : 'Don’t see your time? Join the waitlist') + '</button>'
      : '';

    return '<h1 class="h1">When works for you?</h1>' +
      '<div class="days" role="toolbar" aria-label="Choose a day">' + days.join('') + '</div>' +
      (state.date ? '<div class="label">' + esc(longDate(state.date)) + ' · ' + totals().mins + ' min · ' + esc(providerName(state.provider)) + '</div>' : '') +
      '<div class="card pad-sm">' + body + '</div>' + wl;
  }

  function field(id, label, type, ac, ph, hint) {
    var err = state.errors[id];
    return '<div class="field' + (err ? ' has-err' : '') + '"><label for="f-' + id + '">' + label + '</label>' +
      '<input id="f-' + id + '" name="' + id + '" type="' + type + '"' + (ac ? ' autocomplete="' + ac + '"' : '') + ' placeholder="' + esc(ph) + '" value="' + esc(state.client[id]) + '"' + (err ? ' aria-invalid="true" aria-describedby="e-' + id + '"' : '') + '>' +
      (err ? '<span class="err" id="e-' + id + '">' + esc(err) + '</span>' : (hint ? '<span class="muted xs">' + hint + '</span>' : '')) + '</div>';
  }

  function summaryCard() {
    var t = totals();
    var when = state.waitlist ? longDate(state.date) + ' · waitlist' : longDate(state.date) + ' at ' + state.slot.label;
    return '<div class="card summary"><div class="label">Your visit</div>' +
      '<div class="b lg">' + esc(when) + '</div>' +
      '<div>' + esc(state.selected.join(' + ')) + '</div>' +
      '<div class="muted sm">' + esc(providerName(state.provider)) + ' · ' + t.mins + ' min' + (state.guests > 1 ? ' · ' + state.guests + ' guests' : '') + ' · ' + money(t.price) + '</div></div>';
  }

  function viewDetails() {
    var agreeErr = state.errors.agree;
    return '<h1 class="h1">Almost done</h1>' + summaryCard() +
      '<form id="details" class="card form" novalidate>' +
        field('name', 'Name', 'text', 'name', 'First and last') +
        field('phone', 'Mobile', 'tel', 'tel', '(504) 555-0123', 'For your confirmation and reminder texts') +
        field('email', 'Email', 'email', 'email', 'you@email.com') +
        field('note', 'Note (optional)', 'text', '', 'Nail art idea, guest names…') +
      '</form>' +
      (state.waitlist ? '' :
      '<div class="card form">' +
        '<div class="row-between"><span class="b sm">Card on file</span><span class="muted xs">Secured by Stripe</span></div>' +
        '<div class="card-mock" aria-label="Card details (coming soon)">' + icon('card') + '<span>Card number · MM/YY · CVC</span></div>' +
        '<p class="muted xs">Prototype: card entry connects to Stripe in the next build. You won’t be charged today.</p>' +
      '</div>') +
      '<label class="agree' + (agreeErr ? ' has-err' : '') + '"><input type="checkbox" id="f-agree"' + (state.client.agree ? ' checked' : '') + '>' +
        '<span>I agree to the <a href="' + CFG.business.cancellationPolicyUrl + '" target="_blank" rel="noopener">cancellation policy</a>. Cancellations within ' + CFG.business.cancellationWindowHours + ' hours or no-shows may be charged.</span></label>' +
      (agreeErr ? '<span class="err">' + esc(agreeErr) + '</span>' : '');
  }

  function viewDone() {
    var r = state.result;
    var wl = state.waitlist;
    return '<div class="done">' +
      '<div class="done-badge">' + icon('check') + '</div>' +
      '<h1 class="h1 center">' + (wl ? 'You’re on the waitlist' : 'You’re booked!') + '</h1>' +
      '<p class="center muted">' + (wl ? 'We’ll text you the moment a spot opens. First to claim it gets it.' : 'Confirmation is on its way by text and email. We’ll remind you ' + CFG.business.cancellationWindowHours + ' hours before.') + '</p>' +
      summaryCard() +
      '<p class="center xs muted">Reference ' + esc(r.id) + ' · ' + esc(CFG.business.name) + ', ' + esc(CFG.business.address) + '</p>' +
      (wl ? '' : '<button class="btn-outline" data-act="ics">Add to calendar</button>') +
      '<button class="link" data-act="restart">Book another visit</button></div>';
  }

  // ---------- render ----------
  function canContinue() {
    if (state.step === 1) { return state.selected.length > 0; }
    if (state.step === 2) { return true; }
    if (state.step === 3) { return !!state.slot || state.waitlist; }
    if (state.step === 4) { return !state.submitting; }
    return false;
  }

  function render() {
    var s = state.step;
    $('#back').hidden = !(s > 1 && s < 5);
    var prog = $('#progress');
    prog.hidden = s >= 5;
    if (s < 5) {
      $('#step-label').textContent = STEP_LABELS[s - 1];
      $('#step-count').textContent = 'Step ' + s + ' of 4';
      $('#bar-fill').style.width = (s * 25) + '%';
    }
    var views = [viewServices, viewProvider, viewTime, viewDetails, viewDone];
    // keep horizontal strips (days, categories) and the page where they were across re-renders
    var main = $('#main');
    var keep = { top: main.scrollTop, days: ($('.days') || {}).scrollLeft || 0, chips: ($('.chips') || {}).scrollLeft || 0 };
    main.innerHTML = views[s - 1]();
    main.scrollTop = keep.top;
    if ($('.days')) { $('.days').scrollLeft = keep.days; }
    if ($('.chips')) { $('.chips').scrollLeft = keep.chips; }

    var foot = $('#footer');
    foot.hidden = s >= 5;
    if (s < 5) {
      var t = totals();
      $('#foot-sub').textContent = state.selected.length
        ? state.selected.length + ' service' + (state.selected.length === 1 ? '' : 's') + ' · ' + t.mins + ' min' + (state.guests > 1 ? ' · ×' + state.guests : '')
        : 'Choose a service';
      $('#foot-total').textContent = money(t.price);
      var btn = $('#next');
      btn.disabled = !canContinue();
      btn.textContent = s === 4 ? (state.submitting ? 'Booking…' : (state.waitlist ? 'Join waitlist' : 'Book now')) : 'Continue';
    }
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
      state.slots = null; state.slot = null; render();
    }
    else if (act === 'guests') { state.guests = Math.max(1, Math.min(CFG.booking.maxGuests, state.guests + +v)); state.slots = null; state.slot = null; render(); }
    else if (act === 'pro') { state.provider = v; state.slots = null; state.slot = null; render(); }
    else if (act === 'date') { state.date = v; loadSlots(); }
    else if (act === 'slot') {
      state.slot = state.slots.slots.filter(function (x) { return x.time === v; })[0];
      state.waitlist = false; render();
    }
    else if (act === 'waitlist') { state.waitlist = !state.waitlist; if (state.waitlist) { state.slot = null; } render(); }
    else if (act === 'restart') {
      state.step = 1; state.selected = []; state.guests = 1; state.provider = 'any'; state.date = null; state.slot = null; state.slots = null; state.waitlist = false; state.result = null; state.errors = {};
      go(1);
    }
    else if (act === 'ics') { downloadIcs(); }
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.form && t.form.id === 'details' && t.name) { state.client[t.name] = t.value; }
    if (t.id === 'f-agree') { state.client.agree = t.checked; }
  });
  document.addEventListener('change', function (e) { if (e.target.id === 'f-agree') { state.client.agree = e.target.checked; } });

  $('#back').addEventListener('click', function () { go(Math.max(1, state.step - 1)); });

  $('#next').addEventListener('click', function () {
    if (!canContinue()) { return; }
    if (state.step === 2) {
      // default to today-or-next-open day so times show immediately
      if (!state.date) {
        var d = new Date();
        for (var i = 0; i < 7 && !CFG.hours[d.getDay()]; i++) { d.setDate(d.getDate() + 1); }
        state.date = isoDate(d);
      }
      go(3); loadSlots(); return;
    }
    if (state.step === 4) { submit(); return; }
    go(state.step + 1);
  });

  function validate() {
    var c = state.client, e = {};
    if (c.name.trim().split(/\s+/).length < 2) { e.name = 'Please enter your first and last name.'; }
    if (c.phone.replace(/\D/g, '').length < 10) { e.phone = 'Please enter a 10-digit mobile number.'; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) { e.email = 'Please enter a valid email.'; }
    if (!c.agree) { e.agree = 'Please agree to the cancellation policy.'; }
    state.errors = e;
    return Object.keys(e).length === 0;
  }

  function submit() {
    if (!validate()) {
      render();
      var first = document.querySelector('[aria-invalid="true"], .agree.has-err input');
      if (first) { first.focus(); }
      return;
    }
    state.submitting = true; render();
    var t = totals();
    var payload = {
      services: state.selected.slice(), guests: state.guests, mins: t.mins, total: t.price,
      provider: state.provider, date: state.date,
      client: { name: state.client.name.trim(), phone: state.client.phone.trim(), email: state.client.email.trim(), note: state.client.note.trim() },
    };
    var p = state.waitlist ? API.joinWaitlist(payload)
      : API.createBooking(Object.assign(payload, { time: state.slot.time, providerIds: state.slot.providerIds }));
    p.then(function (res) { state.submitting = false; state.result = res; go(5); });
  }

  function downloadIcs() {
    var t = totals();
    var d = state.date.replace(/-/g, ''), tm = state.slot.time.replace(':', '') + '00';
    var end = new Date(fromISO(state.date).getTime());
    var p = state.slot.time.split(':'); end.setHours(+p[0], +p[1] + t.mins);
    var endStr = isoDate(end).replace(/-/g, '') + 'T' + ('0' + end.getHours()).slice(-2) + ('0' + end.getMinutes()).slice(-2) + '00';
    var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Buff Beauty Bar//Booking//EN', 'BEGIN:VEVENT',
      'UID:' + state.result.id + '@buffbeautybar.com', 'DTSTART:' + d + 'T' + tm, 'DTEND:' + endStr,
      'SUMMARY:' + CFG.business.name + ' — ' + state.selected.join(' + '),
      'LOCATION:' + CFG.business.address, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.download = 'buff-appointment.ics';
    document.body.appendChild(a); a.click(); a.remove();
  }

  $('#call').href = CFG.business.phoneHref;
  $('#call').setAttribute('aria-label', 'Call ' + CFG.business.name + ' at ' + CFG.business.phone);
  render();
})();
