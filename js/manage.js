// Buff Beauty Bar — client "manage my booking".
// Look up by reference + mobile, then cancel. To reschedule, cancel and book again.

window.BuffAPI.ready.then(function () {
  var CFG = window.BUFF_CONFIG;
  var API = window.BuffAPI;

  var params = new URLSearchParams(location.search);
  var state = {
    view: 'find',          // find → booking → done
    ref: params.get('ref') || '',
    phone: '',
    error: '',
    busy: false,
    confirming: false,
    booking: null,
  };

  function $(sel) { return document.querySelector(sel); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return '$' + n.toLocaleString('en-US'); }
  function longDate(iso) { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }
  function providerName(id) { var p = CFG.providers.filter(function (x) { return x.id === id; })[0]; return p ? p.name : 'First available'; }
  function startsAt(b) { var d = new Date(b.date + 'T00:00:00'); d.setMinutes(b.start); return d; }
  function hoursUntil(b) { return (startsAt(b) - new Date()) / 36e5; }

  function viewFind() {
    return '<h1 class="h1">Manage your booking</h1>' +
      '<p class="muted sm">Enter the reference from your confirmation and the mobile number you booked with.</p>' +
      '<form id="find" class="card form" novalidate>' +
        '<div class="field"><label for="f-ref">Reference</label><input id="f-ref" name="ref" type="text" autocapitalize="characters" autocomplete="off" placeholder="BB-XXXXXX" value="' + esc(state.ref) + '"></div>' +
        '<div class="field"><label for="f-phone">Mobile</label><input id="f-phone" name="phone" type="tel" autocomplete="tel" placeholder="(504) 555-0123" value="' + esc(state.phone) + '"></div>' +
        (state.error ? '<p class="notice" role="alert">' + esc(state.error) + '</p>' : '') +
        '<button class="btn-primary" type="submit"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Looking…' : 'Find my booking') + '</button>' +
      '</form>' +
      '<p class="muted sm center">Can’t find it? Call us at <a href="' + CFG.business.phoneHref + '">' + esc(CFG.business.phone) + '</a>.</p>' +
      '<a class="link center" href="account.html">Sign in to see all your visits</a>';
  }

  function bookingCard(b) {
    var who = b.provider === 'any' ? 'First available' : providerName(b.provider);
    return '<div class="card summary"><div class="label">' + (b.status === 'cancelled' ? 'Cancelled' : 'Your visit') + '</div>' +
      '<div class="b lg">' + esc(longDate(b.date)) + ' at ' + esc(API.formatTime(b.start)) + '</div>' +
      '<div>' + esc(b.services.join(' + ')) + '</div>' +
      '<div class="muted sm">' + esc(who) + ' · ' + b.mins + ' min' + (b.guests > 1 ? ' · ' + b.guests + ' guests' : '') + ' · ' + money(b.total) + '</div>' +
      '<div class="muted xs">Reference ' + esc(b.id) + '</div></div>';
  }

  function viewBooking() {
    var b = state.booking;
    if (b.status === 'cancelled') {
      return '<h1 class="h1">This booking was cancelled</h1>' + bookingCard(b) +
        '<a class="btn-primary as-link" href="index.html">Book a new visit</a>';
    }
    var past = hoursUntil(b) < 0 || b.status !== 'booked'; // checked in or no-show
    if (past) {
      return '<h1 class="h1">This visit has passed</h1>' + bookingCard(b) +
        '<a class="btn-primary as-link" href="index.html">Book again</a>';
    }
    var late = hoursUntil(b) < CFG.business.cancellationWindowHours;
    var warn = late
      ? '<p class="notice">This visit is less than ' + CFG.business.cancellationWindowHours + ' hours away, so a late-cancellation fee may apply. See the <a href="' + CFG.business.cancellationPolicyUrl + '" target="_blank" rel="noopener">cancellation policy</a>.</p>'
      : '<p class="muted sm">Free to cancel until ' + CFG.business.cancellationWindowHours + ' hours before your visit.</p>';
    var actions = state.confirming
      ? '<div class="card form"><div class="b">Cancel this visit?</div>' +
          '<button class="btn-danger" data-act="cancel"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Cancelling…' : 'Yes, cancel it') + '</button>' +
          '<button class="link" data-act="keep">Keep my booking</button></div>'
      : '<button class="btn-outline" data-act="ask">Cancel booking</button>';
    var err = state.error ? '<p class="notice" role="alert">' + esc(state.error) + '</p>' : '';
    return '<h1 class="h1">Here’s your booking</h1>' + bookingCard(b) + warn + err + actions +
      '<p class="muted sm center">Want a different time? Cancel this one, then <a href="index.html">book a new time</a>. Or call us at <a href="' + CFG.business.phoneHref + '">' + esc(CFG.business.phone) + '</a>.</p>';
  }

  function viewDone() {
    return '<div class="done"><div class="done-badge"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg></div>' +
      '<h1 class="h1 center">Your visit is cancelled</h1>' +
      '<p class="center muted">We’ve let the team know. Hope to see you soon.</p>' +
      bookingCard(state.booking) +
      '<a class="btn-primary as-link" href="index.html">Book a new time</a></div>';
  }

  function render() {
    var views = { find: viewFind, booking: viewBooking, done: viewDone };
    $('#main').innerHTML = views[state.view]() + '<a class="staff-link" href="staff.html">Staff</a>';
  }

  function show(view) {
    state.view = view; state.confirming = false; render();
    var h = $('#main h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  document.addEventListener('input', function (e) {
    if (e.target.form && e.target.form.id === 'find') { state[e.target.name] = e.target.value; }
  });

  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'find') { return; }
    e.preventDefault();
    if (!state.ref.trim() || state.phone.replace(/\D/g, '').length < 10) {
      state.error = 'Please enter your reference and 10-digit mobile number.'; render(); return;
    }
    state.busy = true; state.error = ''; render();
    API.findBooking(state.ref, state.phone).then(function (b) {
      state.busy = false;
      if (!b) { state.error = 'We couldn’t find a booking with that reference and number.'; render(); return; }
      state.booking = b; state.error = ''; show('booking');
    });
  });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled) { return; }
    var act = el.getAttribute('data-act');
    if (act === 'ask') { state.confirming = true; render(); var y = $('[data-act="cancel"]'); if (y) { y.focus(); } }
    else if (act === 'keep') { state.confirming = false; render(); }
    else if (act === 'cancel') {
      state.busy = true; render();
      API.cancelBooking(state.booking.id, state.phone).then(function (b) {
        state.busy = false; state.booking = b; show('done');
      }, function () {
        state.busy = false; state.error = 'We couldn’t cancel this booking. Please call us.'; render();
      });
    }
  });

  $('#call').href = CFG.business.phoneHref;
  $('#call').setAttribute('aria-label', 'Call ' + CFG.business.name + ' at ' + CFG.business.phone);
  $('.call-num').textContent = CFG.business.phone; // shown beside the icon on wide screens
  render();
});
