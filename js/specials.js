// Buff Beauty Bar — specials (specials.html).
// Current and upcoming deals in plain words, from the Specials tab on the
// front desk. Prices are worked out the same way when booking.

window.BuffAPI.ready.then(function () {
  var CFG = window.BUFF_CONFIG;
  var P = window.BuffPricing;

  function $(sel) { return document.querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  function card(sp) {
    var d = P.describe(sp);
    var one = sp.kind === 'time' && sp.services && sp.services.length === 1;
    var href = one ? 'index.html?service=' + encodeURIComponent(sp.services[0]) : 'index.html';
    var list = sp.services && sp.services.length > 3
      ? '<details class="sp-list"><summary>See the ' + sp.services.length + ' services</summary><p class="sm">' + esc(sp.services.join(', ')) + '</p></details>' : '';
    return '<li class="card sp-card"><div class="label">' + esc(sp.name) + '</div>' +
      '<div class="sp-deal">' + esc(d.deal) + '</div>' +
      '<div class="sp-when">' + esc(d.when) + '</div>' +
      (sp.description ? '<p class="sm">' + esc(sp.description) + '</p>' : '') + list +
      '<a class="btn-outline as-link sp-book" href="' + href + '">Book' + (one ? ' ' + esc(sp.services[0]) : '') + '</a></li>';
  }

  var t = today();
  var all = P.current();
  var now = all.filter(function (sp) { return !sp.startDate || sp.startDate <= t; });
  var soon = all.filter(function (sp) { return sp.startDate && sp.startDate > t; })
    .sort(function (a, b) { return a.startDate < b.startDate ? -1 : 1; });

  $('#main').innerHTML = '<h1 class="h1">Specials</h1>' +
    (all.length
      ? (now.length ? '<ul class="stack">' + now.map(card).join('') + '</ul>' : '') +
        (soon.length ? '<h2 class="label">Coming up</h2><ul class="stack">' + soon.map(card).join('') + '</ul>' : '') +
        '<p class="muted xs center">Special prices show when you pick a time. If more than one deal fits, you get the best price.</p>'
      : '<div class="card pad"><p class="center">No specials right now. Check back soon.</p></div>') +
    '<a class="btn-primary as-link" href="index.html">Book online</a>' +
    '<nav class="staff-link foot-links" aria-label="More"><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="staff.html">Staff</a></nav>';

  $('#call').href = CFG.business.phoneHref;
  $('#call').setAttribute('aria-label', 'Call ' + CFG.business.name + ' at ' + CFG.business.phone);
  $('.call-num').textContent = CFG.business.phone;
});
