// Posts the Inquiries form to the contact worker and shows the result inline.
document.getElementById('contact-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var form = e.target;
  var status = document.getElementById('contact-status');
  var button = form.querySelector('button');
  var token = form.querySelector('input[name="cf-turnstile-response"]');
  if (!token || !token.value) {
    status.textContent = 'Please complete the verification check first.';
    return;
  }
  button.disabled = true;
  status.textContent = 'Sending...';
  fetch(form.action, { method: 'POST', body: new FormData(form) })
    .then(function (r) { return r.json(); })
    .then(function (r) {
      if (r.ok) { form.reset(); status.textContent = 'Sent. Thank you!'; }
      else { status.textContent = r.error || 'Something went wrong. Please try again.'; }
    })
    .catch(function () { status.textContent = 'Could not reach the server. Please try again.'; })
    .finally(function () {
      button.disabled = false;
      if (window.turnstile) window.turnstile.reset();
    });
});
