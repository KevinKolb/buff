// "Celebrating something?" — the optional occasion picker shared by the client
// booking page and the staff booking page. The list lives in config.js.

(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var OTHER = 'Something else';

  /**
   * value: the chosen occasion ('' = none). Anything not in the list counts as
   * "Something else" with that text. heading: the question to show.
   */
  function picker(value, heading) {
    var list = (window.BUFF_CONFIG.occasions || []).concat([OTHER]);
    var known = list.indexOf(value) >= 0;
    var current = !value ? '' : known ? value : OTHER;
    var chips = list.map(function (o) {
      var on = o === current;
      return '<button type="button" class="chip occ-chip' + (on ? ' is-on' : '') + '" data-occ="' + esc(o) + '" aria-pressed="' + on + '">' + esc(o) + '</button>';
    }).join('');
    return '<div class="occ" role="group" aria-labelledby="occ-q"><div id="occ-q" class="b sm">' + esc(heading || 'Celebrating something?') +
        ' <span class="muted xs">Optional</span></div>' +
      '<div class="chips occ-chips">' + chips + '</div>' +
      (current === OTHER
        ? '<div class="field"><label for="occ-other">What’s the occasion?</label><input id="occ-other" type="text" maxlength="60" autocomplete="off" placeholder="Tell us a little" value="' + esc(known ? '' : value.trim()) + '"></div>'
        : '') +
    '</div>';
  }

  /** Given a chip tap, the new value: tapping the selected chip clears it. */
  function toggle(current, tapped) {
    var list = window.BUFF_CONFIG.occasions || [];
    var currentChip = !current ? '' : list.indexOf(current) >= 0 ? current : OTHER;
    if (tapped === currentChip) { return ''; }
    return tapped === OTHER ? ' ' : tapped; // a space marks "something else, not typed yet"
  }

  window.BuffOccasion = { picker: picker, toggle: toggle, OTHER: OTHER };
})();
