// Buff Beauty Bar — client booking flow.
// Steps: 1 services → 2 provider → 3 date & time → 4 details → 5 confirmation.

window.BuffAPI.ready.then(function () {
  var CFG = window.BUFF_CONFIG;
  var API = window.BuffAPI;

  var CATS = [];
  CFG.services.forEach(function (s) { if (CATS.indexOf(s.cat) < 0) { CATS.push(s.cat); } });
  var ORDER = CFG.categoryOrder || [];
  function rank(c) { var i = ORDER.indexOf(c); return i < 0 ? ORDER.length : i; }
  CATS = CATS.map(function (c, i) { return [c, i]; })
    .sort(function (a, b) { return rank(a[0]) - rank(b[0]) || a[1] - b[1]; })
    .map(function (x) { return x[0]; });

  var state = {
    step: 1,
    cat: CATS[0],
    selected: [],          // service names
    guests: 1,
    provider: 'any',
    place: null,           // place id picked on step 4 (only asked when the time is open at more than one)
    date: null,            // 'YYYY-MM-DD'
    slot: null,            // { time, label, providerIds }
    waitlist: false,
    slotsLoading: false,
    slots: null,           // result of getAvailability
    client: { name: '', phone: '', email: '', note: '', agree: false, occasion: '' },
    errors: {},
    submitting: false,
    result: null,
    account: null,         // signed-in client: { email, client: { id, name, phone, email } }
    hold: null,            // time held while booking: { date, time, label, expiresAt }
    notice: null,          // shown on step 3, e.g. when a time was just taken
    gift: { recipientName: '', recipientEmail: '', from: '', message: '', delivery: 'recipient' }, // provider 'gift': buying a gift card
  };

  var STEP_LABELS = ['Booking', 'Provider', 'Date & time', 'Where', 'Your details'];

  // ---------- helpers ----------
  function $(sel) { return document.querySelector(sel); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function svc(name) { return CFG.services.filter(function (s) { return s.name === name; })[0]; }
  // price with any specials for the chosen day and time (see pricing.js);
  // before a time is picked, only specials that don't depend on day or time count
  // the provider each guest will have, where known: the time's providers, else the one picked for guest 1
  function guestPros(slot) {
    if (slot && slot.providerIds && slot.providerIds.length) { return slot.providerIds; }
    var first = state.provider !== 'any' && state.provider !== 'gift' ? state.provider : null, out = [];
    for (var i = 0; i < state.guests; i++) { out.push(i === 0 ? first : null); }
    return out;
  }
  // all guests, with each provider's own prices
  function priceAt(dateISO, timeHHMM, slot) {
    return BuffPricing.group(state.selected, timeHHMM ? dateISO : null, timeHHMM ? API.toMin(timeHHMM) : null, guestPros(slot));
  }
  function totals() {
    var mins = 0;
    state.selected.forEach(function (n) { mins += svc(n).mins; });
    if (isGift()) { var rp = regularPrice(); return { mins: mins, price: rp.total * state.guests, regular: rp.subtotal * state.guests, perGuest: rp.total, pricing: rp }; }
    var live = state.slot && !state.waitlist ? state.slot : null;
    var pr = priceAt(state.date, live ? live.time : null, live);
    return { mins: mins, price: pr.total, regular: pr.subtotal, perGuest: pr.perGuest, pricing: pr };
  }
  function money(n) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function priceText(t) { return (t.regular > t.price ? '<s class="was">' + money(t.regular) + '</s> ' : '') + money(t.price); }
  function isoDate(d) { var m = d.getMonth() + 1, day = d.getDate(); return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day; }
  function fromISO(iso) { return new Date(iso + 'T00:00:00'); }
  function longDate(iso) { return fromISO(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }
  // ----- places: where the visit is (see places.js) -----
  var PL = window.BuffPlaces;
  function placeChoices() { return PL && state.selected.length ? PL.forServices(state.selected, API.canDo) : []; }
  function sameId(a, b) { return a != null && b != null && String(a) === String(b); }
  /** Places this visit could be at: where a provider who does these services (the one picked, if any) works. */
  function candidatePlaces() {
    var ch = placeChoices();
    if (PL && state.provider !== 'any' && state.provider !== 'gift') { ch = ch.filter(function (id) { return PL.worksThere(state.provider, id); }); }
    return ch;
  }
  /** Places where this time is open (times carry byPlace when more than one place was checked). */
  function slotPlaces(slot) {
    if (!slot) { return []; }
    var c = candidatePlaces();
    if (slot.byPlace) { return c.filter(function (id) { return slot.byPlace[id]; }); }
    return c.length === 1 ? c : [];
  }
  function wherePossible() { return !isGift() && candidatePlaces().length > 1; }
  /** Step 4 (Where) is needed when the picked time is open at more than one place. */
  function needsWhere() { return !isGift() && !state.waitlist && !!state.slot && slotPlaces(state.slot).length > 1; }
  /** The place for this visit: the only one that fits, or the one picked on step 4; null if still to pick. */
  function placeId() {
    if (state.slot && !state.waitlist) {
      var sp = slotPlaces(state.slot);
      if (sp.length === 1) { return sp[0]; }
      return sp.some(function (id) { return sameId(id, state.place); }) ? state.place : null;
    }
    var ch = candidatePlaces();
    if (ch.some(function (id) { return sameId(id, state.place); })) { return state.place; }
    return ch.length === 1 ? ch[0] : null;
  }
  function showPlace() { return !!(PL && PL.several()); }
  function placeText(id) { var p = PL && PL.byId(id); return p ? p.name + ', ' + p.address : ''; }

  // Gift cards are worth the regular price; specials apply when the visit is booked.
  function isGift() { return state.provider === 'gift'; }
  function regularPrice() {
    var lines = state.selected.map(function (n) { return { name: n, regular: svc(n).price, price: svc(n).price, special: '' }; });
    var sum = lines.reduce(function (m, l) { return m + l.price; }, 0);
    return { subtotal: sum, total: sum, note: '', quantity: null, lines: lines };
  }
  function providerName(id) { if (id === 'any') { return 'First available'; } if (id === 'gift') { return 'Gift card'; } return CFG.providers.filter(function (p) { return p.id === id; })[0].name; }
  var IG_ICON = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>';
  function avatar(p, cls) {
    return '<span class="avatar' + (cls ? ' ' + cls : '') + (p.photo ? ' has-photo' : '') + '">' + (p.photo ? '<img src="' + esc(p.photo) + '" alt="">' : esc(p.initials)) + '</span>';
  }
  function icon(name) {
    var paths = {
      check: '<path d="M20 6L9 17l-5-5"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      minus: '<path d="M5 12h14"/>',
      pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
      star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
      card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
      gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v9H5v-9M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    };
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';
  }

  // Each step is a browser history entry, so the phone's Back button / swipe
  // goes to the previous step instead of leaving the page.
  function go(step, opts) {
    opts = opts || {};
    var from = state.step;
    state.step = step;
    if (!opts.fromHistory) {
      try { history[opts.replace || step === from ? 'replaceState' : 'pushState']({ buffStep: step }, ''); } catch (e) { /* ignore */ }
    }
    render();
    var main = $('#main');
    main.scrollTop = 0;
    if (window.scrollY) { window.scrollTo(0, 0); } // wide screens scroll the page, not the panel
    var h = main.querySelector('h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  // ---------- holding the picked time ----------
  // Picking a time holds it for 10 minutes so nobody else (online or at the
  // front desk) can take it while the client fills in their details. This
  // browser's random token identifies its own hold.
  var holdToken = (function () {
    var t = null;
    try { t = sessionStorage.getItem('buff-hold'); } catch (e) { /* private mode */ }
    if (!t) {
      var a = new Uint8Array(16); crypto.getRandomValues(a);
      t = 'h' + Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      try { sessionStorage.setItem('buff-hold', t); } catch (e) { /* fine: one token per page load */ }
    }
    return t;
  })();
  var leaving = false; // set while we navigate away on purpose, so the browser's leave warning stays quiet

  function hasHold() { return !!(state.hold && state.hold.expiresAt > Date.now()); }
  function clock(ms) { return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  function holdWhen() { return state.hold ? fromISO(state.hold.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' at ' + state.hold.label : ''; }

  function dropHold() {
    if (!state.hold) { return; }
    state.hold = null;
    API.releaseHold(holdToken).catch(function () { /* it expires on its own */ });
  }

  var holdTimer = null;
  function holdSlot(slot) {
    var want = { token: holdToken, date: state.date, time: slot.time, provider: state.provider, guests: state.guests, services: state.selected.slice(), place: placeId() };
    API.holdSlot(want).then(function (r) {
      if (!state.slot || state.slot.time !== want.time || state.date !== want.date || !sameId(placeId(), want.place)) { return; } // they picked something else meanwhile
      state.hold = { date: want.date, time: want.time, label: slot.label, expiresAt: r.expiresAt, place: want.place };
      state.slot.providerIds = r.providerIds;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(render, r.expiresAt - Date.now() + 500); // show that the hold ended
      render();
    }, function (err) {
      if (!state.slot || state.slot.time !== want.time) { return; }
      if (err.code === 'taken') { state.notice = 'Someone just took ' + slot.label + '. Please pick another time.'; loadSlots(); return; }
      state.hold = null; // holds not available right now: booking still works, just without the hold
    });
  }

  function holdNote() {
    if (hasHold()) {
      return '<p class="hold-note">' + icon('clock') + '<span>We’re holding <b>' + esc(holdWhen()) + '</b> for you until ' + esc(clock(state.hold.expiresAt)) + '.</span></p>';
    }
    if (state.hold) {
      return '<p class="notice">Your 10-minute hold on ' + esc(holdWhen()) + ' ended. The time may still be free: tap Book now to try, or pick another time.</p>';
    }
    return '';
  }

  // Prompt before calling or leaving while a time is held.
  var dlg = document.createElement('dialog');
  dlg.className = 'hold-dialog';
  dlg.setAttribute('aria-labelledby', 'hold-title');
  document.body.appendChild(dlg);
  dlg.addEventListener('click', function (e) { if (e.target === dlg) { dlg.close(); } });

  function askAboutHold(kind, href) {
    var when = '<b>' + esc(holdWhen()) + '</b>';
    dlg.innerHTML = kind === 'call'
      ? '<h2 id="hold-title" class="h1">Calling to book?</h2>' +
        '<p>You’re holding ' + when + ' while you finish booking online.</p>' +
        '<p><b>While it’s held, we can’t book that time for you over the phone</b>, even if you call us. Release it first if you’d like us to book it for you.</p>' +
        '<div class="hold-actions"><button class="btn-primary" data-hold="release">Release my time and call</button>' +
          '<button class="btn-outline" data-hold="keep">Keep holding it and call</button>' +
          '<button class="link" data-hold="cancel">Cancel</button></div>'
      : '<h2 id="hold-title" class="h1">Leave this page?</h2>' +
        '<p>You’re holding ' + when + ' while you finish booking.</p>' +
        '<p>If you leave, we’ll release it so the time is free again, for other clients and for our front desk if you call us.</p>' +
        '<div class="hold-actions"><button class="btn-primary" data-hold="stay">Stay and finish booking</button>' +
          '<button class="btn-outline" data-hold="release">Release it and leave</button></div>';
    dlg.onclick = function (e) {
      var b = e.target.closest('[data-hold]');
      if (!b) { return; }
      var choice = b.getAttribute('data-hold');
      if (choice === 'cancel' || choice === 'stay') { dlg.close(); return; }
      leaving = true;
      setTimeout(function () { leaving = false; }, 1500); // a phone call doesn't unload the page
      if (choice === 'keep') { dlg.close(); location.href = href; return; }
      b.disabled = true; b.textContent = 'Releasing…';
      var done = function () { state.hold = null; dlg.close(); render(); location.href = href; };
      Promise.race([API.releaseHold(holdToken), new Promise(function (r) { setTimeout(r, 2000); })]).then(done, done);
    };
    dlg.showModal();
    var first = dlg.querySelector('[data-hold]'); if (first) { first.focus(); }
  }

  // Phone button and links to other pages, while a time is held.
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a || !hasHold() || a.target === '_blank') { return; }
    var href = a.getAttribute('href');
    if (/^tel:/.test(href)) { e.preventDefault(); askAboutHold('call', href); }
    else if (!/^(#|mailto:)/.test(href)) { e.preventDefault(); askAboutHold('leave', href); }
  }, true);

  // Closing the tab or typing another address: the browser's own warning
  // (sites can't change its wording), and the hold is released on the way out.
  window.addEventListener('beforeunload', function (e) {
    if (hasHold() && !leaving) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('pagehide', function () {
    if (state.hold) { API.releaseHoldOnExit(holdToken); }
  });
  window.addEventListener('pageshow', function (e) {
    if (e.persisted && state.hold) { state.hold = null; state.slot = null; state.slots = null; render(); } // back from another page: the hold was released
  });

  function loadSlots() {
    if (!state.date) { return; }
    dropHold();
    state.slotsLoading = true; state.slot = null; state.waitlist = false;
    render();
    var t = totals();
    var reqDate = state.date;
    // more than one place possible: check each, and keep which places each time is open at (step 4)
    var places = candidatePlaces();
    var calls = (places.length > 1 ? places : [places.length ? places[0] : null]).map(function (id) {
      return API.getAvailability(reqDate, t.mins, state.provider, state.guests, state.selected, null, id);
    });
    Promise.all(calls).then(function (rs) {
      if (reqDate !== state.date) { return; } // a newer request is in flight
      state.slots = places.length > 1 ? mergeSlots(rs, places) : rs[0]; state.slotsLoading = false;
      render();
    }, function () {
      if (reqDate !== state.date) { return; }
      state.slots = { error: true, slots: [] }; state.slotsLoading = false;
      render();
    });
  }

  function mergeSlots(rs, places) {
    var base = rs.filter(function (r) { return !r.closed; })[0];
    if (!base) { return rs[0]; }
    return { closed: false, slots: base.slots.map(function (s) {
      var byPlace = {}, first = null;
      rs.forEach(function (r, i) {
        if (r.closed) { return; }
        var x = r.slots.filter(function (y) { return y.time === s.time; })[0];
        if (x && x.available) { byPlace[places[i]] = x.providerIds; first = first || x; }
      });
      return { time: s.time, label: s.label, available: !!first, providerIds: first ? first.providerIds : [], byPlace: byPlace };
    }) };
  }

  // today, or the next day we're open
  function ensureDate() {
    if (state.date) { return; }
    var d = new Date();
    for (var i = 0; i < 30 && (!CFG.hours[d.getDay()] || (CFG.closedDates || {})[isoDate(d)] != null); i++) { d.setDate(d.getDate() + 1); }
    state.date = isoDate(d);
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
        (BuffPricing.hasSpecial(s.name) ? '<span class="sp-tag">Special</span>' : '') +
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
      (comboProblem() ? '<p class="notice" role="alert">' + esc(comboProblem()) + '</p>' : '') +
      '<div class="chips" role="toolbar" aria-label="Service categories">' + chips + '</div>' +
      '<ul class="card list" aria-label="' + esc(state.cat) + ' services">' + rows + '</ul>' +
      '<p class="muted sm center">Extra styling time or something not listed? Add a note at checkout.</p>' +
      (state.account
        ? '<a class="link center" href="account.html">My account and visits</a>'
        : '<a class="link center" href="account.html">Sign in to see your visits</a>' +
          '<a class="link center" href="manage.html">Already booked? Change or cancel</a>');
  }

  // providers set up for every selected service
  function qualifiedPros() { return CFG.providers.filter(function (p) { return API.canDo(p.id, state.selected); }); }
  // why the chosen services can't be booked together, or null
  function comboProblem() {
    if (!state.selected.length) { return null; }
    var n = qualifiedPros().length;
    if (n === 0) {
      return state.selected.length > 1
        ? 'None of our providers does all of these in one visit. Please book them as separate visits, or call us.'
        : 'This service isn’t bookable online right now. Please call us.';
    }
    if (n < state.guests) {
      return (n === 1 ? 'Only one of our providers does' : 'Only ' + n + ' of our providers do') + (state.selected.length > 1 ? ' all of these' : ' this') +
        ', so we can book up to ' + n + ' guest' + (n === 1 ? '' : 's') + ' at once.';
    }
    return null;
  }

  function viewProvider() {
    var where = wherePossible() || (PL && placeChoices().length > 1);
    var pros = qualifiedPros();
    var opts = [{ id: 'any', name: 'First available', initials: '', blurb: 'Most openings' }].concat(pros);
    // providers' own prices for these services, when any differ from the menu
    var menuPrice = BuffPricing.visit(state.selected, null, null, null).subtotal;
    var ownPrice = function (pid) { return BuffPricing.visit(state.selected, null, null, pid).subtotal; };
    var showPrices = pros.some(function (p) { return ownPrice(p.id) !== menuPrice; });
    var rows = opts.map(function (p) {
      var on = state.provider === p.id;
      var price = showPrices && p.id !== 'any' ? ' · ' + money(ownPrice(p.id)) + (state.guests > 1 ? ' each' : '') : '';
      var at = where && p.id !== 'any' ? PL.forProvider(p.id).map(function (id) { return (PL.byId(id) || {}).name; }).filter(Boolean).join(' · ') : '';
      var ig = p.instagram ? '<a class="pro-ig" href="https://www.instagram.com/' + encodeURIComponent(p.instagram) + '/" target="_blank" rel="noopener" aria-label="' + esc(p.name) + ' on Instagram (@' + esc(p.instagram) + ')">' + IG_ICON + '</a>' : '';
      return '<li class="pro-li"><button class="pro' + (on ? ' is-on' : '') + (ig ? ' has-ig' : '') + '" data-act="pro" data-v="' + p.id + '" aria-pressed="' + on + '">' +
        (p.id === 'any' ? '<span class="avatar">' + icon('star') + '</span>' : avatar(p)) +
        '<span class="svc-main"><span class="svc-name">' + esc(p.name) + '</span><span class="muted sm">' + esc(p.id === 'any' ? p.blurb : API.blurbFor(p.id)) + price + '</span>' + (at ? '<span class="muted xs">At ' + esc(at) + '</span>' : '') + '</span>' +
        (on ? '<span class="tick is-on">' + icon('check') + '</span>' : '') + '</button>' + ig + '</li>';
    }).join('');
    var hidden = CFG.providers.length - qualifiedPros().length;
    var gOn = isGift();
    var gift = '<h2 class="label">Or give it as a gift</h2><ul class="stack"><li class="pro-li"><button class="pro' + (gOn ? ' is-on' : '') + '" data-act="pro" data-v="gift" aria-pressed="' + gOn + '">' +
      '<span class="avatar">' + icon('gift') + '</span>' +
      '<span class="svc-main"><span class="svc-name">Gift card</span><span class="muted sm">' + (state.selected.length > 1 ? 'These services' : esc(state.selected[0] || 'This service')) + (state.guests > 1 ? ' for ' + state.guests : '') + ', emailed or printed · ' + money(regularPrice().total * state.guests) + '</span></span>' +
      (gOn ? '<span class="tick is-on">' + icon('check') + '</span>' : '') + '</button></li></ul>';
    return '<h1 class="h1">Who would you like?</h1>' +
      (hidden ? '<p class="muted sm">Showing the providers who do ' + (state.selected.length > 1 ? 'all of ' : '') + esc(state.selected.join(' + ')) + '.</p>' : '') +
      (state.guests > 1 ? '<p class="muted sm">With ' + state.guests + ' guests, your pick is for you — we’ll pair your guests with other pros working at the same time.</p>' : '') +
      '<ul class="stack">' + rows + '</ul>' + gift;
  }

  function viewWhere() {
    var sp = slotPlaces(state.slot), here = placeId();
    var rows = sp.map(function (id) {
      var pl = PL.byId(id), on = sameId(here, id);
      var who = state.provider === 'any' ? ((state.slot.byPlace || {})[id] || []).map(providerName).join(', ') : '';
      return '<li><button class="pro' + (on ? ' is-on' : '') + '" data-act="where" data-v="' + esc(id) + '" aria-pressed="' + on + '">' +
        '<span class="avatar">' + icon('pin') + '</span>' +
        '<span class="svc-main"><span class="svc-name">' + esc(pl.name) + '</span><span class="muted sm">' + esc(pl.address) + '</span>' +
          (who ? '<span class="muted xs">With ' + esc(who) + '</span>' : '') + '</span>' +
        (on ? '<span class="tick is-on">' + icon('check') + '</span>' : '') + '</button></li>';
    }).join('');
    return '<h1 class="h1">Where would you like to go?</h1>' +
      '<p class="muted sm">' + esc(longDate(state.date)) + ' at ' + esc(state.slot.label) + ' is open at ' + (sp.length === 2 ? 'both' : 'these') + ' places.</p>' +
      '<ul class="stack">' + rows + '</ul>' + (here != null ? holdNote() || '' : '');
  }

  function viewTime() {
    var days = [];
    var start = new Date(); start.setHours(0, 0, 0, 0);
    for (var i = 0; i < CFG.booking.daysAhead; i++) {
      var d = new Date(start); d.setDate(start.getDate() + i);
      var iso = isoDate(d), holiday = (CFG.closedDates || {})[iso], closed = !CFG.hours[d.getDay()] || holiday != null;
      var on = iso === state.date;
      var why = holiday ? 'closed' + (holiday ? ' for ' + holiday : '') : 'closed';
      days.push('<button class="day' + (on ? ' is-on' : '') + (holiday != null ? ' is-holiday' : '') + '" data-act="date" data-v="' + iso + '"' + (closed ? ' disabled title="' + esc(why) + '" aria-label="' + esc(longDate(iso)) + ', ' + esc(why) + '"' : ' aria-label="' + esc(longDate(iso)) + '"') + ' aria-pressed="' + on + '">' +
        '<span class="dow">' + (i === 0 ? 'TODAY' : d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()) + '</span>' +
        '<span class="dnum">' + d.getDate() + '</span>' +
        '<span class="mon">' + d.toLocaleDateString('en-US', { month: 'short' }) + '</span></button>');
    }

    var body = '';
    if (!state.date) {
      body = '<p class="muted center pad">Pick a day to see open times.</p>';
    } else if (state.slotsLoading || !state.slots) {
      body = '<p class="muted center pad" role="status">Finding open times…</p>';
    } else if (state.slots.error) {
      body = '<div class="center pad"><p class="muted">We couldn’t load open times. Check your connection.</p><button class="link" data-act="retry-slots">Try again</button></div>';
    } else if (state.slots.closed) {
      body = '<p class="muted center pad">We’re closed this day' + (state.slots.reason ? ' (' + esc(state.slots.reason) + ')' : '') + '.</p>';
    } else {
      var avail = state.slots.slots.filter(function (s) { return s.available; });
      var groups = [['Morning', 0, 12 * 60], ['Afternoon', 12 * 60, 17 * 60], ['Evening', 17 * 60, 24 * 60]];
      body = groups.map(function (g) {
        var inG = avail.filter(function (s) { var p = s.time.split(':'); var m = +p[0] * 60 + +p[1]; return m >= g[1] && m < g[2]; });
        if (!inG.length) { return ''; }
        return '<h2 class="label">' + g[0] + '</h2><div class="times">' + inG.map(function (s) {
          var on = state.slot && state.slot.time === s.time;
          var at = priceAt(state.date, s.time, s), deal = at.total < at.subtotal;
          return '<button class="time' + (on ? ' is-on' : '') + (deal ? ' has-deal' : '') + '" data-act="slot" data-v="' + s.time + '" aria-pressed="' + on + '"' +
            (deal ? ' aria-label="' + s.label + ', special price ' + money(at.total) + '"' : '') + '>' + s.label +
            (deal ? '<span class="time-price">' + money(at.total) + '</span>' : '') + '</button>';
        }).join('') + '</div>';
      }).join('');
      if (!avail.length) { body = '<p class="muted center pad">No openings this day for ' + totals().mins + ' minutes.</p>'; }
    }

    var wl = state.date && state.slots && !state.slots.closed && !state.slots.error && !state.slotsLoading
      ? '<button class="ghost-dashed' + (state.waitlist ? ' is-on' : '') + '" data-act="waitlist" aria-pressed="' + state.waitlist + '">' + icon('clock') +
        (state.waitlist ? 'You’ll join the waitlist for ' + esc(longDate(state.date)) : 'Don’t see your time? Join the waitlist') + '</button>'
      : '';

    var notice = state.notice ? '<p class="notice" role="alert">' + esc(state.notice) + '</p>' : '';
    return '<h1 class="h1">When works for you?</h1>' + notice +
      '<div class="days" role="toolbar" aria-label="Choose a day">' + days.join('') + '</div>' +
      (state.date ? '<div class="label">' + esc(longDate(state.date)) + ' · ' + totals().mins + ' min · ' + esc(providerName(state.provider)) + '</div>' : '') +
      (wherePossible() ? '<p class="muted sm">Showing times at any of our places. You’ll pick where next.</p>' : '') +
      '<div class="card pad-sm">' + body + '</div>' + (state.slot ? holdNote() : '') + wl;
  }

  function field(id, label, type, ac, ph, hint) {
    var err = state.errors[id];
    return '<div class="field' + (err ? ' has-err' : '') + '"><label for="f-' + id + '">' + label + '</label>' +
      '<input id="f-' + id + '" name="' + id + '" type="' + type + '"' + (ac ? ' autocomplete="' + ac + '"' : '') + ' placeholder="' + esc(ph) + '" value="' + esc(state.client[id]) + '"' + (err ? ' aria-invalid="true" aria-describedby="e-' + id + '"' : '') + '>' +
      (err ? '<span class="err" id="e-' + id + '">' + esc(err) + '</span>' : (hint ? '<span class="muted xs">' + hint + '</span>' : '')) + '</div>';
  }

  function summaryCard() {
    var t = totals();
    if (isGift()) {
      return '<div class="card summary"><div class="label">Gift card</div>' +
        '<div class="b lg">' + money(t.price) + '</div>' +
        '<div>' + esc(state.selected.join(' + ')) + (state.guests > 1 ? ' · ' + state.guests + ' guests' : '') + '</div>' +
        '<div class="muted sm">They pick the day, time and provider when they book. Good for these services or ' + money(t.price) + ' toward anything.</div></div>';
    }
    var when = state.waitlist ? longDate(state.date) + ' · waitlist' : longDate(state.date) + ' at ' + state.slot.label;
    return '<div class="card summary"><div class="label">Your visit</div>' +
      '<div class="b lg">' + esc(when) + '</div>' +
      '<div>' + esc(state.selected.join(' + ')) + '</div>' +
      '<div class="muted sm">' + esc(providerName(state.provider)) + ' · ' + t.mins + ' min' + (state.guests > 1 ? ' · ' + state.guests + ' guests' : '') + ' · ' + priceText(t) + '</div>' +
      (showPlace() && placeId() != null ? '<div class="sm">At ' + esc(placeText(placeId())) + '</div>' : '') +
      (t.pricing.note ? '<div class="sp-applied">Special: ' + esc(t.pricing.note) + '</div>' : '') + '</div>';
  }

  var changeLink = '<button class="link sm change-link" data-act="change-time">Change date or time</button>';

  function giftField(id, label, type, ph, hint, ac) {
    var err = state.errors['g-' + id];
    var tag = type === 'textarea'
      ? '<textarea id="g-' + id + '" name="' + id + '" rows="3" maxlength="400" placeholder="' + esc(ph) + '"' + (err ? ' aria-invalid="true"' : '') + '>' + esc(state.gift[id]) + '</textarea>'
      : '<input id="g-' + id + '" name="' + id + '" type="' + type + '"' + (ac ? ' autocomplete="' + ac + '"' : '') + ' placeholder="' + esc(ph) + '" value="' + esc(state.gift[id]) + '"' + (err ? ' aria-invalid="true" aria-describedby="ge-' + id + '"' : '') + '>';
    return '<div class="field' + (err ? ' has-err' : '') + '"><label for="g-' + id + '">' + label + '</label>' + tag +
      (err ? '<span class="err" id="ge-' + id + '">' + esc(err) + '</span>' : (hint ? '<span class="muted xs">' + hint + '</span>' : '')) + '</div>';
  }

  function viewGift() {
    var g = state.gift;
    var opt = function (v, label, sub) {
      return '<label class="g-opt' + (g.delivery === v ? ' is-on' : '') + '"><input type="radio" name="g-delivery" value="' + v + '"' + (g.delivery === v ? ' checked' : '') + '>' +
        '<span><span class="b sm">' + label + '</span><span class="muted xs">' + sub + '</span></span></label>';
    };
    return '<h1 class="h1">Gift card</h1>' + summaryCard() +
      '<form id="gift" class="card form" novalidate><div class="b">Who it’s for</div>' +
        giftField('recipientName', 'Their name', 'text', 'First and last', '', 'off') +
        '<fieldset class="g-delivery"><legend class="b sm">How should they get it?</legend>' +
          opt('recipient', 'Email it to them', 'We send it to their inbox') +
          opt('self', 'Email it to me to print', 'Print it and give it in person') +
          opt('both', 'Both', 'Email them, and send me a copy to print') +
        '</fieldset>' +
        (g.delivery === 'self' ? '' : giftField('recipientEmail', 'Their email', 'email', 'them@email.com', '', 'off')) +
        giftField('message', 'Message (optional)', 'textarea', 'Happy birthday! Treat yourself.') +
        giftField('from', 'From', 'text', state.client.name || 'Your name', 'How your name shows on the card.', 'off') +
      '</form>' +
      '<form id="details" class="card form" novalidate><div class="b">Your details</div>' +
        field('name', 'Name', 'text', 'name', 'First and last') +
        field('phone', 'Mobile', 'tel', 'tel', '(504) 555-0123', 'In case we have a question about your order') +
        (state.account
          ? '<div class="field"><label>Email</label><div class="a-email">' + esc(state.account.email) + '</div></div>'
          : field('email', 'Email', 'email', 'email', 'you@email.com', 'We send your receipt here.')) +
      '</form>' +
      '<div class="card form">' +
        '<div class="row-between"><span class="b sm">Payment</span><span class="muted xs">Encrypted</span></div>' +
        '<div class="card-mock" aria-label="Card details (coming soon)">' + icon('card') + '<span>Card number · MM/YY · CVC</span></div>' +
        '<p class="muted xs">Coming soon: online payment connects once our card processor is set up. For now we’ll call you to take payment, and the gift card is good once it’s paid.</p>' +
      '</div>' +
      '<p class="muted xs center">By buying you agree to our <a href="terms.html" target="_blank" rel="noopener">terms</a> and <a href="privacy.html" target="_blank" rel="noopener">privacy policy</a>.</p>' +
      (state.errors.form ? '<p class="notice" role="alert">' + esc(state.errors.form) + '</p>' : '');
  }

  function viewDetails() {
    if (isGift()) { return viewGift(); }
    var agreeErr = state.errors.agree;
    return '<h1 class="h1">Almost done</h1>' + summaryCard() + changeLink + (state.waitlist ? '' : holdNote()) +
      '<form id="details" class="card form" novalidate>' +
        field('name', 'Name', 'text', 'name', 'First and last') +
        field('phone', 'Mobile', 'tel', 'tel', '(504) 555-0123', 'For your confirmation and reminder texts') +
        (state.account
          ? '<div class="field"><label>Email</label><div class="a-email">' + esc(state.account.email) + '</div>' +
              '<span class="muted xs">Signed in. <a href="account.html">Not you?</a></span></div>'
          : field('email', 'Email', 'email', 'email', 'you@email.com', '<a href="account.html">Have an account? Sign in</a> to fill this in next time.')) +
        field('note', 'Note (optional)', 'text', '', 'Requests, guest names…') +
      '</form>' +
      (state.waitlist ? '' : '<div class="card form">' + BuffOccasion.picker(state.client.occasion) + '</div>') +
      (state.waitlist ? '' :
      '<div class="card form">' +
        '<div class="row-between"><span class="b sm">Card on file</span><span class="muted xs">Encrypted</span></div>' +
        '<div class="card-mock" aria-label="Card details (coming soon)">' + icon('card') + '<span>Card number · MM/YY · CVC</span></div>' +
        '<p class="muted xs">Coming soon: card entry connects once our card processor is set up. You won’t be charged today.</p>' +
      '</div>') +
      '<label class="agree' + (agreeErr ? ' has-err' : '') + '"><input type="checkbox" id="f-agree"' + (state.client.agree ? ' checked' : '') + '>' +
        '<span>I agree to the <a href="' + CFG.business.cancellationPolicyUrl + '" target="_blank" rel="noopener">cancellation policy</a>. Cancellations within ' + CFG.business.cancellationWindowHours + ' hours or no-shows may be charged.</span></label>' +
      (agreeErr ? '<span class="err">' + esc(agreeErr) + '</span>' : '') +
      '<p class="muted xs center">By booking you agree to our <a href="terms.html" target="_blank" rel="noopener">terms</a> and <a href="privacy.html" target="_blank" rel="noopener">privacy policy</a>.</p>' +
      (state.errors.form ? '<p class="notice" role="alert">' + esc(state.errors.form) + '</p>' : '');
  }

  function giftLink(code) { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'giftcard.html?code=' + encodeURIComponent(code); }
  function mailto(to, subject, body) { return 'mailto:' + encodeURIComponent(to || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body); }

  function viewGiftDone() {
    var r = state.result, link = giftLink(r.code), biz = CFG.business.name;
    var what = r.services.join(' + ') + (r.guests > 1 ? ' for ' + r.guests : '');
    var toThem = mailto(r.recipientEmail, 'A gift for you from ' + r.from,
      'Hi ' + r.recipientName + ',\n\n' + (r.message ? r.message + '\n\n' : '') + 'Here’s a ' + money(r.amount) + ' gift card to ' + biz + ' for ' + what + '.\n\n' +
      'Your gift card: ' + link + '\nGift card code: ' + r.code + '\n\nBook at ' + location.origin + location.pathname.replace(/[^/]*$/, '') + ' or call ' + CFG.business.phone + '.\n\n' + r.from);
    var toMe = mailto(state.account ? state.account.email : state.client.email, 'Gift card for ' + r.recipientName + ' (' + biz + ')',
      'Gift card for ' + r.recipientName + ': ' + money(r.amount) + ', ' + what + '.\nCode: ' + r.code + '\n\nOpen this link to print it: ' + link + '&print=1');
    var them = r.delivery !== 'self', me = r.delivery !== 'recipient';
    return '<div class="done">' +
      '<div class="done-badge">' + icon('gift') + '</div>' +
      '<h1 class="h1 center">Gift card ready</h1>' +
      '<p class="center muted">' + money(r.amount) + ' for ' + esc(r.recipientName) + '. We’ll call you at ' + esc(state.client.phone) + ' to take payment; it’s good to use once paid.</p>' +
      '<div class="card summary center"><div class="label">Gift card code</div><div class="b lg g-code">' + esc(r.code) + '</div><div class="muted sm">' + esc(what) + '</div></div>' +
      (them ? '<a class="btn-primary as-link" href="' + esc(toThem) + '">Email it to ' + esc(r.recipientName) + '</a>' : '') +
      (me ? '<a class="' + (them ? 'btn-outline' : 'btn-primary') + ' as-link" href="' + esc(toMe) + '">Email it to me to print</a>' : '') +
      '<a class="btn-outline as-link" href="' + esc(link) + '&print=1" target="_blank" rel="noopener">Print it now</a>' +
      '<p class="muted xs center">The email buttons open your email app with the gift card link filled in, so it comes from you. Anyone with the link or code can use the card, so send it only to them.</p>' +
      '<button class="link" data-act="restart">Done</button></div>';
  }

  function viewDone() {
    if (isGift()) { return viewGiftDone(); }
    var r = state.result;
    var wl = state.waitlist;
    return '<div class="done">' +
      '<div class="done-badge">' + icon('check') + '</div>' +
      '<h1 class="h1 center">' + (wl ? 'You’re on the waitlist' : 'You’re booked!') + '</h1>' +
      '<p class="center muted">' + (wl ? 'We’ll contact you if a spot opens. First to claim it gets it.' : 'Save your reference below. Need to change plans? Cancel online or call us.') + '</p>' +
      summaryCard() +
      '<p class="center xs muted">Reference ' + esc(r.id) + ' · ' + esc(CFG.business.name) + ', ' + esc(CFG.business.address) + '</p>' +
      (wl ? '' : BuffCal.menu({ id: r.id, date: state.date, start: API.toMin(state.slot.time), mins: totals().mins, services: state.selected, provider: state.provider === 'any' ? '' : providerName(state.provider), guests: state.guests, place: PL && PL.byId(placeId()) })) +
      (wl ? '' : state.account
        ? '<a class="link center" href="account.html">See all your visits</a>'
        : '<a class="link center" href="manage.html?ref=' + encodeURIComponent(r.id) + '">Need to cancel? Manage this booking</a>') +
      '<button class="link" data-act="restart">Book another visit</button></div>';
  }

  // ---------- render ----------
  function canContinue() {
    if (state.step === 1) { return state.selected.length > 0 && !comboProblem(); }
    if (state.step === 2) { return true; }
    if (state.step === 3) { return !!state.slot || state.waitlist || isGift(); }
    if (state.step === 4) { return placeId() != null; }
    if (state.step === 5) { return !state.submitting; }
    return false;
  }

  // the visit so far, for the summary panel beside the steps on wide screens (hidden on phones)
  function footDetail() {
    if (!state.selected.length) { return '<div class="label">Your visit</div><p class="muted sm">Pick a service to start.</p>'; }
    var t = totals();
    var rows = t.pricing.lines.map(function (l) {
      return '<li class="row-between"><span>' + esc(l.name) + (l.special ? '<span class="muted xs"> · ' + esc(l.special) + '</span>' : '') + '</span>' +
        '<span class="muted">' + (l.price < l.regular ? '<s class="was">' + money(l.regular) + '</s> ' : '') + money(l.price) + (svc(l.name).priceNote || '') + '</span></li>';
    }).join('') + (t.pricing.quantity ? '<li class="row-between"><span>' + esc(t.pricing.quantity.name) + '</span><span class="muted">−' + money(t.pricing.quantity.amount) + '</span></li>' : '');
    var when = isGift() ? 'Gift card' : state.waitlist ? longDate(state.date) + ' · waitlist' : state.slot ? longDate(state.date) + ' at ' + state.slot.label : '';
    return '<div class="label">Your visit</div><ul class="foot-list">' + rows + '</ul>' +
      '<p class="sm">' + esc(providerName(state.provider)) + (state.guests > 1 ? ' · ' + state.guests + ' guests' : '') + '</p>' +
      (showPlace() && placeId() != null && !isGift() ? '<p class="sm">At ' + esc(placeText(placeId())) + '</p>' : '') +
      (when ? '<p class="b sm">' + esc(when) + '</p>' : '');
  }

  function render() {
    var s = state.step;
    $('#back').hidden = !(s > 1 && s < 6);
    var prog = $('#progress');
    prog.hidden = s >= 6;
    if (s < 6) {
      // 5 steps when Where may be asked, otherwise 4 (Where is skipped)
      var of = wherePossible() || needsWhere() ? 5 : 4, n = of === 4 && s === 5 ? 4 : s;
      $('#step-label').textContent = s === 5 && isGift() ? 'Gift card' : STEP_LABELS[s - 1];
      $('#step-count').textContent = 'Step ' + n + ' of ' + of;
      $('#bar-fill').style.width = (n / of * 100) + '%';
    }
    var views = [viewServices, viewProvider, viewTime, viewWhere, viewDetails, viewDone];
    // keep horizontal strips (days, categories) and the page where they were across re-renders
    var main = $('#main');
    var keep = { top: main.scrollTop, days: ($('.days') || {}).scrollLeft || 0, chips: ($('.chips') || {}).scrollLeft || 0 };
    main.innerHTML = views[s - 1]() + '<nav class="staff-link foot-links" aria-label="More"><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="staff.html">Staff</a></nav>';
    main.scrollTop = keep.top;
    if ($('.days')) { $('.days').scrollLeft = keep.days; }
    if ($('.chips')) { $('.chips').scrollLeft = keep.chips; }

    var foot = $('#footer');
    foot.hidden = s >= 6;
    if (s < 6) {
      var t = totals();
      $('#foot-sub').textContent = state.selected.length
        ? state.selected.length + ' service' + (state.selected.length === 1 ? '' : 's') + ' · ' + t.mins + ' min' + (state.guests > 1 ? ' · ×' + state.guests : '')
        : 'Choose a service';
      $('#foot-total').innerHTML = priceText(t);
      $('#foot-detail').innerHTML = footDetail();
      var btn = $('#next');
      btn.disabled = !canContinue();
      btn.textContent = s === 5 ? (isGift() ? (state.submitting ? 'Saving…' : 'Buy gift card') : state.submitting ? 'Booking…' : (state.waitlist ? 'Join waitlist' : 'Book now')) : 'Continue';
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
      if (state.provider !== 'any' && !API.canDo(state.provider, state.selected)) { state.provider = 'any'; } // they don't do the new mix
      dropHold(); state.slots = null; state.slot = null; render();
    }
    else if (act === 'guests') { state.guests = Math.max(1, Math.min(CFG.booking.maxGuests, state.guests + +v)); dropHold(); state.slots = null; state.slot = null; render(); }
    else if (act === 'pro') {
      if (v !== state.provider) { dropHold(); state.slots = null; state.slot = null; state.waitlist = false; state.errors = {}; }
      state.provider = v;
      if (PL && v !== 'any' && v !== 'gift' && state.place != null && !PL.worksThere(v, state.place)) { state.place = null; } // they don't work there
      render();
    }
    else if (act === 'where') {
      var np = slotPlaces(state.slot).filter(function (id) { return String(id) === v; })[0];
      if (np == null) { return; }
      if (!sameId(np, state.place)) { dropHold(); }
      state.place = np;
      if (state.slot.byPlace) { state.slot.providerIds = state.slot.byPlace[np]; }
      if (!hasHold() || !sameId(state.hold.place, np)) { holdSlot(state.slot); }
      render();
    }
    else if (act === 'date') { state.date = v; state.notice = null; loadSlots(); }
    else if (act === 'slot') {
      state.slot = state.slots.slots.filter(function (x) { return x.time === v; })[0];
      state.waitlist = false; state.notice = null;
      var here = placeId(); // known when this time is open at only one place (or the place picked before is open)
      if (here != null && state.slot.byPlace) { state.slot.providerIds = state.slot.byPlace[here]; }
      if (here == null) { dropHold(); } // they pick the place on step 4, then it's held
      else if (!state.hold || state.hold.time !== v || state.hold.date !== state.date || !hasHold() || !sameId(state.hold.place, here)) { holdSlot(state.slot); }
      render();
    }
    else if (act === 'waitlist') { state.waitlist = !state.waitlist; if (state.waitlist) { state.slot = null; dropHold(); } render(); }
    else if (act === 'restart') {
      restart();
      go(1);
    }
    else if (act === 'change-time') { state.errors = {}; stepBack(); }
    else if (act === 'retry-slots') { loadSlots(); }
  });

  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-occ]');
    if (!c) { return; }
    state.client.occasion = BuffOccasion.toggle(state.client.occasion, c.getAttribute('data-occ'));
    render();
    var other = document.getElementById('occ-other'); if (other && !other.value) { other.focus(); }
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'occ-other') { state.client.occasion = t.value || ' '; return; }
    if (t.form && t.form.id === 'details' && t.name) { state.client[t.name] = t.value; }
    if (t.form && t.form.id === 'gift' && t.name && t.name !== 'g-delivery') { state.gift[t.name] = t.value; }
    if (t.id === 'f-agree') { state.client.agree = t.checked; }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'f-agree') { state.client.agree = e.target.checked; }
    if (e.target.name === 'g-delivery') { state.gift.delivery = e.target.value; render(); var r = document.querySelector('input[name="g-delivery"]:checked'); if (r) { r.focus(); } }
  });

  function restart() {
    dropHold();
    state.step = 1; state.selected = []; state.guests = 1; state.provider = 'any'; state.place = null; state.date = null; state.slot = null; state.slots = null; state.waitlist = false; state.result = null; state.errors = {}; state.notice = null;
    state.client = { name: '', phone: '', email: '', note: '', agree: false, occasion: '' };
    state.gift = { recipientName: '', recipientEmail: '', from: '', message: '', delivery: 'recipient' };
    if (state.account) { state.client.name = state.account.client.name || ''; state.client.phone = state.account.client.phone || ''; state.client.email = state.account.email; }
  }

  // On-screen back arrow: use the browser's history when the previous step is
  // the entry behind us, so Back and the arrow always agree.
  function stepBack() {
    if (history.state && history.state.buffStep === state.step && state.step > 1) { history.back(); }
    else { go(Math.max(1, state.step === 5 && isGift() ? 2 : state.step === 5 && !needsWhere() ? 3 : state.step - 1), { replace: true }); }
  }
  $('#back').addEventListener('click', stepBack);

  window.addEventListener('popstate', function (e) {
    var s = (e.state && e.state.buffStep) || 1, asked = s;
    if (state.step === 6) { // already booked: Back starts a fresh booking
      restart(); go(1, { replace: true }); return;
    }
    if (s > 1 && !state.selected.length) { s = 1; }
    if (isGift() && (s === 3 || s === 4)) { s = state.step === 5 ? 2 : 5; } // gift cards skip the date, time and place
    if (s > 3 && !state.slot && !state.waitlist && !isGift()) { s = 3; }
    if (s === 4 && !needsWhere()) { s = state.step >= 5 ? 3 : 5; }            // only one place: no Where step
    if (s === 5 && needsWhere() && placeId() == null) { s = 4; }
    if (asked === state.step && s > 1) { history.back(); return; } // duplicate entry (e.g. after "time was taken")
    if (s !== asked) { try { history.replaceState({ buffStep: s }, ''); } catch (err) { /* ignore */ } }
    go(s, { fromHistory: true });
    if (s === 3 && !state.slots && !state.slotsLoading) { ensureDate(); loadSlots(); }
  });

  $('#next').addEventListener('click', function () {
    if (!canContinue()) { return; }
    if (state.step === 2 && isGift()) { go(5); return; }
    if (state.step === 2) {
      ensureDate(); // default to today-or-next-open day so times show immediately
      go(3); loadSlots(); return;
    }
    if (state.step === 3) { go(needsWhere() ? 4 : 5); return; }
    if (state.step === 5) { submit(); return; }
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

  function validateGift() {
    var g = state.gift, e = {};
    if (!g.recipientName.trim()) { e['g-recipientName'] = 'Please enter their name.'; }
    if (g.delivery !== 'self' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.recipientEmail.trim())) { e['g-recipientEmail'] = 'Please enter their email.'; }
    var c = state.client;
    if (c.name.trim().split(/\s+/).length < 2) { e.name = 'Please enter your first and last name.'; }
    if (c.phone.replace(/\D/g, '').length < 10) { e.phone = 'Please enter a 10-digit mobile number.'; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) { e.email = 'Please enter a valid email.'; }
    state.errors = e;
    return Object.keys(e).length === 0;
  }

  function submitGift() {
    if (!validateGift()) {
      render();
      var first = document.querySelector('[aria-invalid="true"]');
      if (first) { first.focus(); }
      return;
    }
    state.submitting = true; render();
    var g = state.gift, c = state.client;
    API.buyGiftCard({
      services: state.selected.slice(), guests: state.guests, delivery: g.delivery,
      buyer: { name: c.name.trim(), phone: c.phone.trim(), email: c.email.trim() },
      recipient: { name: g.recipientName.trim(), email: g.delivery === 'self' ? '' : g.recipientEmail.trim() },
      from: g.from.trim() || c.name.trim(), message: g.message.trim(),
    }).then(function (res) { state.submitting = false; state.result = res; go(6); }, function () {
      state.submitting = false; state.errors = { form: 'Something went wrong. Please try again or call us.' }; render();
    });
  }

  function submit() {
    if (isGift()) { submitGift(); return; }
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
      provider: state.provider, date: state.date, policyAgreed: !!state.client.agree, holdToken: holdToken, place: placeId(), // always: the hold may still be on its way when they tap Book (slow signal)
      occasion: state.client.occasion.trim(),
      client: { name: state.client.name.trim(), phone: state.client.phone.trim(), email: state.client.email.trim(), note: state.client.note.trim() },
    };
    var p = state.waitlist ? API.joinWaitlist(payload)
      : API.createBooking(Object.assign(payload, { time: state.slot.time, providerIds: state.slot.providerIds }));
    p.then(function (res) { state.submitting = false; state.result = res; state.hold = null; go(6); }, function (err) {
      state.submitting = false;
      if (err.code === 'taken') { state.notice = 'Sorry, that time was just booked. Please pick another.'; go(3, { replace: true }); loadSlots(); return; }
      state.errors = { form: err.code === 'not_qualified' ? 'That provider doesn’t do these services. Go back and pick someone else or First available.' : 'Something went wrong. Please try again or call us.' }; render();
    });
  }

  $('#call').href = CFG.business.phoneHref;
  $('#call').setAttribute('aria-label', 'Call ' + CFG.business.name + ' at ' + CFG.business.phone);
  $('.call-num').textContent = CFG.business.phone; // shown beside the icon on wide screens

  function start() {
    try { history.replaceState({ buffStep: 1 }, ''); } catch (e) { /* ignore */ }
    render();
    // from the Services page: index.html?service=Blow%20Out → that service picked, on to step 2;
    // with &provider=p2 (the desk's Experiment tab) that provider is picked too, straight to the times
    var qs = new URLSearchParams(location.search), picked = qs.get('service'), pro = qs.get('provider');
    var s0 = picked && CFG.services.filter(function (x) { return x.name === picked; })[0];
    if (s0) {
      state.selected = [s0.name]; state.cat = s0.cat;
      try { history.replaceState({ buffStep: 1 }, '', location.pathname); } catch (e) { /* ignore */ }
      if (comboProblem()) { render(); }
      else if (pro && CFG.providers.some(function (p) { return p.id === pro; }) && API.canDo(pro, state.selected)) {
        state.provider = pro;
        go(2); // Back from the times returns to the provider step
        ensureDate(); go(3); loadSlots();
      } else { go(2); }
    }
    // signed-in client: fill in their details (doesn't hold up the page)
    API.getClientAccount().then(function (acct) {
      if (!acct) { return; }
      state.account = acct;
      var c = state.client;
      if (!c.name) { c.name = acct.client.name || ''; }
      if (!c.phone) { c.phone = acct.client.phone || ''; }
      c.email = acct.email;
      render();
    }, function () { /* not signed in or offline: book as a guest */ });
  }

  start();
});
