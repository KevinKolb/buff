// Prices with specials, for showing on the pages. Mirrors the database's
// _visit_price (which decides the price actually booked):
//   1. each service gets the single best time-based special that applies
//      (percent off, dollars off, or a set price);
//   2. then the best multi-service discount is taken off the visit.
// CFG.specials: [{ id, name, description, kind: 'time'|'quantity', services: [names] (empty = all),
//   discountType: 'percent'|'amount'|'price', discountValue, days: [0-6], startTime, endTime ('HH:MM'),
//   startDate, endDate ('YYYY-MM-DD'), minServices, active }]

(function () {
  var DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

  function cfg() { return window.BUFF_CONFIG; }
  function toMin(hhmm) { var p = String(hhmm).split(':'); return +p[0] * 60 + +p[1]; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function svc(name) { return cfg().services.filter(function (s) { return s.name === name; })[0]; }
  /** A provider's own price for a service (Team tab), or the menu price. */
  function priceFor(name, providerId) {
    var own = providerId && (cfg().providerPrices || {})[providerId];
    if (own && own[name] != null) { return own[name]; }
    var s = svc(name); return s ? s.price : 0;
  }
  function inScope(sp, name) { return !sp.services || !sp.services.length || sp.services.indexOf(name) >= 0; }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  /** Does this special apply on dateISO at start (minutes)? Unknown date/time only matches specials that don't need them. */
  function on(sp, dateISO, start) {
    if (!sp.active) { return false; }
    var needsDate = sp.startDate || sp.endDate || (sp.days && sp.days.length), needsTime = sp.startTime || sp.endTime;
    if (needsDate && !dateISO) { return false; }
    if (needsTime && start == null) { return false; }
    if (sp.startDate && dateISO < sp.startDate) { return false; }
    if (sp.endDate && dateISO > sp.endDate) { return false; }
    if (sp.days && sp.days.length && sp.days.indexOf(new Date(dateISO + 'T00:00:00').getDay()) < 0) { return false; }
    if (sp.startTime && start < toMin(sp.startTime)) { return false; }
    if (sp.endTime && start >= toMin(sp.endTime)) { return false; }
    return true;
  }

  function cut(sp, price) {
    if (sp.discountType === 'percent') { return price * (1 - sp.discountValue / 100); }
    if (sp.discountType === 'amount') { return Math.max(price - sp.discountValue, 0); }
    return sp.discountValue;
  }

  /** One guest's visit (with providerId's own prices, if given): { subtotal (before specials), total, note, lines: [{ name, regular, price, special }] } */
  function visit(names, dateISO, start, providerId) {
    var specials = cfg().specials || [], used = [], lines = [], subtotal = 0, total = 0;
    names.forEach(function (n) {
      var s = svc(n); if (!s) { return; }
      var base = priceFor(n, providerId), best = base, bestSp = null;
      specials.forEach(function (sp) {
        if (sp.kind !== 'time' || !on(sp, dateISO, start) || !inScope(sp, n)) { return; }
        var c = cut(sp, base);
        if (c < best) { best = c; bestSp = sp; }
      });
      best = round2(best);
      subtotal += base; total += best;
      lines.push({ name: n, regular: base, price: best, special: bestSp ? bestSp.name : '' });
      if (bestSp && used.indexOf(bestSp.name) < 0) { used.push(bestSp.name); }
    });
    var bestDisc = 0, discSp = null;
    specials.forEach(function (sp) {
      if (sp.kind !== 'quantity' || !on(sp, dateISO, start)) { return; }
      var scoped = lines.filter(function (l) { return inScope(sp, l.name); });
      if (scoped.length < sp.minServices) { return; }
      var sum = scoped.reduce(function (m, l) { return m + l.price; }, 0);
      var d = sp.discountType === 'percent' ? sum * sp.discountValue / 100 : Math.min(sp.discountValue, sum);
      if (d > bestDisc) { bestDisc = d; discSp = sp; }
    });
    total = Math.max(round2(total - bestDisc), 0);
    if (discSp) { used.push(discSp.name); }
    return { subtotal: round2(subtotal), total: total, note: used.join(', '), quantity: discSp ? { name: discSp.name, amount: round2(bestDisc) } : null, lines: lines };
  }

  /** Several guests, one provider id (or null = not known yet) each: totals added up; lines are the first guest's. */
  function group(names, dateISO, start, providerIds) {
    var vs = (providerIds && providerIds.length ? providerIds : [null]).map(function (pid) { return visit(names, dateISO, start, pid); });
    var out = Object.assign({}, vs[0]);
    out.subtotal = round2(vs.reduce(function (m, v) { return m + v.subtotal; }, 0));
    out.total = round2(vs.reduce(function (m, v) { return m + v.total; }, 0));
    out.perGuest = vs[0].total;
    return out;
  }

  /** Specials that are on now or coming up (not ended). */
  function current() {
    var t = todayISO();
    return (cfg().specials || []).filter(function (sp) { return sp.active && (!sp.endDate || sp.endDate >= t); });
  }

  /** Is there a current day/time special that can lower this service's price? (Multi-service deals show on the Specials page.) */
  function hasSpecial(name) {
    return current().some(function (sp) { return sp.kind === 'time' && inScope(sp, name); });
  }

  function money(n) { return '$' + (Math.round(n * 100) % 100 ? n.toFixed(2) : String(Math.round(n))); }
  function clock(hhmm) {
    var m = toMin(hhmm), h = Math.floor(m / 60), mm = m % 60;
    return (h % 12 || 12) + (mm ? ':' + ('0' + mm).slice(-2) : '') + (h < 12 ? ' AM' : ' PM');
  }
  function niceDate(iso) { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

  /** Plain-words description: { deal, what, when } */
  function describe(sp) {
    var deal = sp.discountType === 'percent' ? sp.discountValue + '% off'
      : sp.discountType === 'amount' ? money(sp.discountValue) + ' off' : money(sp.discountValue);
    var what = !sp.services || !sp.services.length ? 'all services' : sp.services.length <= 3 ? sp.services.join(', ') : sp.services.length + ' services';
    if (sp.kind === 'quantity') {
      deal = (sp.discountType === 'percent' ? sp.discountValue + '% off' : money(sp.discountValue) + ' off') + ' when you book ' + sp.minServices + ' or more' +
        (sp.services && sp.services.length ? ' of these' : ' services') + ' in one visit';
    } else if (sp.discountType === 'price') {
      deal = what + ' for ' + deal;
    } else {
      deal = deal + ' ' + what;
    }
    var bits = [];
    if (sp.days && sp.days.length && sp.days.length < 7) {
      var d = sp.days.slice().sort(function (a, b) { return a - b; });
      bits.push(d.length === 5 && d.join() === '1,2,3,4,5' ? 'weekdays' : d.length === 2 && d.join() === '0,6' ? 'weekends' : d.map(function (x) { return PLURAL[x]; }).join(', '));
    }
    if (sp.startTime && sp.endTime) { bits.push(clock(sp.startTime) + ' to ' + clock(sp.endTime)); }
    else if (sp.startTime) { bits.push('from ' + clock(sp.startTime)); }
    else if (sp.endTime) { bits.push('before ' + clock(sp.endTime)); }
    if (sp.startDate && sp.endDate) { bits.push(niceDate(sp.startDate) + ' to ' + niceDate(sp.endDate)); }
    else if (sp.endDate) { bits.push('until ' + niceDate(sp.endDate)); }
    else if (sp.startDate) { bits.push('from ' + niceDate(sp.startDate)); }
    return { deal: deal.charAt(0).toUpperCase() + deal.slice(1), what: what, when: bits.length ? bits.join(' · ') : 'Any day, any time' };
  }

  window.BuffPricing = { on: on, visit: visit, group: group, priceFor: priceFor, current: current, hasSpecial: hasSpecial, describe: describe, money: money, DAY: DAY };
})();
