// Buff Beauty Bar — client account (account.html).
// Sign in with an emailed link, then see upcoming and past visits, cancel,
// and keep name and mobile up to date so booking is quicker next time.

window.BuffAPI.ready.then(function () {
  var CFG = window.BUFF_CONFIG;
  var API = window.BuffAPI;

  var state = {
    view: 'checking',   // checking → signin → sent | account
    email: '',
    error: '',
    busy: false,
    account: null,      // { email, client: { id, name, phone, email } }
    bookings: null,
    profile: { name: '', phone: '' },
    profileMsg: null,
    confirming: null,   // booking id waiting for "yes, cancel"
    cancelMsg: {},
  };

  function $(sel) { return document.querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return '$' + (Math.round(n * 100) % 100 ? n.toFixed(2) : Math.round(n).toLocaleString('en-US')); }
  function longDate(iso) { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }
  function shortDate(iso) { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  function providerName(id) { if (id === 'any') { return 'First available'; } var p = CFG.providers.filter(function (x) { return x.id === id; })[0]; return p ? p.name : ''; }
  function startsAt(b) { var d = new Date(b.date + 'T00:00:00'); d.setMinutes(b.start); return d; }
  function hoursUntil(b) { return (startsAt(b) - new Date()) / 36e5; }

  // ---------- views ----------
  function viewSignIn() {
    return '<h1 class="h1">My account</h1>' +
      '<p class="muted sm">See your visits, cancel if plans change, and book faster next time. No password: we email you a sign-in link.</p>' +
      '<form id="signin" class="card form" novalidate>' +
        '<div class="field"><label for="a-email">Email</label><input id="a-email" name="email" type="email" autocomplete="email" placeholder="you@email.com" value="' + esc(state.email) + '"></div>' +
        (state.error ? '<p class="notice" role="alert">' + esc(state.error) + '</p>' : '') +
        '<button class="btn-primary" type="submit"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Sending…' : 'Email me a sign-in link') + '</button>' +
      '</form>' +
      '<p class="muted sm center">Booked without an account? Use the same email and your visits will be here. Or <a href="manage.html">look up one booking</a>.</p>';
  }

  function viewSent() {
    return '<div class="card form"><h1 class="h1">Check your email</h1>' +
      '<p>We sent a sign-in link to <b>' + esc(state.email) + '</b>. Open it on this phone or computer.</p>' +
      '<button class="link" data-act="retry">Use a different email</button></div>';
  }

  function bookingCard(b, upcoming) {
    var late = upcoming && hoursUntil(b) < CFG.business.cancellationWindowHours;
    var status = b.status === 'cancelled' ? 'Cancelled' : b.status === 'no-show' ? 'Missed' : b.status === 'arrived' ? 'Visited' : upcoming ? '' : 'Visited';
    var actions = '';
    if (upcoming && b.status === 'booked') {
      actions = state.confirming === b.id
        ? '<div class="a-confirm">' +
            (late ? '<p class="notice">This visit is less than ' + CFG.business.cancellationWindowHours + ' hours away, so a late-cancellation fee may apply.</p>' : '') +
            '<div class="row-wrap"><button class="btn-danger sm" data-act="cancel" data-v="' + esc(b.id) + '">Yes, cancel it</button>' +
            '<button class="link sm" data-act="keep">Keep it</button></div></div>'
        : '<button class="btn-outline sm" data-act="ask" data-v="' + esc(b.id) + '">Cancel</button>';
    }
    var msg = state.cancelMsg[b.id];
    var cal = upcoming && b.status === 'booked' && state.confirming !== b.id
      ? BuffCal.menu({ id: b.id, date: b.date, start: b.start, mins: b.mins, services: b.services, provider: b.provider === 'any' ? '' : providerName(b.provider), guests: b.guests }, { compact: true })
      : '';
    return '<li class="card summary a-visit' + (b.status === 'cancelled' ? ' is-cancelled' : '') + '">' +
      (status ? '<div class="label">' + status + '</div>' : '') +
      '<div class="b">' + esc(upcoming ? longDate(b.date) : shortDate(b.date)) + ' at ' + esc(API.formatTime(b.start)) + '</div>' +
      '<div>' + esc(b.services.join(' + ')) + '</div>' +
      '<div class="muted sm">' + esc(providerName(b.provider) || '') + ' · ' + b.mins + ' min' + (b.guests > 1 ? ' · ' + b.guests + ' guests' : '') + ' · ' + money(b.total) + '</div>' +
      '<div class="muted xs">Reference ' + esc(b.id) + '</div>' +
      (msg ? '<p class="notice" role="alert">' + esc(msg) + '</p>' : '') + cal + actions +
    '</li>';
  }

  function viewAccount() {
    var c = state.account.client;
    var first = (c.name || '').split(' ')[0];
    var needsProfile = !c.name || c.phone.replace(/\D/g, '').length < 10;
    var profile = '<form id="profile" class="card form" novalidate><div class="b">' + (needsProfile ? 'Tell us about you' : 'Your details') + '</div>' +
      (needsProfile ? '<p class="muted sm">So we can fill these in when you book.</p>' : '') +
      '<div class="field"><label for="a-name">Name</label><input id="a-name" name="name" type="text" autocomplete="name" placeholder="First and last" value="' + esc(state.profile.name) + '"></div>' +
      '<div class="field"><label for="a-phone">Mobile</label><input id="a-phone" name="phone" type="tel" autocomplete="tel" placeholder="(504) 555-0123" value="' + esc(state.profile.phone) + '"></div>' +
      '<div class="field"><label>Email</label><div class="a-email">' + esc(c.email) + '</div></div>' +
      (state.profileMsg ? '<p class="' + (state.profileMsg.err ? 'notice' : 'muted sm') + '" role="status">' + esc(state.profileMsg.text) + '</p>' : '') +
      '<button class="btn-primary" type="submit">Save</button></form>';

    var visits;
    if (!state.bookings) { visits = '<p class="muted center pad" role="status">Loading your visits…</p>'; }
    else {
      var now = new Date();
      var upcoming = state.bookings.filter(function (b) { return b.status === 'booked' && startsAt(b) >= now; })
        .sort(function (a, b) { return startsAt(a) - startsAt(b); });
      var past = state.bookings.filter(function (b) { return upcoming.indexOf(b) < 0; });
      visits = '<h2 class="label">Upcoming</h2>' +
        (upcoming.length ? '<ul class="stack">' + upcoming.map(function (b) { return bookingCard(b, true); }).join('') + '</ul>'
          : '<div class="card pad-sm muted sm">No upcoming visits.</div>') +
        '<a class="btn-primary as-link" href="index.html">Book a visit</a>' +
        (past.length ? '<details class="a-past"><summary>Past and cancelled (' + past.length + ')</summary><ul class="stack">' +
          past.map(function (b) { return bookingCard(b, false); }).join('') + '</ul></details>' : '');
    }

    return '<h1 class="h1">' + (first ? 'Hi, ' + esc(first) : 'My account') + '</h1>' +
      (needsProfile ? profile + visits : visits + profile) +
      '<p class="muted sm center">Signed in as ' + esc(state.account.email) + ' · <button class="link-inline" data-act="signout">Sign out</button></p>';
  }

  function render() {
    var views = { checking: function () { return '<p class="muted center pad" role="status">Loading…</p>'; }, signin: viewSignIn, sent: viewSent, account: viewAccount };
    $('#main').innerHTML = views[state.view]();
  }

  function show(view) {
    state.view = view; render();
    var h = $('#main h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  // ---------- data ----------
  function loadAccount() {
    return API.getClientAccount().then(function (acct) {
      if (!acct) { show('signin'); return; }
      state.account = acct;
      state.profile = { name: acct.client.name || '', phone: acct.client.phone || '' };
      show('account');
      return API.myBookings().then(function (list) { state.bookings = list; render(); }, function () { state.bookings = []; render(); });
    }, function () { state.error = 'Couldn’t reach the server. Check your connection.'; show('signin'); });
  }

  // ---------- events ----------
  document.addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target.id === 'signin') {
      var email = e.target.email.value.trim();
      state.email = email;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { state.error = 'Please enter your email.'; render(); return; }
      state.error = ''; state.busy = true; render();
      API.clientSignIn(email).then(function (res) {
        state.busy = false;
        if (res && res.instant) { loadAccount(); } else { show('sent'); }
      }, function (err) {
        state.busy = false;
        state.error = /rate|seconds/i.test(err.message || '') ? 'Too many tries. Wait a minute and try again.' : 'Couldn’t send the link. Try again.';
        render();
      });
    } else if (e.target.id === 'profile') {
      var p = state.profile;
      if (p.name.trim().length < 2) { state.profileMsg = { err: true, text: 'Please enter your name.' }; render(); return; }
      if (p.phone.replace(/\D/g, '').length < 10) { state.profileMsg = { err: true, text: 'Please enter a 10-digit mobile number.' }; render(); return; }
      state.profileMsg = { text: 'Saving…' }; render();
      API.updateMyProfile(p.name, p.phone).then(function (c) {
        state.account.client = c; state.profileMsg = { text: 'Saved.' }; render();
      }, function () { state.profileMsg = { err: true, text: 'Couldn’t save. Try again.' }; render(); });
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.form && e.target.form.id === 'profile' && e.target.name) { state.profile[e.target.name] = e.target.value; }
  });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled) { return; }
    var act = el.getAttribute('data-act'), v = el.getAttribute('data-v');
    if (act === 'retry') { show('signin'); }
    else if (act === 'ask') { state.confirming = v; render(); }
    else if (act === 'keep') { state.confirming = null; render(); }
    else if (act === 'cancel') {
      el.disabled = true;
      API.cancelMyBooking(v).then(function () {
        state.confirming = null;
        return API.myBookings().then(function (list) { state.bookings = list; render(); });
      }, function () { state.cancelMsg[v] = 'Couldn’t cancel this visit. Please call us.'; state.confirming = null; render(); });
    }
    else if (act === 'signout') {
      API.clientSignOut().then(function () { state.account = null; state.bookings = null; show('signin'); });
    }
  });

  $('#call').href = CFG.business.phoneHref;
  $('#call').setAttribute('aria-label', 'Call ' + CFG.business.name + ' at ' + CFG.business.phone);
  $('.call-num').textContent = CFG.business.phone; // shown beside the icon on wide screens
  render();
  loadAccount();
});
