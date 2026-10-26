// Buff Beauty Bar — privacy policy and terms pages.
// The text is in the page; this fills in the business details from the
// Business tab (name, address, phone, cancellation window and policy link).

window.BuffAPI.ready.then(function () {
  var b = window.BUFF_CONFIG.business;
  function each(key, fn) { document.querySelectorAll('[data-biz="' + key + '"]').forEach(fn); }
  each('name', function (el) { el.textContent = b.name; });
  each('address', function (el) { el.textContent = b.address; });
  each('phone', function (el) { el.textContent = b.phone; });
  each('phone-link', function (el) { el.href = b.phoneHref; });
  each('window', function (el) { el.textContent = b.cancellationWindowHours; });
  each('policy-link', function (el) { if (b.cancellationPolicyUrl) { el.href = b.cancellationPolicyUrl; } });
  var call = document.getElementById('call');
  call.href = b.phoneHref;
  call.setAttribute('aria-label', 'Call ' + b.name + ' at ' + b.phone);
  document.querySelector('.call-num').textContent = b.phone;
});
