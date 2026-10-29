/*
 * Simulated marketing environments — shared behaviour.
 * Reads the campaign configuration from the query string, renders the creative, and builds the
 * click-through URL: the configured destination (which may or may not carry UTMs — that is the
 * marketer's configuration under test) plus a synthetic platform click id.
 */
(function () {
  var params = new URL(location.href).searchParams;
  function get(name, fallback) {
    var v = params.get(name);
    return v === null || v === '' ? fallback : v;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var dest = get('dest', '../store/index.html');
  var clickParam = get('click_param', '');
  var clickId = get('click_id', '');
  var href = dest;
  try {
    var u = new URL(dest, location.href);
    if (clickParam && clickId) u.searchParams.set(clickParam, clickId);
    href = u.toString();
  } catch (e) {}
  var destDomain = 'aurorasupply.example';
  try {
    destDomain = new URL(dest, location.href).host || destDomain;
  } catch (e) {}

  window.SIM = {
    campaignId: get('campaign_id', 'campaign'),
    campaignName: get('campaign_name', get('campaign_id', 'Campaign')),
    creativeId: get('creative_id', ''),
    headline: get('headline', 'Trail Runner Jacket — Free Returns'),
    body: get('body', 'Windproof, packable, built for ridge lines. Spring collection now live.'),
    subject: get('subject', 'Your trail season starts here'),
    customer: get('customer', 'there'),
    channel: get('channel', 'sms'),
    href: href,
    destDomain: destDomain,
    esc: esc,
    fill: function (map) {
      Object.keys(map).forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) {
          var v = map[sel];
          if (sel.indexOf('[href]') !== -1 || el.tagName === 'A') el.setAttribute('href', v);
          else el.textContent = v;
        });
      });
    },
  };
})();
