// Buff Beauty Bar — front desk.
// Tabs: Schedule (day view by provider) · Waitlist · Time off (request + manager approval).

window.BuffAPI.ready.then(function () {
  var CFG = window.BUFF_CONFIG;
  var API = window.BuffAPI;
  var PX = 1.6; // schedule pixels per minute

  var state = {
    tab: 'schedule',
    date: (function () { // staff.html?date=YYYY-MM-DD opens that day (e.g. after booking a phone client)
      var d = new URLSearchParams(location.search).get('date');
      return /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : isoDate(new Date());
    })(),
    bookings: [],
    timeOff: [],       // for the schedule day
    waitlist: [],
    requests: [],      // time off list
    form: { providerId: CFG.providers[0].id, date: isoDate(new Date()), allDay: true, start: '12:00', end: '15:00', reason: '' },
    formError: '',
    loading: true,
    team: null,        // all providers incl. hidden (managers' Team tab)
    drafts: {},        // unsaved edits on the Team tab, by provider id ('new' for the add form)
    teamMsg: {},       // per-card status line, by provider id (and menu keys like 'svc:12')
    menu: null,        // { services, categories } for the managers' Menu tab
    menuCat: null,     // category being edited on the Menu tab
    auth: 'checking',  // checking → signin → sent | denied | ok
    staff: null,       // { email, role, providerId }
    signInEmail: '',
    signInError: '',
  };

  // ---------- helpers ----------
  function $(sel) { return document.querySelector(sel); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return '$' + n.toLocaleString('en-US'); }
  function isoDate(d) { var m = d.getMonth() + 1, day = d.getDate(); return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day; }
  function fromISO(iso) { return new Date(iso + 'T00:00:00'); }
  function addDays(iso, n) { var d = fromISO(iso); d.setDate(d.getDate() + n); return isoDate(d); }
  function longDate(iso) { return fromISO(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }
  function shortDate(iso) { return fromISO(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
  function provider(id) { return CFG.providers.filter(function (p) { return p.id === id; })[0]; }
  function providerName(id) { return id === 'any' ? 'First available' : (provider(id) || { name: id }).name; }
  function hoursOn(iso) { var h = CFG.hours[fromISO(iso).getDay()]; return h ? { open: API.toMin(h.open), close: API.toMin(h.close) } : null; }
  function fmt(m) { return API.formatTime(m); }
  function range(t) { return t.allDay ? 'All day' : fmt(t.start) + ' – ' + fmt(t.end); }
  function isManager() { return state.staff && state.staff.role === 'manager'; }
  var STATUS = { booked: 'Booked', arrived: 'Checked in', 'no-show': 'No-show', cancelled: 'Cancelled' };

  // ---------- data ----------
  function load() {
    state.loading = true; render();
    var d = state.date;
    return Promise.all([API.listBookings(d), API.timeOffOn(d), API.listWaitlist(), API.listTimeOff()]).then(function (r) {
      if (d !== state.date) { return; } // user moved on to another day
      state.bookings = r[0]; state.timeOff = r[1]; state.waitlist = r[2]; state.requests = r[3];
      state.loading = false; render();
    });
  }

  // ---------- schedule ----------
  function viewSchedule() {
    var hrs = hoursOn(state.date);
    var isToday = state.date === isoDate(new Date());
    var live = state.bookings.filter(function (b) { return b.status !== 'cancelled'; });
    var revenue = live.reduce(function (sum, b) { return sum + (b.total || 0); }, 0);
    var arrived = live.filter(function (b) { return b.status === 'arrived'; }).length;

    var bar = '<div class="s-bar">' +
      '<div class="s-datenav">' +
        '<button class="round" data-act="day" data-v="-1" aria-label="Previous day">‹</button>' +
        '<h1 class="s-date">' + esc(longDate(state.date)) + '</h1>' +
        '<button class="round" data-act="day" data-v="1" aria-label="Next day">›</button>' +
        (isToday ? '' : '<button class="chip" data-act="today">Today</button>') +
      '</div>' +
      (hrs ? '<div class="s-stats"><span><b>' + live.length + '</b> appointments</span><span><b>' + arrived + '</b> checked in</span><span><b>' + money(revenue) + '</b> booked</span></div>' : '') +
    '</div>';

    if (state.loading) { return bar + '<p class="muted center pad" role="status">Loading…</p>'; }
    if (!hrs) { return bar + '<div class="card pad"><p class="center muted">Closed this day.</p></div>'; }

    var height = (hrs.close - hrs.open) * PX;
    var rail = '';
    for (var m = hrs.open; m < hrs.close; m += 60) {
      rail += '<div class="s-hour" style="top:' + ((m - hrs.open) * PX) + 'px">' + fmt(m).replace(':00', '') + '</div>';
    }

    var cols = CFG.providers.map(function (p) {
      var blocks = '';
      state.timeOff.filter(function (t) { return t.providerId === p.id; }).forEach(function (t) {
        var s = Math.max(t.start, hrs.open), e = Math.min(t.end, hrs.close);
        if (e <= s) { return; }
        blocks += '<button class="s-off' + (t.status === 'pending' ? ' is-pending' : '') + '" data-act="goto-timeoff" style="top:' + ((s - hrs.open) * PX) + 'px;height:' + ((e - s) * PX - 2) + 'px">' +
          '<span class="b">' + (t.status === 'pending' ? 'Time off requested' : 'Time off') + '</span>' +
          (t.reason ? '<span>' + esc(t.reason) + '</span>' : '') + '</button>';
      });
      live.filter(function (b) { return b.providerIds.indexOf(p.id) >= 0; }).forEach(function (b) {
        var h = b.mins * PX - 2;
        blocks += '<button class="s-appt is-' + b.status + (b.sample ? ' is-sample' : '') + (h < 60 ? ' is-short' : '') + '" data-act="appt" data-v="' + esc(b.id) + '" style="top:' + ((b.start - hrs.open) * PX) + 'px;height:' + h + 'px">' +
          '<span class="s-appt-time">' + fmt(b.start) + (b.status === 'arrived' ? ' · In' : b.status === 'no-show' ? ' · No-show' : '') + '</span>' +
          '<span class="s-appt-name">' + esc(b.client.name) + (b.guests > 1 ? ' +' + (b.guests - 1) : '') + '</span>' +
          '<span class="s-appt-svc">' + esc(b.services.join(', ')) + '</span></button>';
      });
      return '<div class="s-col"><div class="s-colhead"><span class="avatar sm">' + esc(p.initials) + '</span><span>' + esc(p.name) + '</span></div>' +
        '<div class="s-colbody" style="height:' + height + 'px">' + blocks + '</div></div>';
    }).join('');

    var now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    var nowLine = isToday && nowMin >= hrs.open && nowMin <= hrs.close
      ? '<div class="s-now" style="top:' + ((nowMin - hrs.open) * PX) + 'px" aria-hidden="true"></div>' : '';

    var cancelled = state.bookings.filter(function (b) { return b.status === 'cancelled'; });
    var cancelledList = cancelled.length
      ? '<details class="card s-cancelled"><summary>Cancelled (' + cancelled.length + ')</summary><ul class="list">' + cancelled.map(function (b) {
          return '<li><button class="svc" data-act="appt" data-v="' + esc(b.id) + '"><span class="svc-main"><span class="svc-name">' + esc(b.client.name) + '</span>' +
            '<span class="muted sm">' + fmt(b.start) + ' · ' + esc(b.services.join(', ')) + (b.cancelledBy === 'client' ? ' · by client' : '') + '</span></span></button></li>';
        }).join('') + '</ul></details>'
      : '';

    return bar +
      '<div class="s-sched" tabindex="0" aria-label="Schedule grid, scroll to see all providers">' +
        '<div class="s-grid" style="--cols:' + CFG.providers.length + '">' +
          '<div class="s-rail"><div class="s-colhead"></div><div class="s-railbody" style="height:' + height + 'px">' + rail + '</div></div>' +
          '<div class="s-cols" style="background-size:100% ' + (60 * PX) + 'px">' + cols + nowLine + '</div>' +
        '</div>' +
      '</div>' + cancelledList;
  }

  function sheetAppt(b) {
    var who = b.providerIds.map(providerName).join(', ');
    var c = b.client;
    var contact = (c.phone ? '<a href="tel:' + esc(c.phone.replace(/[^\d+]/g, '')) + '">' + esc(c.phone) + '</a>' : '') +
      (c.phone && c.email ? ' · ' : '') + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '');
    var actions = b.status === 'cancelled'
      ? '<button class="btn-outline" data-act="status" data-v="booked">Restore booking</button>'
      : (b.status === 'arrived'
          ? '<button class="btn-outline" data-act="status" data-v="booked">Undo check-in</button>'
          : '<button class="btn-primary" data-act="status" data-v="arrived">Check in</button>') +
        (b.status === 'no-show'
          ? '<button class="btn-outline" data-act="status" data-v="booked">Undo no-show</button>'
          : '<button class="btn-outline" data-act="status" data-v="no-show">Mark no-show</button>') +
        '<button class="btn-text-danger" data-act="status" data-v="cancelled">Cancel appointment</button>';
    return '<div class="sheet-head"><h2 id="sheet-title" class="h1">' + esc(c.name) + '</h2>' +
        '<button class="icon-btn" data-act="close" aria-label="Close">✕</button></div>' +
      '<div class="sheet-body">' +
        '<span class="badge is-' + b.status + '">' + STATUS[b.status] + '</span>' +
        '<div class="b lg">' + esc(shortDate(b.date)) + ' · ' + fmt(b.start) + ' – ' + fmt(b.start + b.mins) + '</div>' +
        '<div>' + esc(b.services.join(' + ')) + '</div>' +
        '<div class="muted sm">' + esc(who) + (b.guests > 1 ? ' · ' + b.guests + ' guests' : '') + ' · ' + money(b.total || 0) + '</div>' +
        (contact ? '<div class="sm">' + contact + '</div>' : '') +
        (c.note ? '<div class="card pad-sm sm"><span class="b">Note:</span> ' + esc(c.note) + '</div>' : '') +
        '<div class="muted xs">' + (b.sample ? 'Sample appointment' : (b.bookedBy ? 'Booked by ' + esc(b.bookedBy) : 'Booked online') + ' · ' + esc(b.id)) + '</div>' +
      '</div>' +
      '<div class="sheet-actions" data-id="' + esc(b.id) + '">' + actions + '</div>';
  }

  function openAppt(id) {
    var b = state.bookings.filter(function (x) { return x.id === id; })[0];
    if (!b) { return; }
    var sheet = $('#sheet');
    sheet.innerHTML = sheetAppt(b);
    if (!sheet.open) { sheet.showModal(); }
  }

  // ---------- waitlist ----------
  function viewWaitlist() {
    if (state.loading) { return '<h1 class="h1">Waitlist</h1><p class="muted center pad" role="status">Loading…</p>'; }
    if (!state.waitlist.length) {
      return '<h1 class="h1">Waitlist</h1><div class="card pad"><p class="center muted">No one is waiting. Clients join from the booking page when a day is full.</p></div>';
    }
    var cards = state.waitlist.map(function (w) {
      var c = w.client;
      var first = c.name.split(' ')[0];
      var opening = w.openings[0];
      var sms = 'Hi ' + first + ', it’s ' + CFG.business.name + '! A spot just opened ' + shortDate(w.date) + ' at ' + opening + ' for ' + w.services.join(' + ') + '. Reply YES to grab it.';
      var phone = c.phone.replace(/[^\d+]/g, '');
      return '<li class="card s-wl">' +
        '<div class="row-between"><div><div class="b">' + esc(c.name) + '</div><div class="muted sm">' + esc(shortDate(w.date)) + ' · ' + w.mins + ' min' + (w.guests > 1 ? ' · ' + w.guests + ' guests' : '') + ' · ' + esc(providerName(w.provider)) + '</div></div>' +
          '<button class="btn-text-danger sm" data-act="wl-remove" data-v="' + esc(w.id) + '">Remove</button></div>' +
        '<div class="sm">' + esc(w.services.join(' + ')) + '</div>' +
        (c.note ? '<div class="muted sm">“' + esc(c.note) + '”</div>' : '') +
        (w.openings.length
          ? '<div class="s-open"><span class="b sm">Open now:</span> ' + w.openings.slice(0, 6).map(esc).join(', ') + (w.openings.length > 6 ? ' +' + (w.openings.length - 6) + ' more' : '') + '</div>' +
            '<div class="row-wrap"><a class="btn-primary sm as-link" href="sms:' + esc(phone) + '?&body=' + encodeURIComponent(sms) + '">Text about ' + esc(opening) + '</a>' +
            '<a class="btn-outline sm as-link" href="tel:' + esc(phone) + '">Call</a></div>'
          : '<div class="muted sm">No openings yet for this visit.</div>') +
      '</li>';
    }).join('');
    return '<h1 class="h1">Waitlist</h1><p class="muted sm">Openings update as appointments are cancelled. First to claim a spot gets it.</p><ul class="stack">' + cards + '</ul>';
  }

  // ---------- time off ----------
  function viewTimeOff() {
    var f = state.form;
    var own = state.staff && state.staff.role === 'provider' && state.staff.providerId;
    var pros = CFG.providers.filter(function (p) { return !own || p.id === own; }).map(function (p) { return '<option value="' + p.id + '"' + (p.id === f.providerId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('');
    var form = '<form id="to-form" class="card form" novalidate>' +
      '<div class="b">Request time off</div>' +
      '<div class="field"><label for="to-pro">Provider</label><select id="to-pro" name="providerId">' + pros + '</select></div>' +
      '<div class="field"><label for="to-date">Date</label><input id="to-date" name="date" type="date" min="' + isoDate(new Date()) + '" value="' + esc(f.date) + '"></div>' +
      '<label class="agree"><input type="checkbox" name="allDay"' + (f.allDay ? ' checked' : '') + '><span>All day</span></label>' +
      (f.allDay ? '' : '<div class="row-2">' +
        '<div class="field"><label for="to-start">From</label><input id="to-start" name="start" type="time" step="900" value="' + esc(f.start) + '"></div>' +
        '<div class="field"><label for="to-end">To</label><input id="to-end" name="end" type="time" step="900" value="' + esc(f.end) + '"></div></div>') +
      '<div class="field"><label for="to-reason">Reason (optional)</label><input id="to-reason" name="reason" type="text" placeholder="Doctor, vacation…" value="' + esc(f.reason) + '"></div>' +
      (state.formError ? '<p class="notice" role="alert">' + esc(state.formError) + '</p>' : '') +
      '<button class="btn-primary" type="submit">Send to manager</button>' +
      '<p class="muted xs">Pending requests show on the schedule but don’t block online booking until they’re approved.</p>' +
    '</form>';

    if (state.loading) { return '<h1 class="h1">Time off</h1>' + form; }

    var pending = state.requests.filter(function (t) { return t.status === 'pending'; });
    var decided = state.requests.filter(function (t) { return t.status !== 'pending'; });

    function card(t, withActions) {
      var conflicts = t.conflicts.length
        ? '<div class="notice">' + t.conflicts.length + ' appointment' + (t.conflicts.length === 1 ? '' : 's') + ' already booked in this window. Move ' +
            (t.conflicts.length === 1 ? 'it' : 'them') + ' before or after approving: ' +
            t.conflicts.map(function (c) { return esc(c.label + ' ' + c.client); }).join(', ') + '</div>'
        : (withActions ? '<div class="muted sm">No appointments in this window.</div>' : '');
      return '<li class="card s-wl">' +
        '<div class="row-between"><div><div class="b">' + esc(providerName(t.providerId)) + '</div>' +
          '<div class="muted sm">' + esc(shortDate(t.date)) + ' · ' + range(t) + (t.reason ? ' · ' + esc(t.reason) : '') + '</div></div>' +
          (withActions ? '' : '<span class="badge is-' + t.status + '">' + (t.status === 'approved' ? 'Approved' : 'Denied') + '</span>') + '</div>' +
        conflicts +
        (withActions && !isManager() ? '<div class="muted sm">Waiting for the manager.</div>' : '') +
        (withActions && isManager() ? '<div class="row-wrap"><button class="btn-primary sm" data-act="to-decide" data-v="approved" data-id="' + esc(t.id) + '">Approve</button>' +
          '<button class="btn-outline sm" data-act="to-decide" data-v="denied" data-id="' + esc(t.id) + '">Deny</button>' +
          '<button class="link sm" data-act="to-view" data-v="' + esc(t.date) + '">See day</button></div>' : '') +
      '</li>';
    }

    return '<h1 class="h1">Time off</h1>' +
      '<div class="s-two">' +
        '<section>' + form + '</section>' +
        '<section class="s-lists">' +
          '<h2 class="label">Needs manager approval (' + pending.length + ')</h2>' +
          (pending.length ? '<ul class="stack">' + pending.map(function (t) { return card(t, true); }).join('') + '</ul>' : '<div class="card pad-sm muted sm">Nothing waiting.</div>') +
          (decided.length ? '<h2 class="label">Decided</h2><ul class="stack">' + decided.map(function (t) { return card(t, false); }).join('') + '</ul>' : '') +
        '</section>' +
      '</div>';
  }

  // ---------- team (managers) ----------
  function loadTeam() {
    return API.listProviders().then(function (list) { state.team = list; render(); });
  }

  function draftFor(p) {
    return state.drafts[p.id] || { name: p.name, initials: p.initials, blurb: p.blurb, active: p.active };
  }

  function teamFields(id, d) {
    return '<div class="field"><label for="tm-name-' + id + '">Name</label><input id="tm-name-' + id + '" data-team="' + id + '" name="name" type="text" maxlength="40" autocomplete="off" value="' + esc(d.name) + '"></div>' +
      '<div class="row-2 s-team-row">' +
        '<div class="field"><label for="tm-ini-' + id + '">Initials</label><input id="tm-ini-' + id + '" data-team="' + id + '" name="initials" type="text" maxlength="3" autocomplete="off" autocapitalize="characters" value="' + esc(d.initials) + '"></div>' +
        '<div class="field"><label for="tm-blurb-' + id + '">Shown under name</label><input id="tm-blurb-' + id + '" data-team="' + id + '" name="blurb" type="text" maxlength="60" autocomplete="off" placeholder="Hair · Makeup" value="' + esc(d.blurb) + '"></div>' +
      '</div>';
  }

  function viewTeam() {
    if (!isManager()) { return '<h1 class="h1">Team</h1><div class="card pad"><p class="center muted">Only managers can edit the team.</p></div>'; }
    if (!state.team) { return '<h1 class="h1">Team</h1><p class="muted center pad" role="status">Loading…</p>'; }
    var cards = state.team.map(function (p, i) {
      var d = draftFor(p);
      var dirty = !!state.drafts[p.id];
      var msg = state.teamMsg[p.id];
      return '<li class="card s-wl' + (p.active ? '' : ' is-hidden-pro') + '">' +
        '<div class="row-between"><div class="row-wrap"><span class="avatar">' + esc(d.initials || '?') + '</span>' +
          '<div><div class="b">' + esc(d.name || 'Unnamed') + '</div><div class="muted xs">' + (p.active ? 'On the booking page' : 'Hidden from booking') + '</div></div></div>' +
          '<div class="row-wrap s-move">' +
            '<button class="round" data-act="tm-move" data-v="-1" data-id="' + esc(p.id) + '" aria-label="Move ' + esc(p.name) + ' up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button class="round" data-act="tm-move" data-v="1" data-id="' + esc(p.id) + '" aria-label="Move ' + esc(p.name) + ' down"' + (i === state.team.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '</div></div>' +
        teamFields(p.id, d) +
        '<label class="agree"><input type="checkbox" data-team="' + esc(p.id) + '" name="active"' + (d.active ? ' checked' : '') + '><span>Show on the booking page</span></label>' +
        (msg ? '<p class="' + (msg.err ? 'notice' : 'muted sm') + '" role="status">' + esc(msg.text) + '</p>' : '') +
        '<div class="row-wrap"><button class="btn-primary sm" data-act="tm-save" data-id="' + esc(p.id) + '"' + (dirty ? '' : ' disabled') + '>Save</button>' +
          (dirty ? '<button class="link sm" data-act="tm-undo" data-id="' + esc(p.id) + '">Undo changes</button>' : '') + '</div>' +
      '</li>';
    }).join('');
    var nd = state.drafts['new'] || { name: '', initials: '', blurb: '' };
    var nmsg = state.teamMsg['new'];
    var add = '<div class="card form"><div class="b">Add a provider</div>' + teamFields('new', nd) +
      (nmsg ? '<p class="' + (nmsg.err ? 'notice' : 'muted sm') + '" role="status">' + esc(nmsg.text) + '</p>' : '') +
      '<button class="btn-primary" data-act="tm-add">Add provider</button></div>';
    return '<h1 class="h1">Team</h1>' +
      '<p class="muted sm">Names and descriptions show on the booking page and the schedule. Hide someone who has left instead of deleting them, so their past bookings keep their name.</p>' +
      '<div class="s-two"><section class="s-lists"><ul class="stack">' + cards + '</ul></section><section>' + add + '</section></div>';
  }

  function cleanDraft(d) {
    var name = String(d.name || '').trim().replace(/\s+/g, ' ');
    var initials = String(d.initials || '').trim().toUpperCase();
    if (!initials) { initials = name.split(' ').map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase(); }
    return { name: name, initials: initials, blurb: String(d.blurb || '').trim(), active: d.active !== false };
  }

  function saveTeam(id) {
    var p = state.team.filter(function (x) { return x.id === id; })[0];
    var d = cleanDraft(state.drafts[id] || {});
    if (!d.name) { state.teamMsg[id] = { err: true, text: 'Please enter a name.' }; render(); return; }
    if (!d.active && state.team.filter(function (x) { return x.active && x.id !== id; }).length === 0) {
      state.teamMsg[id] = { err: true, text: 'At least one provider has to stay on the booking page.' }; render(); return;
    }
    state.teamMsg[id] = { text: 'Saving…' }; render();
    API.saveProvider(Object.assign({}, p, d), false).then(function () {
      delete state.drafts[id];
      state.teamMsg[id] = { text: 'Saved. Clients see the change next time they open the booking page.' };
      return Promise.all([loadTeam(), load()]);
    }, function () { state.teamMsg[id] = { err: true, text: 'Couldn’t save. Check your connection and try again.' }; render(); });
  }

  function addTeam() {
    var d = cleanDraft(state.drafts['new'] || {});
    if (!d.name) { state.teamMsg['new'] = { err: true, text: 'Please enter a name.' }; render(); return; }
    var max = state.team.reduce(function (m, p) { var n = +(/^p(\d+)$/.exec(p.id) || [0, 0])[1]; return Math.max(m, n); }, 0);
    var sort = state.team.reduce(function (m, p) { return Math.max(m, p.sort); }, -1) + 1;
    var rec = Object.assign({ id: 'p' + (max + 1), sort: sort }, d, { active: true });
    state.teamMsg['new'] = { text: 'Adding…' }; render();
    API.saveProvider(rec, true).then(function () {
      delete state.drafts['new'];
      state.teamMsg['new'] = { text: rec.name + ' added to the booking page.' };
      return Promise.all([loadTeam(), load()]);
    }, function () { state.teamMsg['new'] = { err: true, text: 'Couldn’t add. Check your connection and try again.' }; render(); });
  }

  function moveTeam(id, dir) {
    var list = state.team.slice();
    var i = list.map(function (p) { return p.id; }).indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) { return; }
    var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    state.team = list; render();
    // renumber everyone so the order is unambiguous, saving only rows that changed
    var saves = [];
    list.forEach(function (p, k) { if (p.sort !== k) { saves.push(API.saveProvider(Object.assign({}, p, { sort: k }), false)); } });
    Promise.all(saves).then(function () { return Promise.all([loadTeam(), load()]); }, function () { loadTeam(); });
  }

  // ---------- menu (managers) ----------
  function loadMenu() {
    return API.listMenu().then(function (m) { state.menu = m; render(); });
  }

  function svcById(id) { return state.menu.services.filter(function (s) { return String(s.id) === String(id); })[0]; }

  function menuBase(key) {
    var kind = key.split(':')[0], rest = key.slice(kind.length + 1);
    if (kind === 'cat') { return { name: rest === 'new' ? '' : rest }; }
    if (rest === 'new') { return { name: '', price: '', mins: 30, cat: state.menuCat, priceNote: false, active: true }; }
    var s = svcById(rest);
    return { name: s.name, price: s.price, mins: s.mins, cat: s.cat, priceNote: !!s.priceNote, active: s.active };
  }
  function menuDraft(key) { return state.drafts[key] || menuBase(key); }
  function msgLine(key) {
    var m = state.teamMsg[key];
    return m ? '<p class="' + (m.err ? 'notice' : 'muted sm') + '" role="status">' + esc(m.text) + '</p>' : '';
  }

  function svcFields(key, d) {
    var id = key.replace(':', '-');
    var cats = state.menu.categories.map(function (c) { return '<option' + (c === d.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    return '<div class="field"><label for="mn-name-' + id + '">Service name</label><input id="mn-name-' + id + '" data-menu="' + esc(key) + '" name="name" type="text" maxlength="60" autocomplete="off" value="' + esc(d.name) + '"></div>' +
      '<div class="s-svc-row">' +
        '<div class="field"><label for="mn-price-' + id + '">Price ($)</label><input id="mn-price-' + id + '" data-menu="' + esc(key) + '" name="price" type="number" inputmode="decimal" min="0" step="1" value="' + esc(d.price) + '"></div>' +
        '<div class="field"><label for="mn-mins-' + id + '">Minutes</label><input id="mn-mins-' + id + '" data-menu="' + esc(key) + '" name="mins" type="number" inputmode="numeric" min="5" max="600" step="5" value="' + esc(d.mins) + '"></div>' +
        '<div class="field"><label for="mn-cat-' + id + '">Category</label><select id="mn-cat-' + id + '" data-menu="' + esc(key) + '" name="cat">' + cats + '</select></div>' +
      '</div>' +
      '<label class="agree"><input type="checkbox" data-menu="' + esc(key) + '" name="priceNote"' + (d.priceNote ? ' checked' : '') + '><span>Starting price (shows as ' + money(+d.price || 0) + '+)</span></label>';
  }

  function viewMenu() {
    if (!isManager()) { return '<h1 class="h1">Menu</h1><div class="card pad"><p class="center muted">Only managers can edit the menu.</p></div>'; }
    if (!state.menu) { return '<h1 class="h1">Menu</h1><p class="muted center pad" role="status">Loading…</p>'; }
    var cats = state.menu.categories;
    if (cats.indexOf(state.menuCat) < 0) { state.menuCat = cats[0] || null; }
    function count(c) { return state.menu.services.filter(function (s) { return s.cat === c; }).length; }

    // categories
    var catRows = cats.map(function (c, i) {
      var key = 'cat:' + c, d = menuDraft(key), n = count(c);
      return '<li class="s-cat">' +
        '<input aria-label="Category name" data-menu="' + esc(key) + '" name="name" type="text" maxlength="30" autocomplete="off" value="' + esc(d.name) + '">' +
        '<span class="muted xs s-cat-n">' + n + (n === 1 ? ' service' : ' services') + '</span>' +
        '<button class="btn-outline sm" data-act="mn-cat-rename" data-k="' + esc(c) + '"' + (state.drafts[key] ? '' : ' disabled') + '>Rename</button>' +
        '<button class="round" data-act="mn-cat-move" data-k="' + esc(c) + '" data-v="-1" aria-label="Move ' + esc(c) + ' earlier"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="round" data-act="mn-cat-move" data-k="' + esc(c) + '" data-v="1" aria-label="Move ' + esc(c) + ' later"' + (i === cats.length - 1 ? ' disabled' : '') + '>↓</button>' +
        (n ? '' : '<button class="btn-text-danger sm" data-act="mn-cat-del" data-k="' + esc(c) + '">Remove</button>') +
        msgLine(key) + '</li>';
    }).join('');
    var nc = menuDraft('cat:new');
    var catCard = '<div class="card form"><div class="b">Categories</div>' +
      '<p class="muted xs">This is the order of the buttons on the booking page.</p>' +
      '<ul class="stack s-cats">' + catRows + '</ul>' +
      '<div class="s-cat s-cat-add"><input aria-label="New category name" data-menu="cat:new" name="name" type="text" maxlength="30" autocomplete="off" placeholder="New category" value="' + esc(nc.name) + '">' +
        '<button class="btn-primary sm" data-act="mn-cat-add">Add</button></div>' + msgLine('cat:new') + '</div>';

    // services in the chosen category
    var chips = cats.map(function (c) {
      return '<button class="chip' + (c === state.menuCat ? ' is-on' : '') + '" data-act="mn-pick" data-k="' + esc(c) + '" aria-pressed="' + (c === state.menuCat) + '">' + esc(c) + '</button>';
    }).join('');
    var list = state.menu.services.filter(function (s) { return s.cat === state.menuCat; });
    var cards = list.map(function (s, i) {
      var key = 'svc:' + s.id, d = menuDraft(key), dirty = !!state.drafts[key];
      return '<li class="card s-wl' + (s.active ? '' : ' is-hidden-pro') + '">' +
        '<div class="row-between"><div><div class="b">' + esc(s.name) + '</div><div class="muted xs">' + money(s.price) + (s.priceNote ? '+' : '') + ' · ' + s.mins + ' min' + (s.active ? '' : ' · hidden from booking') + '</div></div>' +
          '<div class="row-wrap s-move">' +
            '<button class="round" data-act="mn-move" data-k="' + s.id + '" data-v="-1" aria-label="Move ' + esc(s.name) + ' up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button class="round" data-act="mn-move" data-k="' + s.id + '" data-v="1" aria-label="Move ' + esc(s.name) + ' down"' + (i === list.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '</div></div>' +
        svcFields(key, d) +
        '<label class="agree"><input type="checkbox" data-menu="' + esc(key) + '" name="active"' + (d.active ? ' checked' : '') + '><span>Show on the booking page</span></label>' +
        msgLine(key) +
        '<div class="row-wrap"><button class="btn-primary sm" data-act="mn-save" data-k="' + s.id + '"' + (dirty ? '' : ' disabled') + '>Save</button>' +
          (dirty ? '<button class="link sm" data-act="mn-undo" data-k="' + s.id + '">Undo changes</button>' : '') +
          '<button class="btn-text-danger sm s-push" data-act="mn-del" data-k="' + s.id + '">Delete</button></div>' +
      '</li>';
    }).join('');
    var add = state.menuCat
      ? '<li class="card form"><div class="b">Add a service to ' + esc(state.menuCat) + '</div>' + svcFields('svc:new', menuDraft('svc:new')) + msgLine('svc:new') +
        '<button class="btn-primary" data-act="mn-add">Add service</button></li>'
      : '<li class="card pad-sm muted sm">Add a category first.</li>';

    return '<h1 class="h1">Menu</h1>' +
      '<p class="muted sm">Changes show on the booking page the next time clients open it. Past bookings keep the service name and price they were booked with.</p>' +
      '<div class="s-two"><section>' + catCard + '</section>' +
      '<section class="s-lists"><div class="chips" role="toolbar" aria-label="Category to edit">' + chips + '</div>' +
        '<ul class="stack">' + (list.length ? cards : '<li class="card pad-sm muted sm">No services in ' + esc(state.menuCat || '') + ' yet.</li>') + add + '</ul></section></div>';
  }

  function cleanService(d) {
    var price = Math.round(parseFloat(d.price) * 100) / 100, mins = parseInt(d.mins, 10);
    var name = String(d.name || '').trim().replace(/\s+/g, ' ');
    if (!name) { return 'Please enter a service name.'; }
    if (!(price >= 0 && price <= 10000)) { return 'Please enter a price.'; }
    if (!(mins >= 5 && mins <= 600)) { return 'Minutes should be between 5 and 600.'; }
    if (!d.cat) { return 'Please pick a category.'; }
    return { name: name, price: price, mins: mins, cat: d.cat, priceNote: d.priceNote ? '+' : '', active: d.active !== false };
  }

  function afterMenuWrite(key, text) {
    delete state.drafts[key];
    if (text) { state.teamMsg[key] = { text: text }; } else { delete state.teamMsg[key]; }
    return loadMenu();
  }
  function menuFail(key) {
    return function (err) {
      state.teamMsg[key] = { err: true, text: err && err.code === 'duplicate' ? err.message : 'Couldn’t save. Check your connection and try again.' };
      render();
    };
  }

  function saveSvc(id) {
    var key = 'svc:' + id, s = svcById(id), c = cleanService(menuDraft(key));
    if (typeof c === 'string') { state.teamMsg[key] = { err: true, text: c }; render(); return; }
    state.teamMsg[key] = { text: 'Saving…' }; render();
    API.saveService(Object.assign({}, s, c), false).then(function () {
      if (c.cat !== state.menuCat) { state.menuCat = c.cat; }
      return afterMenuWrite(key, 'Saved.');
    }, menuFail(key));
  }

  function addSvc() {
    var key = 'svc:new', c = cleanService(menuDraft(key));
    if (typeof c === 'string') { state.teamMsg[key] = { err: true, text: c }; render(); return; }
    // new services go at the end of their category
    var inCat = state.menu.services.filter(function (s) { return s.cat === c.cat; });
    var after = inCat.length ? inCat[inCat.length - 1].sort : state.menu.services.reduce(function (m, s) { return Math.max(m, s.sort); }, -1);
    state.teamMsg[key] = { text: 'Adding…' }; render();
    API.saveService(Object.assign({ sort: after + 1 }, c), true).then(function () {
      state.menuCat = c.cat;
      return afterMenuWrite(key, c.name + ' added.');
    }, menuFail(key));
  }

  function deleteSvc(id) {
    var s = svcById(id);
    if (!confirm('Delete ' + s.name + '? Past bookings keep it. To take it off the booking page for now, untick "Show on the booking page" instead.')) { return; }
    API.deleteService(s.id).then(function () { return afterMenuWrite('svc:' + id); }, menuFail('svc:' + id));
  }

  function moveSvc(id, dir) {
    var all = state.menu.services.slice();
    var s = svcById(id), inCat = all.filter(function (x) { return x.cat === s.cat; });
    var j = inCat.indexOf(s) + dir;
    if (j < 0 || j >= inCat.length) { return; }
    var a = all.indexOf(s), b = all.indexOf(inCat[j]);
    all[a] = inCat[j]; all[b] = s;
    state.menu.services = all; render();
    var saves = [];
    all.forEach(function (x, k) { if (x.sort !== k) { saves.push(API.saveService(Object.assign({}, x, { sort: k }), false)); } });
    Promise.all(saves).then(loadMenu, loadMenu);
  }

  function saveCatOrder(order, key, text) {
    return API.saveCategories(order).then(function () { return afterMenuWrite(key, text); }, menuFail(key));
  }

  function catAction(act, name, dir) {
    var cats = state.menu.categories.slice();
    if (act === 'mn-cat-move') {
      var i = cats.indexOf(name), j = i + dir;
      cats[i] = cats[j]; cats[j] = name;
      state.menu.categories = cats; render();
      saveCatOrder(cats, 'cat:' + name);
    } else if (act === 'mn-cat-del') {
      saveCatOrder(cats.filter(function (c) { return c !== name; }), 'cat:' + name);
    } else if (act === 'mn-cat-add') {
      var nn = String(menuDraft('cat:new').name || '').trim();
      if (!nn) { state.teamMsg['cat:new'] = { err: true, text: 'Please enter a category name.' }; render(); return; }
      if (cats.some(function (c) { return c.toLowerCase() === nn.toLowerCase(); })) { state.teamMsg['cat:new'] = { err: true, text: nn + ' is already a category.' }; render(); return; }
      state.menuCat = nn;
      saveCatOrder(cats.concat(nn), 'cat:new', nn + ' added. Add its first service on the right.');
    } else if (act === 'mn-cat-rename') {
      var key = 'cat:' + name, to = String(menuDraft(key).name || '').trim();
      if (!to) { state.teamMsg[key] = { err: true, text: 'Please enter a name.' }; render(); return; }
      if (to !== name && cats.some(function (c) { return c.toLowerCase() === to.toLowerCase() && c !== name; })) { state.teamMsg[key] = { err: true, text: to + ' is already a category.' }; render(); return; }
      API.renameCategory(name, to).then(function () {
        if (state.menuCat === name) { state.menuCat = to; }
        delete state.drafts[key]; delete state.teamMsg[key];
        state.teamMsg['cat:' + to] = { text: 'Renamed.' };
        return loadMenu();
      }, menuFail(key));
    }
  }

  // ---------- sign-in ----------
  function viewAuth() {
    if (state.auth === 'checking') { return '<p class="muted center pad" role="status">Checking sign-in…</p>'; }
    if (state.auth === 'sent') {
      return '<div class="card form s-auth"><h1 class="h1">Check your email</h1>' +
        '<p>We sent a sign-in link to <b>' + esc(state.signInEmail) + '</b>. Open it on this device.</p>' +
        '<button class="link" data-act="auth-retry">Use a different email</button></div>';
    }
    if (state.auth === 'denied') {
      return '<div class="card form s-auth"><h1 class="h1">Not on the staff list</h1>' +
        '<p><b>' + esc(state.staff.email) + '</b> is signed in but isn’t set up as staff. Ask the manager to add you.</p>' +
        '<button class="btn-outline" data-act="signout">Sign out</button></div>';
    }
    return '<form id="signin" class="card form s-auth" novalidate><h1 class="h1">Staff sign-in</h1>' +
      '<div class="field"><label for="si-email">Work email</label><input id="si-email" name="email" type="email" autocomplete="email" value="' + esc(state.signInEmail) + '"></div>' +
      (state.signInError ? '<p class="notice" role="alert">' + esc(state.signInError) + '</p>' : '') +
      '<button class="btn-primary" type="submit">Email me a sign-in link</button>' +
      '<p class="muted xs">No password needed. The link signs you in on this device.</p></form>';
  }

  function checkAuth() {
    return API.getStaff().then(function (s) {
      state.staff = s;
      state.auth = !s ? 'signin' : s.role ? 'ok' : 'denied';
      if (s && s.role === 'provider' && s.providerId) { state.form.providerId = s.providerId; }
      render();
      if (state.auth === 'ok') {
        if (state.tab === 'team') { loadTeam(); }
        if (state.tab === 'menu') { loadMenu(); }
        return load();
      }
    }, function () { state.auth = 'signin'; state.signInError = 'Couldn’t reach the server. Check your connection.'; render(); });
  }

  // ---------- render ----------
  function render() {
    var signedIn = state.auth === 'ok';
    $('.s-book').href = 'index.html?for=staff&date=' + encodeURIComponent(state.date);
    $('.s-tabs').hidden = !signedIn;
    $('.proto-note').hidden = !signedIn;
    $('#signout').hidden = !signedIn || API.mode !== 'live';
    if (!signedIn) { $('#s-main').innerHTML = viewAuth(); return; }
    if (API.mode === 'live') {
      $('.proto-note').innerHTML = 'Signed in as ' + esc(state.staff.email) + ' (' + esc(state.staff.role) + ').';
    }

    $('[data-tab="team"]').hidden = !isManager();
    $('[data-tab="menu"]').hidden = !isManager();
    document.querySelectorAll('.s-tab').forEach(function (t) {
      var on = t.getAttribute('data-tab') === state.tab;
      t.classList.toggle('is-on', on);
      if (on) { t.setAttribute('aria-current', 'page'); } else { t.removeAttribute('aria-current'); }
    });
    var wl = state.waitlist.filter(function (w) { return w.openings.length; }).length;
    $('#wl-count').hidden = !wl; $('#wl-count').textContent = wl;
    $('#wl-count').setAttribute('aria-label', wl + ' with openings');
    var pend = state.requests.filter(function (t) { return t.status === 'pending'; }).length;
    $('#to-count').hidden = !pend; $('#to-count').textContent = pend;
    $('#to-count').setAttribute('aria-label', pend + ' pending');

    var main = $('#s-main');
    var sched = $('.s-sched');
    var keep = { top: sched ? sched.scrollTop : null, left: sched ? sched.scrollLeft : 0 };
    main.innerHTML = { schedule: viewSchedule, waitlist: viewWaitlist, timeoff: viewTimeOff, team: viewTeam, menu: viewMenu }[state.tab]();
    sched = $('.s-sched');
    if (sched) {
      if (keep.top !== null) { sched.scrollTop = keep.top; sched.scrollLeft = keep.left; }
      else { scrollToNow(sched); }
    }
  }

  function scrollToNow(sched) {
    var hrs = hoursOn(state.date), now = new Date();
    if (!hrs || state.date !== isoDate(now)) { return; }
    var m = now.getHours() * 60 + now.getMinutes();
    sched.scrollTop = Math.max(0, (m - hrs.open - 60) * PX);
  }

  function setTab(tab) {
    state.tab = tab;
    if (tab === 'team' && !state.team) { loadTeam(); }
    if (tab === 'menu' && !state.menu) { loadMenu(); }
    try { history.replaceState(null, '', '#' + tab); } catch (e) { /* file:// in some browsers */ }
    render();
    var h = $('#s-main h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var tab = e.target.closest('.s-tab');
    if (tab) { setTab(tab.getAttribute('data-tab')); return; }
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled) { return; }
    var act = el.getAttribute('data-act'), v = el.getAttribute('data-v');

    if (act === 'day') { state.date = addDays(state.date, +v); load(); }
    else if (act === 'today') { state.date = isoDate(new Date()); load(); }
    else if (act === 'appt') { openAppt(v); }
    else if (act === 'close') { $('#sheet').close(); }
    else if (act === 'status') {
      var id = el.closest('.sheet-actions').getAttribute('data-id');
      if (v === 'cancelled' && !confirm('Cancel this appointment? The time opens up for online booking.')) { return; }
      el.disabled = true;
      API.setBookingStatus(id, v, 'staff').then(function () {
        $('#sheet').close();
        return load();
      });
    }
    else if (act === 'goto-timeoff') { setTab('timeoff'); }
    else if (act === 'wl-remove') {
      if (!confirm('Remove from the waitlist?')) { return; }
      API.removeWaitlist(v).then(load);
    }
    else if (act === 'to-decide') {
      el.disabled = true;
      API.decideTimeOff(el.getAttribute('data-id'), v).then(load);
    }
    else if (act === 'mn-pick') { state.menuCat = el.getAttribute('data-k'); render(); }
    else if (act === 'mn-save') { saveSvc(el.getAttribute('data-k')); }
    else if (act === 'mn-undo') { var mk = 'svc:' + el.getAttribute('data-k'); delete state.drafts[mk]; delete state.teamMsg[mk]; render(); }
    else if (act === 'mn-add') { addSvc(); }
    else if (act === 'mn-del') { deleteSvc(el.getAttribute('data-k')); }
    else if (act === 'mn-move') { moveSvc(el.getAttribute('data-k'), +v); }
    else if (/^mn-cat-/.test(act)) { catAction(act, el.getAttribute('data-k'), +v); }
    else if (act === 'tm-save') { saveTeam(el.getAttribute('data-id')); }
    else if (act === 'tm-undo') { var uid = el.getAttribute('data-id'); delete state.drafts[uid]; delete state.teamMsg[uid]; render(); }
    else if (act === 'tm-add') { addTeam(); }
    else if (act === 'tm-move') { moveTeam(el.getAttribute('data-id'), +v); }
    else if (act === 'auth-retry') { state.auth = 'signin'; render(); }
    else if (act === 'signout') { API.signOut().then(function () { state.staff = null; state.auth = 'signin'; render(); }); }
    else if (act === 'reset') {
      if (!confirm('Delete all bookings, waitlist entries and time off saved in this browser?')) { return; }
      API.resetDemo().then(load);
    }
    else if (act === 'to-view') { state.date = v; state.tab = 'schedule'; setTab('schedule'); load(); }
  });

  // click on the dialog backdrop closes it
  $('#sheet').addEventListener('click', function (e) { if (e.target === this) { this.close(); } });

  document.addEventListener('input', onFormInput);
  document.addEventListener('change', onFormInput);
  function onFormInput(e) {
    var t = e.target;
    var mkey = t.getAttribute && t.getAttribute('data-menu');
    if (mkey) {
      var md = state.drafts[mkey] = Object.assign({}, menuBase(mkey), state.drafts[mkey]);
      md[t.name] = t.type === 'checkbox' ? t.checked : t.value;
      delete state.teamMsg[mkey];
      if (e.type === 'change' && (t.type === 'checkbox' || t.tagName === 'SELECT')) { render(); }
      else {
        var box = t.closest('li, .card');
        var sb = box && box.querySelector('[data-act="mn-save"], [data-act="mn-cat-rename"]');
        if (sb) { sb.disabled = false; }
      }
      return;
    }
    var tid = t.getAttribute && t.getAttribute('data-team');
    if (tid) {
      var base = tid === 'new' ? { name: '', initials: '', blurb: '', active: true } : draftFor(state.team.filter(function (x) { return x.id === tid; })[0]);
      var d = state.drafts[tid] = Object.assign({}, base, state.drafts[tid]);
      d[t.name] = t.type === 'checkbox' ? t.checked : t.value;
      delete state.teamMsg[tid];
      // redraw only on checkbox / blur-style changes so typing isn't interrupted;
      // otherwise just enable this card's Save button
      if (e.type === 'change' && t.type === 'checkbox') { render(); }
      else { var card = t.closest('li, .card'); var btn = card && card.querySelector('[data-act="tm-save"]'); if (btn) { btn.disabled = false; } }
      return;
    }
    if (!t.form || t.form.id !== 'to-form' || !t.name) { return; }
    if (t.name === 'allDay') {
      state.form.allDay = t.checked;
      if (e.type === 'change') { render(); var cb = document.querySelector('#to-form [name="allDay"]'); if (cb) { cb.focus(); } }
    } else { state.form[t.name] = t.value; }
  }

  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'signin') { return; }
    e.preventDefault();
    var email = e.target.email.value.trim();
    state.signInEmail = email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { state.signInError = 'Please enter your email.'; render(); return; }
    state.signInError = '';
    e.target.querySelector('button[type=submit]').disabled = true;
    API.signIn(email).then(function () { state.auth = 'sent'; render(); }, function (err) {
      state.signInError = /rate|seconds/i.test(err.message) ? 'Too many tries. Wait a minute and try again.' : 'Couldn’t send the link. Try again.';
      render();
    });
  });

  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'to-form') { return; }
    e.preventDefault();
    var f = state.form;
    state.formError = '';
    if (!f.date || f.date < isoDate(new Date())) { state.formError = 'Pick a date from today on.'; }
    else if (!f.allDay && (!f.start || !f.end || f.end <= f.start)) { state.formError = 'The end time must be after the start time.'; }
    if (state.formError) { render(); return; }
    API.requestTimeOff(f).then(function () {
      state.form.reason = '';
      return load();
    });
  });

  // keep the "now" line and waitlist openings fresh, and pick up bookings made in another tab
  setInterval(function () { if (state.auth === 'ok' && !$('#sheet').open && document.activeElement.tagName !== 'INPUT') { load(); } }, 60 * 1000);
  window.addEventListener('storage', function () { if (state.auth === 'ok' && !$('#sheet').open) { load(); } });

  function tabFromHash() {
    var t = (location.hash || '').slice(1);
    return ['schedule', 'waitlist', 'timeoff', 'team', 'menu'].indexOf(t) >= 0 ? t : null;
  }
  window.addEventListener('hashchange', function () { var t = tabFromHash(); if (t && t !== state.tab && state.auth === 'ok') { setTab(t); load(); } });

  state.tab = tabFromHash() || 'schedule';
  render();
  checkAuth();
});
