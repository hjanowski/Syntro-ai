/*
 * Mock "production analytics" tag for the demo store.
 *
 * Stands in for GA4 / Adobe / a CDP tag. It is guarded the way a GTM blocking trigger would be:
 * if the Syntro SDK says the session is synthetic (and the guard is enabled), the tag does not fire.
 * Syntro's isolation check reads window.__prodAnalytics.count at the end of every journey; any
 * value above zero means synthetic traffic leaked into production reporting.
 */
(function () {
  var S = window.SyntroStorage;
  var KEY = '__prod_analytics_count';
  function readCount() {
    var v = S ? S.get(KEY) : null;
    return v ? Number(v) || 0 : 0;
  }
  var synthetic = !!(window.syntro && window.syntro.isSynthetic());
  var guardEnabled = !(window.syntro && window.syntro.harnessFlags && window.syntro.harnessFlags.guard === false);
  if (synthetic && guardEnabled) {
    window.__prodAnalytics = { count: readCount(), blocked: true, events: [] };
    return;
  }
  var count = readCount() + 1;
  if (S) S.set(KEY, String(count));
  window.__prodAnalytics = { count: count, blocked: false, events: [{ type: 'pageview', url: location.href, ts: new Date().toISOString() }] };
})();
