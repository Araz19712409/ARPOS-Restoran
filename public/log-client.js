// Brauzer xətalarını server loquna göndəririk
(function () {
  function send(message, stack) {
    fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: String(message || 'Naməlum xəta'),
        page: location.pathname,
        stack: stack || ''
      })
    }).catch(function () {});
  }

  window.addEventListener('error', function (event) {
    send(event.message, event.error && event.error.stack);
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    send(
      reason && reason.message ? reason.message : String(reason || 'Promise xətası'),
      reason && reason.stack
    );
  });
})();
