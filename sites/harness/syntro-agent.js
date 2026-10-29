/*
 * Syntro harness agent (demo pages only — NOT part of the website SDK).
 *
 * When a demo page runs inside the browser-hosted engine it is loaded in a sandboxed iframe
 * with an opaque origin, so the engine cannot touch its DOM directly. This agent plays the role
 * Playwright plays in the Node host: it executes a small set of deterministic DOM operations
 * requested by the parent frame over postMessage and reports when a new document is ready.
 * It only accepts messages from its own parent frame.
 */
(function () {
  if (window.parent === window) return;
  function post(msg) {
    msg.__syntroAgent = true;
    window.parent.postMessage(msg, '*');
  }
  function q(selector) {
    var el = document.querySelector(selector);
    if (!el) throw new Error('No element matches ' + selector);
    return el;
  }
  function visible(el) {
    if (!el) return false;
    var style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
  }
  var ops = {
    click: function (m) {
      var el = q(m.selector);
      if (!visible(el)) throw new Error('Element ' + m.selector + ' is not visible');
      if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    },
    fill: function (m) {
      var el = q(m.selector);
      el.focus();
      el.value = m.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    exists: function (m) {
      return !!document.querySelector(m.selector);
    },
    waitFor: function (m) {
      var timeout = m.timeoutMs || 10000;
      var started = Date.now();
      return new Promise(function (resolve, reject) {
        (function poll() {
          var el = document.querySelector(m.selector);
          if (visible(el)) return resolve(true);
          if (Date.now() - started > timeout) return reject(new Error('Timed out waiting for ' + m.selector));
          setTimeout(poll, 50);
        })();
      });
    },
    url: function () {
      return location.href;
    },
    title: function () {
      return document.title;
    },
    text: function (m) {
      var el = document.querySelector(m.selector);
      return el ? (el.textContent || '').trim() : null;
    },
    readGlobal: function (m) {
      return m.path.split('.').reduce(function (o, k) {
        return o == null ? undefined : o[k];
      }, window);
    },
    clearStorage: function () {
      var shared = false;
      try {
        shared = JSON.parse(window.name || '{}').__syntro_frame === 'shared';
      } catch (e) {}
      if (!shared) {
        // Opaque-origin frame: storage is private to this frame, clear everything that is reachable.
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch (e) {}
        try {
          document.cookie.split(';').forEach(function (c) {
            var name = c.split('=')[0].trim();
            if (name) document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
          });
        } catch (e) {}
      }
      // Shared-origin fallback: the frame's state lives only in window.name; keep the isolation marker.
      window.name = shared ? JSON.stringify({ __syntro_frame: 'shared' }) : '';
      return true;
    },
    reload: function () {
      setTimeout(function () {
        location.reload();
      }, 0);
      return true;
    },
    snapshot: function () {
      return { url: location.href, title: document.title, text: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').trim().slice(0, 600) };
    },
  };
  window.addEventListener('message', function (ev) {
    var msg = ev.data;
    if (!msg || msg.__syntroDrive !== true || ev.source !== window.parent) return;
    var op = ops[msg.op];
    Promise.resolve()
      .then(function () {
        if (!op) throw new Error('Unknown op ' + msg.op);
        return op(msg);
      })
      .then(function (result) {
        post({ kind: 'result', id: msg.id, ok: true, result: result === undefined ? null : result });
      })
      .catch(function (e) {
        post({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
      });
  });
  function ready() {
    post({ kind: 'ready', url: location.href, title: document.title });
  }
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready);
})();
