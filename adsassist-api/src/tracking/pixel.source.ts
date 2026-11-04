/**
 * Browser pixel served at GET /pixel.js?key=… with __API_ORIGIN__ and
 * __SITE_KEY__ substituted. Plain ES5, no dependencies.
 *
 * Requests use a text/plain body and the key in the query string so they are
 * CORS "simple requests" (no preflight) from any site.
 */
export const PIXEL_SOURCE = String.raw`/* AdsAssist pixel v1 */
(function () {
  'use strict';
  if (window.adsassist && window.adsassist.__loaded) return;

  var API = '__API_ORIGIN__';
  var KEY = '__SITE_KEY__';
  var DEVICE_COOKIE = '_aa_did';
  var ATTR_KEY = '_aa_attr';
  var ATTR_TTL_DAYS = 90;
  var CONSENT_COOKIE = '_aa_consent';
  // Set by the server from the site key; when on, no PII leaves the browser before consent.
  var REQUIRE_CONSENT = '__REQUIRE_CONSENT__' === 'true';

  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function setCookie(name, value, days) {
    var exp = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + exp + '; path=/; SameSite=Lax';
  }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  function deviceKey() {
    var d = getCookie(DEVICE_COOKIE);
    if (!d) { d = 'dv_' + uid(); }
    setCookie(DEVICE_COOKIE, d, 400);
    return d;
  }

  // Ad click ids and UTMs only appear on the landing URL. Persist the latest
  // set so later pages (form step 2, thank-you page) are still attributed.
  function readStoredAttr() {
    try {
      var raw = localStorage.getItem(ATTR_KEY) || getCookie(ATTR_KEY);
      if (!raw) return {};
      var a = JSON.parse(raw);
      if (a._t && Date.now() - a._t > ATTR_TTL_DAYS * 864e5) return {};
      return a;
    } catch (e) { return {}; }
  }
  function attribution() {
    var p = new URLSearchParams(location.search);
    var fresh = {};
    var keys = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'];
    var hit = false;
    for (var i = 0; i < keys.length; i++) {
      var v = p.get(keys[i]);
      if (v) { fresh[keys[i]] = v.slice(0, 300); hit = true; }
    }
    if (hit) {
      fresh.landing_page = location.href.slice(0, 1000);
      fresh._t = Date.now();
      var s = JSON.stringify(fresh);
      try { localStorage.setItem(ATTR_KEY, s); } catch (e) {}
      setCookie(ATTR_KEY, s, ATTR_TTL_DAYS);
      return fresh;
    }
    return readStoredAttr();
  }

  var attr = attribution();

  function consentState() {
    var c = getCookie(CONSENT_COOKIE);
    return c === '1' ? true : c === '0' ? false : null;
  }

  function send(payload, beacon) {
    var a = attr;
    var body = {
      device_key: deviceKey(),
      page_url: location.href,
      referrer: document.referrer || '',
      fbp: getCookie('_fbp'),
      gclid: a.gclid || a.gbraid || a.wbraid || null,
      fbclid: a.fbclid || null,
      landing_page: a.landing_page || null,
      utm_source: a.utm_source || null,
      utm_medium: a.utm_medium || null,
      utm_campaign: a.utm_campaign || null,
      utm_content: a.utm_content || null,
      utm_term: a.utm_term || null,
      utm_id: a.utm_id || null
    };
    for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) body[k] = payload[k];
    body.consent = consentState();
    if (REQUIRE_CONSENT && body.consent !== true) {
      delete body.email; delete body.phone; delete body.name; delete body.field_value; delete body.fields;
    }
    var url = API + '/api/v1/events?key=' + encodeURIComponent(KEY);
    var data = JSON.stringify(body);
    if (beacon && navigator.sendBeacon) {
      try { if (navigator.sendBeacon(url, new Blob([data], { type: 'text/plain' }))) return; } catch (e) {}
    }
    try {
      fetch(url, { method: 'POST', body: data, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(function () {});
    } catch (e) {}
  }

  var SENSITIVE = /(pass|card|cvv|cvc|ssn|aadhaar|aadhar|pan|otp|secret|pin|account.?no|ifsc|dob|birth)/i;

  function fieldInfo(el) {
    var type = (el.type || '').toLowerCase();
    var name = (el.name || el.id || el.getAttribute('aria-label') || el.placeholder || 'field').toString().toLowerCase().slice(0, 60);
    var value = (el.value || '').toString().trim();
    var kind = 'other';
    if (type === 'email' || /e-?mail/.test(name)) kind = 'email';
    else if (type === 'tel' || /(phone|mobile|whatsapp|contact.?no)/.test(name)) kind = 'phone';
    else if (/(^|[^a-z])(full.?name|first.?name|last.?name|name)([^a-z]|$)/.test(name)) kind = 'name';
    if (type === 'password' || SENSITIVE.test(name)) kind = 'sensitive';
    return { type: type, name: name, value: value.slice(0, 500), kind: kind };
  }
  function trackable(el) {
    if (!el || !el.tagName) return false;
    var t = el.tagName;
    if (t === 'TEXTAREA' || t === 'SELECT') return true;
    if (t !== 'INPUT') return false;
    var type = (el.type || '').toLowerCase();
    return ['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset'].indexOf(type) < 0;
  }

  function captureField(el) {
    var f = fieldInfo(el);
    if (!f.value) return;
    if (f.kind === 'sensitive') { send({ event_type: 'field_capture', field_name: f.name }); return; }
    if (f.kind === 'email') {
      if (f.value.indexOf('@') < 1) return;
      send({ event_type: 'field_capture', field_name: 'email', email: f.value });
      return;
    }
    if (f.kind === 'phone') {
      if (f.value.replace(/\D/g, '').length < 7) return;
      send({ event_type: 'field_capture', field_name: 'phone', phone: f.value });
      return;
    }
    send({ event_type: 'field_capture', field_name: f.name, field_value: f.value });
  }

  function collectForm(form) {
    var out = { fields: {} };
    var els = form && form.elements ? form.elements : [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!trackable(el)) continue;
      var f = fieldInfo(el);
      if (!f.value || f.kind === 'sensitive') continue;
      if (f.kind === 'email' && !out.email && f.value.indexOf('@') > 0) out.email = f.value;
      else if (f.kind === 'phone' && !out.phone) out.phone = f.value;
      else if (f.kind === 'name' && !out.name) out.name = f.value;
      else if (Object.keys(out.fields).length < 30) out.fields[f.name] = f.value;
    }
    if (form && (form.id || form.name)) out.form_id = (form.id || form.name).toString().slice(0, 80);
    return out;
  }

  var started = false, submitted = false;

  document.addEventListener('focus', function (e) {
    if (!started && trackable(e.target)) { started = true; send({ event_type: 'form_start' }); }
  }, true);
  document.addEventListener('blur', function (e) { if (trackable(e.target)) captureField(e.target); }, true);
  document.addEventListener('change', function (e) { if (e.target && e.target.tagName === 'SELECT') captureField(e.target); }, true);
  document.addEventListener('submit', function (e) {
    submitted = true;
    var f = collectForm(e.target);
    f.event_type = 'form_submit';
    send(f, true);
  }, true);
  window.addEventListener('pagehide', function () {
    if (started && !submitted) send({ event_type: 'form_abandon' }, true);
  });

  send({ event_type: 'page_view', screen_res: screen.width + 'x' + screen.height });

  if (document.body && document.body.hasAttribute('data-adsassist-conversion')) {
    send({ event_type: 'conversion', value: Number(document.body.getAttribute('data-adsassist-value')) || null });
  }

  window.adsassist = {
    __loaded: true,
    /** adsassist.track({ event_type: 'custom', name: 'pricing_viewed' }) */
    track: function (p) { send(p || { event_type: 'custom' }); },
    /** adsassist.identify({ email, phone, name }) — e.g. after an SPA form or login */
    identify: function (p) { p = p || {}; send({ event_type: 'identify', email: p.email || null, phone: p.phone || null, name: p.name || null }); },
    /** adsassist.lead({ email, phone, name, fields }) — for forms that don't fire a native submit (SPAs, iframes) */
    lead: function (p) { p = p || {}; submitted = true; send({ event_type: 'form_submit', email: p.email || null, phone: p.phone || null, name: p.name || null, fields: p.fields || {} }, true); },
    /** adsassist.conversion({ value: 4999 }) on a thank-you/payment page */
    conversion: function (p) { send({ event_type: 'conversion', value: (p && p.value) || null }); },
    /** adsassist.consent(true) after the visitor accepts marketing cookies; consent(false) records an opt-out */
    consent: function (granted) {
      setCookie(CONSENT_COOKIE, granted ? '1' : '0', 365);
      send({ event_type: 'custom', name: granted ? 'consent_granted' : 'consent_revoked' });
    }
  };
})();
`;
