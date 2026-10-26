// Buff Beauty Bar — a gift card (giftcard.html?code=…), to show or print.
// The code in the link is what makes it work, so the page only shows what
// the recipient needs: who it's for, from whom, the message and the value.
// ?print=1 opens the print dialog once it's drawn.

window.BuffAPI.ready.then(function () {
  var CFG = window.BUFF_CONFIG;
  var API = window.BuffAPI;
  var q = new URLSearchParams(location.search);

  function $(sel) { return document.querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { n = +n; return '$' + (Math.round(n * 100) % 100 ? n.toFixed(2) : String(Math.round(n))); }

  function show(html) { $('#main').innerHTML = html + '<a class="staff-link no-print" href="staff.html">Staff</a>'; }

  function card(g) {
    var b = CFG.business, what = g.services.join(' + ') + (g.guests > 1 ? ' for ' + g.guests : '');
    var bookHref = g.services.length === 1 ? 'index.html?service=' + encodeURIComponent(g.services[0]) : 'index.html';
    return '<h1 class="h1 no-print">Gift card</h1>' +
      '<article class="gc">' +
        '<img class="gc-logo" src="assets/buff-logo.png" alt="' + esc(b.name) + '" width="581" height="576">' +
        '<div class="gc-label">A gift for</div><div class="gc-to">' + esc(g.recipientName) + '</div>' +
        (g.message ? '<p class="gc-msg">“' + esc(g.message) + '”</p>' : '') +
        (g.from ? '<div class="gc-from">From ' + esc(g.from) + '</div>' : '') +
        '<div class="gc-value">' + money(g.amount) + '</div>' +
        '<div class="gc-what">' + esc(what) + '</div>' +
        (g.valid ? '' : '<p class="notice">This gift card is no longer valid. Please call us.</p>') +
        (g.valid && g.balance < g.amount ? '<p class="gc-what">' + money(g.balance) + ' left</p>' : '') +
        '<div class="gc-code"><span>Code</span> ' + esc(g.code) + '</div>' +
        '<div class="gc-how">Book online at ' + esc(location.host + location.pathname.replace(/[^/]*$/, '')) + ' or call ' + esc(b.phone) + '. Bring this card or the code.<br>' + esc(b.name) + ' · ' + esc(b.address) + '</div>' +
      '</article>' +
      '<div class="stack no-print gc-actions">' +
        '<a class="btn-primary as-link" href="' + bookHref + '">Book your visit</a>' +
        '<button class="btn-outline" data-act="print">Print</button></div>';
  }

  document.addEventListener('click', function (e) { if (e.target.closest('[data-act="print"]')) { window.print(); } });

  $('#call').href = CFG.business.phoneHref;
  $('#call').setAttribute('aria-label', 'Call ' + CFG.business.name + ' at ' + CFG.business.phone);
  $('.call-num').textContent = CFG.business.phone;

  var code = q.get('code');
  if (!code) { show('<h1 class="h1">Gift card</h1><div class="card pad"><p class="center">Open the link from your gift card email, or call us with your code.</p></div>'); return; }
  show('<p class="muted center pad" role="status">Loading…</p>');
  API.getGiftCard(code).then(function (g) {
    if (!g) { show('<h1 class="h1">Gift card</h1><div class="card pad"><p class="center">We couldn’t find that gift card. Check the link, or call us with your code.</p></div>'); return; }
    show(card(g));
    if (q.get('print')) { setTimeout(function () { window.print(); }, 400); }
  }, function () { show('<h1 class="h1">Gift card</h1><div class="card pad"><p class="center">Couldn’t reach the server. Check your connection and try again.</p></div>'); });
});
