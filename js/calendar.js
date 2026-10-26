// "Add to calendar", directions and share for a booked visit.
// Times are pinned to the business's time zone (New Orleans), so they're right
// even when the client's phone is set to another zone.

(function () {
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // Minutes the time zone is ahead of UTC at a given instant.
  function tzOffset(date, tz) {
    var p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - date.getTime()) / 60000;
  }
  // 'YYYY-MM-DD' + minutes after midnight in tz → Date (UTC instant)
  function zoned(dateISO, minutes, tz) {
    var d = dateISO.split('-'), guess = Date.UTC(+d[0], +d[1] - 1, +d[2], 0, minutes);
    var off = tzOffset(new Date(guess), tz), t = guess - off * 60000;
    var off2 = tzOffset(new Date(t), tz);
    return new Date(off2 === off ? t : guess - off2 * 60000); // daylight-saving edge
  }
  function utcStamp(dt) { // 20261027T143000Z
    return dt.getUTCFullYear() + pad(dt.getUTCMonth() + 1) + pad(dt.getUTCDate()) + 'T' + pad(dt.getUTCHours()) + pad(dt.getUTCMinutes()) + '00Z';
  }
  function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }

  /**
   * ev: { id, date: 'YYYY-MM-DD', start: minutes, mins, services: [...], provider: name, guests }
   * Returns everything the menu needs.
   */
  function event(ev) {
    var CFG = window.BUFF_CONFIG, b = CFG.business, tz = b.timezone || 'America/Chicago';
    var start = zoned(ev.date, ev.start, tz), end = new Date(start.getTime() + ev.mins * 60000);
    var title = b.name + ': ' + ev.services.join(' + ');
    var manage = location.origin + location.pathname.replace(/[^/]*$/, '') + 'manage.html?ref=' + encodeURIComponent(ev.id);
    var details = ev.services.join(' + ') + (ev.provider ? ' with ' + ev.provider : '') + (ev.guests > 1 ? ' (' + ev.guests + ' guests)' : '') + '.\n' +
      'Reference ' + ev.id + '.\n' +
      'Need to cancel? ' + manage + ' or call ' + b.phone + '.\n' +
      'Cancellations within ' + b.cancellationWindowHours + ' hours or no-shows may be charged.';
    var q = encodeURIComponent;
    var isoStart = start.toISOString(), isoEnd = end.toISOString();
    return {
      title: title, details: details, location: b.address, start: start, end: end,
      google: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + q(title) +
        '&dates=' + utcStamp(start) + '/' + utcStamp(end) + '&details=' + q(details) + '&location=' + q(b.address) + '&ctz=' + q(tz),
      outlook: 'https://outlook.live.com/calendar/0/action/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject=' + q(title) +
        '&startdt=' + q(isoStart) + '&enddt=' + q(isoEnd) + '&body=' + q(details) + '&location=' + q(b.address),
      office: 'https://outlook.office.com/calendar/0/action/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject=' + q(title) +
        '&startdt=' + q(isoStart) + '&enddt=' + q(isoEnd) + '&body=' + q(details) + '&location=' + q(b.address),
      yahoo: 'https://calendar.yahoo.com/?v=60&title=' + q(title) + '&st=' + utcStamp(start) + '&et=' + utcStamp(end) +
        '&desc=' + q(details) + '&in_loc=' + q(b.address),
      googleMaps: 'https://www.google.com/maps/dir/?api=1&destination=' + q(b.name + ', ' + b.address),
      appleMaps: 'https://maps.apple.com/?daddr=' + q(b.address) + '&q=' + q(b.name),
      ics: [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Buff Beauty Bar//Booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        'UID:' + ev.id + '@buffbeautybar.com',
        'DTSTAMP:' + utcStamp(new Date()),
        'DTSTART:' + utcStamp(start), 'DTEND:' + utcStamp(end),
        'SUMMARY:' + icsEscape(title), 'DESCRIPTION:' + icsEscape(details), 'LOCATION:' + icsEscape(b.address),
        'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(title), 'END:VALARM',
        'END:VEVENT', 'END:VCALENDAR',
      ].join('\r\n'),
    };
  }

  function shareText(e) {
    var when = e.start.toLocaleString('en-US', { timeZone: window.BUFF_CONFIG.business.timezone || 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return e.title + '\n' + when + '\n' + e.location + '\n\n' + e.details;
  }

  /** The menu: <details> so it works without extra state; links open in a new tab. */
  function menu(ev, opts) {
    var e = event(ev), id = 'cal-' + ev.id.replace(/[^A-Za-z0-9]/g, '');
    var a = function (href, label, sub) { return '<a class="cal-opt" href="' + href + '" target="_blank" rel="noopener">' + label + (sub ? '<span class="muted xs">' + sub + '</span>' : '') + '</a>'; };
    var b = function (act, label, sub) { return '<button type="button" class="cal-opt" data-cal="' + act + '" data-cal-id="' + ev.id + '">' + label + (sub ? '<span class="muted xs">' + sub + '</span>' : '') + '</button>'; };
    menu.events[ev.id] = e;
    return '<div class="cal-wrap' + (opts && opts.compact ? ' is-compact' : '') + '">' +
      '<details class="cal-menu" id="' + id + '"><summary class="btn-outline cal-btn">Add to calendar</summary><div class="cal-list">' +
        a(e.google, 'Google Calendar') +
        b('ics', 'Apple Calendar', 'iPhone, iPad and Mac') +
        a(e.outlook, 'Outlook.com', 'Hotmail, Live, Outlook.com') +
        a(e.office, 'Outlook (work or school)', 'Microsoft 365') +
        a(e.yahoo, 'Yahoo Calendar') +
        b('ics', 'Other calendar app', 'Downloads a calendar file') +
      '</div></details>' +
      '<details class="cal-menu"><summary class="btn-outline cal-btn">Directions and sharing</summary><div class="cal-list">' +
        a(e.googleMaps, 'Directions in Google Maps') +
        a(e.appleMaps, 'Directions in Apple Maps') +
        b('share', navigator.share ? 'Share or text the details' : 'Copy the details', 'Time, place and reference') +
      '</div></details></div>';
  }
  menu.events = {};

  function downloadIcs(e, id) {
    var url = URL.createObjectURL(new Blob([e.ics], { type: 'text/calendar;charset=utf-8' }));
    var link = document.createElement('a');
    link.href = url; link.download = 'buff-' + id + '.ics';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-cal]');
    if (!el) { return; }
    var id = el.getAttribute('data-cal-id'), e = menu.events[id];
    if (!e) { return; }
    if (el.getAttribute('data-cal') === 'ics') { downloadIcs(e, id); return; }
    var text = shareText(e);
    if (navigator.share) {
      navigator.share({ title: e.title, text: text }).catch(function () { /* closed the share sheet */ });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () {
        var old = el.firstChild.textContent; el.firstChild.textContent = 'Copied';
        setTimeout(function () { el.firstChild.textContent = old; }, 2000);
      });
    }
  });

  // only one menu open at a time
  document.addEventListener('toggle', function (ev) {
    var d = ev.target;
    if (d.classList && d.classList.contains('cal-menu') && d.open) {
      document.querySelectorAll('.cal-menu[open]').forEach(function (o) { if (o !== d) { o.open = false; } });
    }
  }, true);

  window.BuffCal = { menu: menu, event: event };
})();
