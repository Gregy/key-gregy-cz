// key.gregy.cz: the browser performs the TCP port knock to the home network (see README.md).
// The knock target and ports live in #locks, encrypted with the secret; the page source reveals nothing.
//
//   https://key.gregy.cz/#key=<secret>&redirect=<https://x.gregy.cz/...>   knock, then go there
//   https://key.gregy.cz/#key=<secret>                                     knock, then offer the photos
//   https://key.gregy.cz/                                                  ask for the secret
// The secret travels in the fragment, which browsers never send to the server (GitHub Pages logs URLs).
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const STORE = 'key.gregy.cz/secret';
  const HOME = 'https://fotky.gregy.cz/';
  const KNOCK_TIMEOUT_MS = 2500;  // a knock is answered with a RST at once; this only covers networks that drop it
  const ROUNDS = 2;               // a second pass recovers from a stray SYN that broke the first; harmless otherwise

  // ---- language: Czech (or Slovak) browsers get Czech, everyone else English --------------------------
  const TEXT = {
    cs: {
      title: 'Tajná brána',
      intro: 'Fotky a další poklady jsou schované za bránou. Zadej tajné slovo a brána se ti na 12 hodin otevře.',
      label: 'Tajné slovo',
      go: 'Odemknout',
      remember: 'Zapamatovat si slovo na tomto zařízení',
      toPhotos: 'Pokračovat do fotek',
      next: 'Pokračovat',
      hint: 'Brána se otevře jen pro síť, ze které jsi právě připojený. Když přejdeš na jinou Wi-Fi nebo na mobilní data (nebo za 12 hodin), otevři tuhle stránku znovu.',
      forget: 'Zapomenout uložené slovo',
      noCrypto: 'Tenhle prohlížeč bránu neotevře. Zkus jiný, aktuální prohlížeč.',
      framed: 'Otevři tuhle stránku napřímo, ne uvnitř jiného webu.',
      checking: 'Ověřuji tajné slovo…',
      staleSaved: 'Uložené slovo už neplatí. Napiš nové.',
      badLink: 'Klíč v odkazu nesedí. Zkus tajné slovo napsat ručně.',
      badTyped: 'Tohle slovo bránu neotevře. Zkus to znovu.',
      knocking: (i, n) => `Klepu na bránu…  ${i}/${n}`,
      openGoing: 'Brána je otevřená! Pokračuji dál…',
      open: 'Brána je otevřená na 12 hodin.',
      forgotten: 'Uložené slovo smazáno.',
    },
    en: {
      title: 'Secret Gate',
      intro: 'Photos and other treasures are hidden behind this gate. Say the secret word and the gate will open for you for 12 hours.',
      label: 'Secret word',
      go: 'Unlock',
      remember: 'Remember the word on this device',
      toPhotos: 'Continue to the photos',
      next: 'Continue',
      hint: 'The gate opens only for the network you are connected from right now. If you switch to another Wi-Fi or to mobile data (or after 12 hours), open this page again.',
      forget: 'Forget the saved word',
      noCrypto: 'This browser can’t open the gate. Try a different, up-to-date browser.',
      framed: 'Open this page directly, not inside another website.',
      checking: 'Checking the secret word…',
      staleSaved: 'The saved word no longer works. Type a new one.',
      badLink: 'The key in the link doesn’t fit. Try typing the secret word yourself.',
      badTyped: 'That word doesn’t open the gate. Try again.',
      knocking: (i, n) => `Knocking on the gate…  ${i}/${n}`,
      openGoing: 'The gate is open! Taking you there…',
      open: 'The gate is open for 12 hours.',
      forgotten: 'Saved word forgotten.',
    },
  };
  function pickLang() {
    for (const l of navigator.languages || [navigator.language || '']) {
      const p = l.toLowerCase().slice(0, 2);
      if (p === 'cs' || p === 'sk') return 'cs';
      if (p === 'en') return 'en';
    }
    return 'en';
  }
  const lang = pickLang(), T = TEXT[lang];
  document.documentElement.lang = lang;
  document.title = T.title;
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = T[el.dataset.t];
  document.documentElement.classList.add('ready');

  // ---- link parameters (in the fragment) ------------------------------------------------------------
  // redirect=... is often pasted unencoded (with its own ? & #), so it greedily takes the rest of the
  // fragment unless it is percent-encoded.
  function parseParams() {
    const q = location.hash.slice(1);
    let rest = q, redirect = null;
    const m = /(^|&)redirect=/.exec(q);
    if (m) {
      const raw = q.slice(m.index + m[0].length);
      rest = q.slice(0, m.index);
      if (/^https?%3A/i.test(raw)) {              // encoded: ends at the next &
        const end = raw.indexOf('&');
        redirect = dec(end < 0 ? raw : raw.slice(0, end));
        if (end >= 0) rest += '&' + raw.slice(end + 1);
      } else {                                    // raw: the rest of the fragment belongs to it
        redirect = raw;
      }
    }
    const p = new URLSearchParams(rest);
    return { key: p.get('key'), redirect: allowed(redirect) };
  }
  const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return null; } };
  // Only our own https sites: never an open redirect for someone else's phishing.
  function allowed(s) {
    if (!s) return null;
    try {
      const u = new URL(s);
      if (u.protocol === 'https:' && (u.hostname === 'gregy.cz' || u.hostname.endsWith('.gregy.cz'))
          && u.hostname !== location.hostname) return u.href;
    } catch (e) { /* not a URL */ }
    console.warn('redirect ignored:', s);
    return null;
  }
  // Read the fragment, then drop the secret from the address bar and history (keep redirect for a reload).
  function takeParams() {
    const p = parseParams();
    if (p.key) history.replaceState(null, '', location.pathname + location.search + (p.redirect ? '#redirect=' + p.redirect : ''));
    return p;
  }

  // ---- crypto: open one of the locks with the secret -----------------------
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  // Must match normalize() in knockpage.py: "Tajné  Slovo" === "tajne-slovo".
  const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[\s_-]+/g, '-');

  async function unlock(secret) {
    const locks = JSON.parse($('locks').textContent);
    const pw = await crypto.subtle.importKey('raw', new TextEncoder().encode(norm(secret)), 'PBKDF2', false, ['deriveKey']);
    for (const L of locks) {
      const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(L.s), iterations: L.n },
        pw, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      try {
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(L.i) }, key, b64(L.c));
        return JSON.parse(new TextDecoder().decode(pt));       // { host, ip, ports:[...] }
      } catch (e) { /* wrong secret for this lock */ }
    }
    return null;
  }

  // ---- the knock ------------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function fetchT(url, opts, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
  }
  function isPublicV4(ip) {
    const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
    if (!m) return false;
    const a = +m[1], b = +m[2];
    return !(a === 10 || a === 127 || a === 0 || a >= 224 || (a === 172 && b >= 16 && b < 32)
      || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b < 128));
  }
  // Knock the public IP, not the hostname: at home the names resolve to LAN addresses, and a public page
  // reaching a LAN address makes Chrome prompt for "local network access". Resolve over DoH; fall back to
  // the address baked in at build time. (From the LAN a knock is simply a no-op and isn't needed.)
  async function publicIp(host, fallback) {
    try {
      const r = await fetchT('https://cloudflare-dns.com/dns-query?type=A&name=' + encodeURIComponent(host),
        { headers: { accept: 'application/dns-json' }, credentials: 'omit', cache: 'no-store' }, 2500);
      const ip = ((await r.json()).Answer || []).filter((a) => a.type === 1).map((a) => a.data).find(isPublicV4);
      if (ip) return ip;
    } catch (e) { /* DoH blocked or slow */ }
    return fallback;
  }
  async function knockPort(ip, port) {
    // Always "fails" (the port is refused with a RST); only the outgoing SYN matters.
    try {
      await fetchT(`https://${ip}:${port}/`,
        { mode: 'no-cors', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }, KNOCK_TIMEOUT_MS);
    } catch (e) { /* expected */ }
  }

  // ---- UI -------------------------------------------------------------------
  const ui = {
    form: $('form'), input: $('secret'), go: $('go'), remember: $('remember'), status: $('status'),
    done: $('done'), cont: $('continue'), forgetwrap: $('forgetwrap'), forget: $('forget'),
  };
  const say = (text, cls) => { ui.status.textContent = text; ui.status.className = 'status' + (cls ? ' ' + cls : ''); };
  const store = {
    get() { try { return localStorage.getItem(STORE); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(STORE, v); } catch (e) {} },
    del() { try { localStorage.removeItem(STORE); } catch (e) {} },
  };
  let busy = false;

  async function run(secret, source, redirect) {
    if (busy) return;
    busy = true; ui.go.disabled = true; ui.done.hidden = true;
    scene.reset();
    try {
      if (!(window.crypto && crypto.subtle)) { say(T.noCrypto, 'bad'); return; }
      say(T.checking, 'work');
      const t = await unlock(secret);
      if (!t) {
        scene.fail();
        if (source === 'store') { store.del(); ui.forgetwrap.hidden = true; say(T.staleSaved, 'bad'); }
        else say(source === 'link' ? T.badLink : T.badTyped, 'bad');
        ui.input.focus(); ui.input.select();
        return;
      }
      if (ui.remember.checked) { store.set(secret); ui.forgetwrap.hidden = false; }

      const ip = await publicIp(t.host, t.ip);
      for (let round = 0; round < ROUNDS; round++) {
        for (let i = 0; i < t.ports.length; i++) {
          if (round === 0) say(T.knocking(i + 1, t.ports.length), 'work');
          const started = Date.now();
          await knockPort(ip, t.ports[i]);
          if (round === 0) { scene.knock(i); await sleep(Math.max(0, 450 - (Date.now() - started))); }
        }
      }

      scene.open();
      ui.cont.href = redirect || HOME;
      ui.cont.textContent = redirect ? T.next : T.toPhotos;
      ui.done.hidden = false;
      if (redirect) {
        say(T.openGoing, 'ok');
        await sleep(1800);
        location.replace(redirect);
      } else {
        say(T.open, 'ok');
      }
    } finally {
      busy = false; ui.go.disabled = false;
    }
  }

  // ---- wire up --------------------------------------------------------------
  const scene = makeScene($('scene'));
  drawKeyIcon($('keyicon'));
  try { document.body.style.backgroundImage = `url(${wallTile()})`; } catch (e) { /* plain background */ }

  // Never knock from inside someone else's frame (Pages can't send X-Frame-Options / frame-ancestors).
  if (window.top !== window.self) {
    ui.form.hidden = true; say(T.framed, 'bad');
    return;
  }

  let params = takeParams();
  ui.form.addEventListener('submit', (e) => { e.preventDefault(); const v = ui.input.value.trim(); if (v) run(v, 'typed', params.redirect); });
  ui.forget.addEventListener('click', () => { store.del(); ui.forgetwrap.hidden = true; ui.input.value = ''; ui.input.focus(); say(T.forgotten); });
  // a new link pasted into this tab only changes the fragment: no reload, so pick it up here
  addEventListener('hashchange', () => {
    params = takeParams();
    if (params.key) { ui.input.value = params.key; run(params.key, 'link', params.redirect); }
  });

  const saved = store.get();
  if (saved) { ui.input.value = saved; ui.forgetwrap.hidden = false; }

  if (params.key) {                              // link carried the secret: knock straight away
    ui.input.value = params.key;
    run(params.key, 'link', params.redirect);
  } else if (saved) {                            // remembered on this device: knock with it
    run(saved, 'store', params.redirect);
  } else {
    ui.input.focus();
  }
})();
