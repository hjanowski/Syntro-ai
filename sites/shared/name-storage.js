/*
 * SyntroStorage — tiny storage shim used by the demo store, the mock production tag and the SDK.
 *
 * Uses localStorage when available. Inside the browser-hosted engine the demo pages run in
 * sandboxed iframes. With an opaque origin (preferred) web storage and cookies are unavailable, so
 * state falls back to window.name, which persists across same-frame navigations and is isolated
 * per iframe — i.e. per synthetic customer. When the host browser cannot load subresources into
 * opaque frames (local-network access policies), the engine falls back to same-origin frames and
 * marks each frame with {"__syntro_frame":"shared"} in window.name; this shim then refuses the
 * shared localStorage/cookies and keeps every frame's state in its own window.name.
 */
(function () {
  function hasLocalStorage() {
    try {
      var k = '__syntro_probe';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }
  function readName() {
    try {
      return window.name && window.name.charAt(0) === '{' ? JSON.parse(window.name) : {};
    } catch (e) {
      return {};
    }
  }
  function writeName(obj) {
    window.name = JSON.stringify(obj);
  }
  var sharedFrame = readName().__syntro_frame === 'shared';
  var useLocal = hasLocalStorage() && !sharedFrame;
  window.SyntroStorage = {
    mode: useLocal ? 'localStorage' : 'window.name',
    isolatedFrame: sharedFrame,
    get: function (key) {
      if (useLocal) return window.localStorage.getItem(key);
      var o = readName();
      return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : null;
    },
    set: function (key, value) {
      if (useLocal) {
        window.localStorage.setItem(key, value);
        return;
      }
      var o = readName();
      o[key] = value;
      writeName(o);
    },
    remove: function (key) {
      if (useLocal) {
        window.localStorage.removeItem(key);
        return;
      }
      var o = readName();
      delete o[key];
      writeName(o);
    },
    clear: function () {
      if (useLocal) {
        try {
          window.localStorage.clear();
        } catch (e) {}
      }
      window.name = sharedFrame ? JSON.stringify({ __syntro_frame: 'shared' }) : '';
    },
  };
})();
