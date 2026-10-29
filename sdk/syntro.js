/*!
 * Syntro Website SDK v0.1.0
 *
 * Identifies synthetic sessions through a cryptographically signed, short-lived token minted by
 * the Syntro engine, binds every website interaction to that session, and routes events to the
 * isolated Syntro test data collector. For ordinary visitors (no token) the SDK is inert: it never
 * sends anything and exposes `syntro.isSynthetic() === false` so production tags can run normally.
 *
 * Install:
 *   <script src="https://<your-host>/sdk/syntro.js" data-syntro-collector="auto"></script>
 *
 *   data-syntro-collector  "auto" (default) — use the collector endpoint carried by the token
 *                          an absolute URL  — always post to this endpoint
 *   data-syntro-debug      "true" to log to the console
 *
 * The SDK does not block third-party tags by itself. Use `syntro.isSynthetic()` (or the
 * `syntro_synthetic` dataLayer variable it pushes) as a blocking condition in your tag manager.
 */
(function (global) {
  'use strict';
  var VERSION = '0.1.0';
  var TOKEN_KEY = '__syntro_token';
  var AID_KEY = '__syntro_aid';
  var USER_KEY = '__syntro_user';
  var SENT_KEY = '__syntro_sent_orders';
  var COOKIE_NAME = '_syntro_aid';
  var CLICK_ID_PARAMS = ['fbclid', 'gclid', 'li_fat_id', 'msclkid', 'ttclid'];

  var script = document.currentScript;
  var cfg = {
    collector: (script && script.getAttribute('data-syntro-collector')) || 'auto',
    debug: !!(script && script.getAttribute('data-syntro-debug') === 'true'),
  };

  // ---- storage (cookies when possible, SyntroStorage / window.name otherwise) ----
  var memory = {};
  var storage = global.SyntroStorage || {
    get: function (k) {
      try {
        return global.localStorage.getItem(k);
      } catch (e) {
        return memory[k] === undefined ? null : memory[k];
      }
    },
    set: function (k, v) {
      try {
        global.localStorage.setItem(k, v);
      } catch (e) {
        memory[k] = v;
      }
    },
    remove: function (k) {
      try {
        global.localStorage.removeItem(k);
      } catch (e) {
        delete memory[k];
      }
    },
  };

  // Cookies are shared by every frame of an origin; when the harness isolates frames by window.name
  // (SyntroStorage.mode === 'window.name'), cookies must not be used for identity.
  var cookiesAllowed = !(global.SyntroStorage && global.SyntroStorage.mode === 'window.name');
  function readCookie(name) {
    if (!cookiesAllowed) return null;
    try {
      var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) {
      return null;
    }
  }
  function writeCookie(name, value, days) {
    if (!cookiesAllowed) return;
    try {
      var exp = new Date(Date.now() + days * 864e5).toUTCString();
      document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + exp + '; path=/; SameSite=Lax';
    } catch (e) {}
  }

  function log() {
    if (cfg.debug && global.console) console.log.apply(console, ['[syntro]'].concat([].slice.call(arguments)));
  }

  function randomId(prefix) {
    var chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    var out = '';
    var bytes = new Uint8Array(12);
    (global.crypto || global.msCrypto).getRandomValues(bytes);
    for (var i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length];
    return prefix + '_' + out;
  }

  function decodeToken(token) {
    try {
      var body = token.slice(0, token.lastIndexOf('.'));
      var b64 = body.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return JSON.parse(decodeURIComponent(escape(atob(b64))));
    } catch (e) {
      return null;
    }
  }

  // ---- token acquisition ----
  var url = new URL(global.location.href);
  var urlToken = url.searchParams.get('syntro_token');
  var token = urlToken || storage.get(TOKEN_KEY);
  if (urlToken) {
    storage.set(TOKEN_KEY, urlToken);
    try {
      url.searchParams.delete('syntro_token');
      global.history.replaceState(null, '', url.toString());
    } catch (e) {}
  }
  var payload = token ? decodeToken(token) : null;
  var synthetic = !!(payload && payload.v === 1 && payload.exp > Date.now() && payload.sid);
  if (!synthetic && token) {
    storage.remove(TOKEN_KEY);
    token = null;
    payload = null;
  }
  var offset = synthetic && typeof payload.off === 'number' ? payload.off : 0;
  var flags = (synthetic && payload.sdk) || {};
  var collector = cfg.collector !== 'auto' ? cfg.collector : synthetic ? payload.col : null;
  var transport = collector === 'postmessage' ? 'postmessage' : collector ? 'http' : 'none';

  // ---- identity ----
  function getAnonymousId() {
    var id = readCookie(COOKIE_NAME) || storage.get(AID_KEY);
    if (!id) id = randomId('anon');
    writeCookie(COOKIE_NAME, id, 365);
    storage.set(AID_KEY, id);
    return id;
  }
  var anonymousId = getAnonymousId();
  var userEmail = storage.get(USER_KEY) || null;

  function now() {
    return new Date(Date.now() + offset).toISOString();
  }

  function pickParams(prefixOrList) {
    var out = {};
    var current = new URL(global.location.href);
    current.searchParams.forEach(function (value, key) {
      if (typeof prefixOrList === 'string' ? key.indexOf(prefixOrList) === 0 : prefixOrList.indexOf(key) !== -1) out[key] = value;
    });
    return out;
  }

  var pageUtm = pickParams('utm_');
  var pageClickIds = pickParams(CLICK_ID_PARAMS);

  function envelope(type, props) {
    return {
      event_id: randomId('ev'),
      type: type,
      ts: now(),
      url: global.location.href,
      path: global.location.pathname,
      referrer: document.referrer || '',
      title: document.title,
      anonymous_id: anonymousId,
      user: userEmail ? { email: userEmail } : undefined,
      utm: pageUtm,
      click_ids: pageClickIds,
      props: props || {},
      device: {
        user_agent: payload && payload.dev ? payload.dev.ua : navigator.userAgent,
        viewport: payload && payload.dev ? payload.dev.vw + 'x' + payload.dev.vh : global.innerWidth + 'x' + global.innerHeight,
      },
      sdk_version: VERSION,
    };
  }

  var sent = [];
  function deliver(events) {
    if (!synthetic || transport === 'none') return Promise.resolve({ skipped: true });
    sent = sent.concat(events);
    if (transport === 'postmessage') {
      try {
        global.parent.postMessage({ __syntroCollect: true, token: token, events: events }, '*');
        return Promise.resolve({ accepted: events.length });
      } catch (e) {
        log('postMessage failed', e);
        return Promise.resolve({ error: String(e) });
      }
    }
    return fetch(collector, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token, events: events }),
      keepalive: true,
    })
      .then(function (r) {
        return r.json().catch(function () {
          return { status: r.status };
        });
      })
      .catch(function (e) {
        log('collector unreachable', e);
        return { error: String(e) };
      });
  }

  function track(type, props) {
    if (!synthetic) return Promise.resolve({ skipped: true });
    props = props || {};
    if (type === 'purchase' && props.order_id && flags.dedupe !== false) {
      var sentOrders = [];
      try {
        sentOrders = JSON.parse(storage.get(SENT_KEY) || '[]');
      } catch (e) {}
      if (sentOrders.indexOf(props.order_id) !== -1) {
        log('purchase for', props.order_id, 'already sent — deduplicated');
        return Promise.resolve({ deduplicated: true });
      }
      sentOrders.push(props.order_id);
      storage.set(SENT_KEY, JSON.stringify(sentOrders));
    }
    var ev = envelope(type, props);
    log('track', type, ev);
    return deliver([ev]);
  }

  function identify(user) {
    if (!synthetic) return Promise.resolve({ skipped: true });
    if (flags.identify === false) {
      log('identify suppressed by harness flag');
      return Promise.resolve({ suppressed: true });
    }
    var email = user && user.email ? String(user.email).trim().toLowerCase() : null;
    if (!email) return Promise.resolve({ skipped: true });
    userEmail = email;
    storage.set(USER_KEY, email);
    return deliver([envelope('identify', { method: user.method || 'form' })]);
  }

  function preflight() {
    var prod = global.__prodAnalytics;
    return Promise.resolve({
      sdk_version: VERSION,
      synthetic: synthetic,
      token_present: !!token,
      token_expired: !!(token && payload && payload.exp <= Date.now()),
      transport: transport,
      collector: collector,
      anonymous_id: anonymousId,
      storage_mode: global.SyntroStorage ? global.SyntroStorage.mode : 'localStorage',
      production_analytics_blocked: prod ? !!prod.blocked : null,
      production_analytics_events: prod ? prod.count : null,
      data_layer_flag: Array.isArray(global.dataLayer) && global.dataLayer.some(function (e) { return e && e.syntro_synthetic === true; }),
      events_sent: sent.length,
    });
  }

  var api = {
    version: VERSION,
    isSynthetic: function () {
      return synthetic;
    },
    sessionId: synthetic ? payload.sid : null,
    anonymousId: anonymousId,
    harnessFlags: flags,
    transport: transport,
    page: function (props) {
      return track('page_view', props);
    },
    track: track,
    identify: identify,
    preflight: preflight,
    reset: function () {
      storage.remove(AID_KEY);
      storage.remove(USER_KEY);
      try {
        document.cookie = COOKIE_NAME + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
      } catch (e) {}
      anonymousId = getAnonymousId();
      userEmail = null;
    },
    _sent: function () {
      return sent.slice();
    },
  };
  global.syntro = api;

  // GTM / tag-manager hook: a data layer flag production tags can use as a blocking condition.
  global.dataLayer = global.dataLayer || [];
  global.dataLayer.push({ event: 'syntro_session_evaluated', syntro_synthetic: synthetic });

  if (synthetic) {
    log('synthetic session', payload.sid, 'transport', transport);
    track('page_view');
  }
})(window);
