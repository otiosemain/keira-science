/* Keira Study — shared progress sync (Google sign-in + Firebase Realtime Database).
   Works without it: every page keeps progress in localStorage under "ks:<subject>:<key>".
   This file only adds an optional cloud copy. It lazy-loads the Firebase SDK from gstatic
   only when the user clicks "Sign in" or was signed in before, so offline pages never error. */
(function () {
  'use strict';
  var CFG = {
    apiKey: 'AIzaSyAufSynGj9GfZfYTGM23cq2ESdKlienaSw',
    authDomain: 'keira-study-19aa6.firebaseapp.com',
    databaseURL: 'https://keira-study-19aa6-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'keira-study-19aa6',
    storageBucket: 'keira-study-19aa6.firebasestorage.app',
    messagingSenderId: '244133783793',
    appId: '1:244133783793:web:0a8e4502cca2877d682150'
  };
  var SDK = 'https://www.gstatic.com/firebasejs/13.4.0/';
  var SITE = 'https://otiosemain.github.io/keira-science/';
  var PFX = 'ks:', META = 'ks:_';            // data keys start with ks:<subject>:, meta keys with ks:_
  var LS; try { LS = window.localStorage; LS.getItem('x'); } catch (e) { LS = null; }
  var KS = window.KS = window.KS || {};
  KS.state = 'off'; KS.user = null;
  var loadedAt = Date.now(), interacted = false;
  ['pointerdown', 'keydown'].forEach(function (ev) { addEventListener(ev, function () { interacted = true; }, { once: true, capture: true }); });

  if (!LS) return;
  var proto = Storage.prototype, rawSet = proto.setItem, rawRemove = proto.removeItem;
  function isData(k) { return typeof k === 'string' && k.indexOf(PFX) === 0 && k.indexOf(META) !== 0; }
  function tsMap() { try { return JSON.parse(LS.getItem('ks:_ts') || '{}'); } catch (e) { return {}; } }
  function setTs(k, t) { var m = tsMap(); m[k] = t; rawSet.call(LS, 'ks:_ts', JSON.stringify(m)); }

  // ---- track every local change to ks:* keys ----
  var pending = {}, timer = null, fb = null;
  proto.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (this === LS && isData(k)) { setTs(k, Date.now()); pending[k] = 1; schedule(); }
  };
  proto.removeItem = function (k) {
    rawRemove.call(this, k);
    if (this === LS && isData(k)) { setTs(k, Date.now()); pending[k] = 1; schedule(); }
  };
  function schedule() { if (!fb || !KS.user) return; clearTimeout(timer); timer = setTimeout(flush, 1500); }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });

  // ---- cloud path encoding: users/{uid}/kv/{subject}/{key} = {v, t} ----
  function enc(s) { return s.replace(/[.#$\[\]\/%]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); }); }
  function dec(s) { return s.replace(/%([0-9A-F]{2})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); }); }
  function split(k) { var r = k.slice(PFX.length), i = r.indexOf(':'); return i < 0 ? null : [r.slice(0, i), r.slice(i + 1)]; }
  function cloudPath(k) { var p = split(k); return p ? enc(p[0]) + '/' + enc(p[1]) : null; }

  function flush() {
    if (!fb || !KS.user) return;
    clearTimeout(timer);
    var keys = Object.keys(pending); if (!keys.length) return;
    pending = {};
    var upd = {}, ts = tsMap();
    keys.forEach(function (k) {
      var p = cloudPath(k); if (!p) return;
      var v = LS.getItem(k);
      upd[p] = v === null ? null : { v: v, t: ts[k] || Date.now() };
    });
    fb.update(fb.ref(fb.db, 'users/' + KS.user.uid + '/kv'), upd).then(function () { setUI('on'); })
      .catch(function (e) { keys.forEach(function (k) { pending[k] = 1; }); setUI('err', e); });
  }

  // ---- merge rules ----
  function J(s, d) { try { var x = JSON.parse(s); return x == null ? d : x; } catch (e) { return d; } }
  function attemptKey(a) { return JSON.stringify(a); }
  function mergeAttempts(a, b, cap) {
    var seen = {}, out = [];
    a.concat(b).forEach(function (x) { if (x && typeof x === 'object') { var id = attemptKey(x); if (!seen[id]) { seen[id] = 1; out.push(x); } } });
    out.sort(function (x, y) { var tx = x.ts || Date.parse(x.d || 0) || 0, ty = y.ts || Date.parse(y.d || 0) || 0; return tx - ty; });
    var pct = function (x) { return x.p != null ? x.p : (x.n ? 100 * x.s / x.n : 0); };
    var best = out.reduce(function (m, x) { return !m || pct(x) > pct(m) ? x : m; }, null);
    var tail = out.slice(-cap);
    if (best && tail.indexOf(best) < 0) tail.unshift(best);     // never lose the best score
    return tail;
  }
  // returns merged string value (or null if both missing)
  function mergeValue(key, lv, lt, cv, ct) {
    if (lv == null) return cv; if (cv == null) return lv; if (lv === cv) return lv;
    var sub = split(key) ? split(key)[1] : key, newerLocal = lt >= ct;
    if (/-(read|learn)$/.test(sub)) {             // lessons/sections done: union
      var a = J(lv, {}), b = J(cv, {}), o = {};
      Object.keys(a).concat(Object.keys(b)).forEach(function (k) { o[k] = !!(a[k] || b[k]); });
      return JSON.stringify(o);
    }
    if (/-lchk$/.test(sub)) {                      // learn check-questions: max (correct anywhere stays correct)
      var a2 = J(lv, {}), b2 = J(cv, {}), o2 = {};
      Object.keys(a2).concat(Object.keys(b2)).forEach(function (k) { o2[k] = Math.max(+a2[k] || 0, +b2[k] || 0); });
      return JSON.stringify(o2);
    }
    if (/-quiz$/.test(sub)) return JSON.stringify(mergeAttempts(J(lv, []), J(cv, []), 30));
    if (/^exam-/.test(sub)) return JSON.stringify(mergeAttempts(J(lv, []), J(cv, []), 20));
    if (/-cards$/.test(sub)) {                     // flashcards: newer side wins per card; a reset ({}) wins outright
      var nw = J(newerLocal ? lv : cv, {}), od = J(newerLocal ? cv : lv, {});
      if (!Object.keys(nw).length) return '{}';
      var o3 = {}; Object.keys(od).forEach(function (k) { o3[k] = od[k]; }); Object.keys(nw).forEach(function (k) { o3[k] = nw[k]; });
      return JSON.stringify(o3);
    }
    return newerLocal ? lv : cv;                   // wrong-answer lists, totals, anything else: newest wins
  }
  KS._mergeValue = mergeValue;                   // exposed for tests

  function pullAndMerge() {
    return fb.get(fb.ref(fb.db, 'users/' + KS.user.uid + '/kv')).then(function (snap) {
      var cloud = snap.val() || {}, ts = tsMap(), all = {}, changedLocal = [], upd = {};
      Object.keys(cloud).forEach(function (s) {
        var o = cloud[s] || {}; Object.keys(o).forEach(function (k) { all[PFX + dec(s) + ':' + dec(k)] = o[k]; });
      });
      for (var i = 0; i < LS.length; i++) { var k = LS.key(i); if (isData(k) && !(k in all)) all[k] = null; }
      Object.keys(all).forEach(function (k) {
        var c = all[k], lv = LS.getItem(k), lt = ts[k] || 0, cv = c ? c.v : null, ct = c ? (c.t || 0) : 0;
        var m = mergeValue(k, lv, lt, cv, ct);
        if (m == null) return;
        var t = Math.max(lt, ct, 1);
        if (m !== lv) { rawSet.call(LS, k, m); ts[k] = t; changedLocal.push(k); }
        if (m !== cv) upd[cloudPath(k)] = { v: m, t: m === lv ? (lt || t) : t };
      });
      rawSet.call(LS, 'ks:_ts', JSON.stringify(ts));
      var w = Object.keys(upd).length ? fb.update(fb.ref(fb.db, 'users/' + KS.user.uid + '/kv'), upd) : Promise.resolve();
      return w.then(function () { return changedLocal; });
    });
  }

  function afterSync(changed) {
    setUI('on');
    try { window.dispatchEvent(new CustomEvent('ks-synced', { detail: { changed: changed } })); } catch (e) {}
    if (!changed.length || window.KS_NO_RELOAD) return;
    var flag = 'ks-reloaded:' + location.pathname;
    if (!interacted && Date.now() - loadedAt < 10000 && !sessionStorage.getItem(flag)) {
      try { sessionStorage.setItem(flag, '1'); } catch (e) {}
      location.reload();
    } else banner();
  }

  // ---- Firebase lazy loading ----
  var loading = null, signingIn = false;
  function loadFirebase() {
    if (loading) return loading;
    loading = Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-database.js')])
      .then(function (m) {
        var app = m[0].initializeApp(CFG), auth = m[1].getAuth(app);
        fb = { A: m[1], D: m[2], auth: auth, db: m[2].getDatabase(app), ref: m[2].ref, get: m[2].get, update: m[2].update };
        m[1].onAuthStateChanged(auth, function (u) {
          KS.user = u;
          if (u) {
            rawSet.call(LS, 'ks:_auth', '1');
            setUI('busy');
            pullAndMerge().then(afterSync).then(flush).catch(function (e) { setUI('err', e); });
          } else { rawSet.call(LS, 'ks:_auth', '0'); if (!signingIn) setUI('out'); }
        });
        return fb;
      });
    loading.catch(function () { loading = null; });
    return loading;
  }
  function signIn() {
    setUI('busy'); signingIn = true;
    loadFirebase().then(function () {
      var p = new fb.A.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
      return fb.A.signInWithPopup(fb.auth, p).catch(function (e) {
        var c = e && e.code || '';
        if (/popup-blocked|operation-not-supported/.test(c)) return fb.A.signInWithRedirect(fb.auth, p);   // fallback
        if (/popup-closed-by-user|cancelled-popup/.test(c)) { setUI('out'); return; }
        throw e;
      });
    }).catch(function (e) { setUI(navigator.onLine === false ? 'offline' : 'err', e); })
      .then(function () { signingIn = false; if (!KS.user && KS.state === 'busy') setUI('out'); });
  }
  function signOut() { flush(); if (fb) fb.A.signOut(fb.auth).then(function () { setUI('out'); }); }
  KS.signIn = signIn; KS.signOut = signOut; KS.flush = flush;

  // ---- header widget ----
  var box;
  var CSS = '.ks-auth{display:flex;justify-content:flex-end;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 8px;font-size:13px}' +
    '.ks-auth button,.ks-auth a{font:inherit;font-size:13px;border:0;border-radius:999px;padding:4px 12px;cursor:pointer;background:rgba(255,255,255,.92);color:#234;text-decoration:none}' +
    '.ks-auth .ks-st{background:rgba(255,255,255,.22);color:inherit;border-radius:999px;padding:4px 10px}' +
    '.ks-ban{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);background:#234;color:#fff;border-radius:14px;padding:10px 14px;z-index:99;box-shadow:0 4px 14px rgba(0,0,0,.25);font-size:14px}' +
    '.ks-ban button{margin-left:10px;font:inherit;border:0;border-radius:10px;padding:4px 10px;cursor:pointer}' +
    '@media print{.ks-auth,.ks-ban{display:none}}';
  function el(tag, attrs, text) { var e = document.createElement(tag); for (var a in attrs) e.setAttribute(a, attrs[a]); if (text) e.textContent = text; return e; }
  function setUI(state, err) {
    KS.state = state; if (err) { KS.lastError = String(err && (err.code || err.message) || err); }
    if (!box) return;
    box.innerHTML = '';
    if (state === 'file') {
      box.appendChild(el('a', { href: SITE, target: '_blank', rel: 'noopener', title: '在网上版登录，进度可在不同设备同步 Sign in on the website to sync progress across devices' }, '☁ 网上版可登录同步 Sign in on the website'));
    } else if (state === 'on' || state === 'busy') {
      var n = KS.user ? (KS.user.displayName || KS.user.email || '').split(' ')[0] : '';
      box.appendChild(el('span', { 'class': 'ks-st', title: KS.user ? (KS.user.email || '') : '' }, state === 'busy' ? '⏳ 同步中 Syncing…' : '☁ 已同步 Synced' + (n ? ' · ' + n : '')));
      if (KS.user) { var o = el('button', { type: 'button', 'class': 'ks-out' }, '登出 Sign out'); o.onclick = signOut; box.appendChild(o); }
    } else {
      if (state === 'err') box.appendChild(el('span', { 'class': 'ks-st', title: KS.lastError || '' }, '⚠ 同步失败 Sync failed'));
      if (state === 'offline') box.appendChild(el('span', { 'class': 'ks-st' }, '📴 离线 Offline · 进度存在本机 saved on this device'));
      var b = el('button', { type: 'button', 'class': 'ks-in', title: '登录后进度会存到云端，换设备也能继续 Sign in to keep progress across devices' }, '🔑 用 Google 登录 Sign in with Google');
      b.onclick = signIn; box.appendChild(b);
    }
  }
  function banner() {
    if (document.querySelector('.ks-ban')) return;
    var d = el('div', { 'class': 'ks-ban' }, '☁ 已载入其他设备的进度 Progress from your other devices is loaded.');
    var b = el('button', { type: 'button' }, '刷新 Refresh'); b.onclick = function () { location.reload(); };
    d.appendChild(b); document.body.appendChild(d);
  }
  function init() {
    var st = el('style'); st.textContent = CSS; document.head.appendChild(st);
    var h = document.querySelector('header');
    box = el('div', { 'class': 'ks-auth', id: 'ks-auth' });
    if (h) h.insertBefore(box, h.firstChild); else { box.style.cssText = 'position:fixed;top:6px;right:8px;z-index:50'; document.body.appendChild(box); }
    if (!/^https?:$/.test(location.protocol)) { setUI('file'); return; }
    if (LS.getItem('ks:_auth') === '1') {
      setUI('busy');
      loadFirebase().catch(function (e) { setUI(navigator.onLine === false ? 'offline' : 'err', e); });
    } else setUI('out');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
