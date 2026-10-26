// Buff Beauty Bar — services and prices (services.html).
// A plain list by category. The + takes the client into booking with that
// service already picked, on the "Who would you like?" step.

window.BuffAPI.ready.then(function () {
  var CFG = window.BUFF_CONFIG;
  var API = window.BuffAPI;

  function $(sel) { return document.querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return '$' + n.toLocaleString('en-US'); }
  function bookable(s) { return CFG.providers.some(function (p) { return API.canDo(p.id, [s.name]); }); }

  var cats = [];
  CFG.services.forEach(function (s) { if (cats.indexOf(s.cat) < 0) { cats.push(s.cat); } });
  var order = CFG.categoryOrder || [];
  cats.sort(function (a, b) {
    var ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
  });

  var plus = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  var sections = cats.map(function (c) {
    var rows = CFG.services.filter(function (s) { return s.cat === c; }).map(function (s) {
      var action = bookable(s)
        ? '<a class="tick sv-add" href="index.html?service=' + encodeURIComponent(s.name) + '" aria-label="Book ' + esc(s.name) + '">' + plus + '</a>'
        : '<a class="sv-call" href="' + CFG.business.phoneHref + '">Call to book</a>';
      return '<li class="sv-row"><span class="svc-main"><span class="svc-name">' + esc(s.name) + '</span><span class="muted sm">' + s.mins + ' min</span></span>' +
        '<span class="svc-price">' + money(s.price) + (s.priceNote || '') + '</span>' + action + '</li>';
    }).join('');
    return '<section class="sv-cat"><h2 class="label">' + esc(c) + '</h2><ul class="card list">' + rows + '</ul></section>';
  }).join('');

  $('#main').innerHTML = '<h1 class="h1">Services</h1>' +
    '<p class="muted sm">Tap <span class="sv-inline-plus" aria-hidden="true">+</span> to book. Prices marked + are starting prices.</p>' +
    sections +
    '<a class="btn-primary as-link" href="index.html">Book online</a>' +
    '<a class="staff-link" href="staff.html">Staff</a>';

  $('#call').href = CFG.business.phoneHref;
  $('#call').setAttribute('aria-label', 'Call ' + CFG.business.name + ' at ' + CFG.business.phone);
  $('.call-num').textContent = CFG.business.phone;
});
