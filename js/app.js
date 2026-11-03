/* ==========================================================================
   one סושי בר – online ordering (vanilla JS, no build step)
   Reads window.ONE_CONFIG (js/config.js) and window.ONE_MENU (js/menu-data.js).
   ========================================================================== */
(function () {
  'use strict';

  window.ONE_APP_VERSION = '2026-11-03.2';
  const CFG = window.ONE_CONFIG || {};
  const R = CFG.restaurant || {};
  const O = CFG.ordering || {};
  const MENU = window.ONE_MENU;
  if (!MENU || !MENU.categories) {
    document.getElementById('menu').innerHTML = '<p class="empty">קובץ התפריט (js/menu-data.js) לא נטען. הריצו: python tools/scrape_menu.py</p>';
    return;
  }

  // ---------- tiny helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const CUR = O.currency || '₪';
  const money = (n) => `${CUR}${Number.isInteger(n) ? n : n.toFixed(1)}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
  const pad = (n) => String(n).padStart(2, '0');
  const DAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  const TAG_CLASS = { 'צמחוני': 'veg', 'חריף': 'spicy', 'פירות ים': 'sea' };
  const TAG_ICON = { 'צמחוני': '🌱', 'חריף': '🌶️', 'פירות ים': '🦐' };
  const CHANNELS_CONFIGURED = !!(O.whatsappNumber || O.orderEndpoint || O.orderEmail);

  // ---------- data ----------
  const CATS = MENU.categories;
  const ITEMS = new Map();
  CATS.forEach((cat) => cat.sections.forEach((sec) => sec.items.forEach((it) => {
    it.categoryId = cat.id; it.categoryName = cat.name; it.sectionTitle = sec.title;
    ITEMS.set(it.id, it);
  })));
  const hasChoices = (it) => (it.options && it.options.length) || (it.variants && it.variants.length);
  const isCustomizable = (it) => hasChoices(it) || (it.ingredients && it.ingredients.length);

  // ---------- state ----------
  const state = {
    cart: load('one-cart', []).filter((l) => ITEMS.has(l.id)),
    service: load('one-service', O.deliveryEnabled === false ? 'pickup' : 'delivery'),
    customer: load('one-customer', {}),
    filters: new Set(),
    query: '',
  };
  if (state.service === 'delivery' && O.deliveryEnabled === false) state.service = 'pickup';
  if (state.service === 'pickup' && O.pickupEnabled === false) state.service = 'delivery';

  // ---------- opening hours ----------
  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const hoursFor = (date) => (O.hours || {})[date.getDay()] || [];
  function isOpenAt(date) {
    const mins = date.getHours() * 60 + date.getMinutes();
    for (const [a, b] of hoursFor(date)) {
      const s = toMin(a), e = toMin(b);
      if (e > s ? (mins >= s && mins < e) : (mins >= s || mins < e)) return true;
    }
    const y = new Date(date); y.setDate(y.getDate() - 1);
    for (const [a, b] of hoursFor(y)) { const s = toMin(a), e = toMin(b); if (e < s && mins < e) return true; }
    return false;
  }
  const isOpenNow = () => isOpenAt(new Date());
  function hoursText() {
    const h = O.hours || {};
    const fmt = (d) => (h[d] || []).map(([a, b]) => `${a}–${b}`).join(', ') || 'סגור';
    const groups = [];
    for (let d = 0; d < 7; d++) {
      const txt = fmt(d);
      const last = groups[groups.length - 1];
      if (last && last.txt === txt && last.to === d - 1) last.to = d; else groups.push({ from: d, to: d, txt });
    }
    return groups.map((g) => `${g.from === g.to ? DAY_LETTERS[g.from] : `${DAY_LETTERS[g.from]}–${DAY_LETTERS[g.to]}`} ${g.txt}`).join(' · ');
  }
  function todayHoursText() {
    const t = hoursFor(new Date()).map(([a, b]) => `${a}–${b}`).join(', ');
    return t ? `היום ${t}` : 'סגור היום';
  }

  // ---------- cart math ----------
  const lineUnit = (l) => { const it = ITEMS.get(l.id); if (!it) return 0; return (l.variant ? l.variant.price : (it.price || 0)) + (l.choices || []).reduce((s, c) => s + (c.price || 0), 0); };
  const lineTotal = (l) => lineUnit(l) * l.qty;
  const cartCount = () => state.cart.reduce((s, l) => s + l.qty, 0);
  const subtotal = () => state.cart.reduce((s, l) => s + lineTotal(l), 0);
  function deliveryFee() {
    if (state.service !== 'delivery') return 0;
    if (O.freeDeliveryFrom && subtotal() >= O.freeDeliveryFrom) return 0;
    return O.deliveryFee || 0;
  }
  const total = () => subtotal() + deliveryFee();
  const minimumOk = () => subtotal() >= (O.minimumOrder || 0);
  const lineKey = (id, variant, choices, notes, removed) => [id, variant ? variant.name : '', (choices || []).map((c) => `${c.group}:${c.name}`).sort().join(','), (removed || []).slice().sort().join(','), (notes || '').trim()].join('|');
  const qtyInCart = (id) => state.cart.filter((l) => l.id === id).reduce((s, l) => s + l.qty, 0);

  function addLine({ item, variant = null, choices = [], notes = '', qty = 1, removed = [], from = null }) {
    const key = lineKey(item.id, variant, choices, notes, removed);
    const existing = state.cart.find((l) => l.key === key);
    if (existing) existing.qty += qty;
    else state.cart.push({ key, id: item.id, qty, variant, choices, removed, notes: notes.trim() });
    persistCart();
    toast(`${item.name} נוסף לסל ✓`);
    flyToCart(from);
  }
  function setQty(key, qty) {
    const l = state.cart.find((x) => x.key === key);
    if (!l) return;
    l.qty = qty;
    if (l.qty <= 0) state.cart = state.cart.filter((x) => x !== l);
    persistCart();
  }
  function persistCart() { save('one-cart', state.cart); renderCartBits(); }
  function setService(s) {
    state.service = s; save('one-service', s);
    $$('#service-toggle button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.service === s)));
    renderStatus(); renderCartBits();
  }

  // ---------- UI: toast / bump ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }
  function bump() { [$('#cart-btn'), $('#bottombar-btn')].forEach((b) => { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }); }

  // ---------- UI: header / hero ----------
  function renderChrome() {
    if (R.logoUrl) {
      const img = $('#logo-img');
      img.src = R.logoUrl; img.hidden = false; $('#logo-text').hidden = true;
      img.onerror = () => { img.hidden = true; $('#logo-text').hidden = false; };
    }
    if (R.siteUrl) { $('#logo-link').href = R.siteUrl; $('#site-link').href = R.siteUrl; $('#footer-site').href = R.siteUrl; $('#footer-site').textContent = R.siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''); }
    if (R.heroImage) $('#hero-img').src = R.heroImage;
    $('#hero-sub').textContent = `${R.name || ''} · ${R.address || ''}${R.addressNote ? ` (${R.addressNote})` : ''}`;
    $('#footer-address').textContent = `${R.address || ''}${R.addressNote ? ` · ${R.addressNote}` : ''}`;
    $('#footer-hours').textContent = `שעות פעילות: ${hoursText()}`;
    const phone = $('#footer-phone'); phone.textContent = R.phone || ''; phone.href = `tel:${(R.phone || '').replace(/[^\d+]/g, '')}`;
    const tg = $('#service-toggle');
    if (O.deliveryEnabled === false) tg.querySelector('[data-service="delivery"]').remove();
    if (O.pickupEnabled === false) tg.querySelector('[data-service="pickup"]').remove();
    $$('#service-toggle button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.service === state.service));
      b.addEventListener('click', () => setService(b.dataset.service));
    });
  }
  function renderStatus() {
    const open = isOpenNow();
    const bits = [`<span><i class="dot ${open ? '' : 'closed'}"></i>${open ? 'פתוח עכשיו' : 'סגור כעת'} · ${esc(todayHoursText())}</span>`];
    const prep = (O.prepTimeMinutes || {})[state.service];
    if (state.service === 'delivery') {
      bits.push(`<span>🛵 משלוח ${O.deliveryFee ? money(O.deliveryFee) : 'חינם'}${O.freeDeliveryFrom ? ` · חינם מעל ${money(O.freeDeliveryFrom)}` : ''}</span>`);
      if (O.deliveryCities && O.deliveryCities.length) bits.push(`<span>📍 משלוחים ל${esc(O.deliveryCities.join(', '))}</span>`);
    } else {
      bits.push(`<span>🥢 איסוף עצמי מ${esc(R.address || 'המסעדה')}</span>`);
    }
    if (O.minimumOrder) bits.push(`<span>מינימום הזמנה ${money(O.minimumOrder)}</span>`);
    if (prep) bits.push(`<span>⏱ זמן הכנה משוער ${prep} דק׳</span>`);
    $('#status-line').innerHTML = bits.join('');
  }

  // ---------- UI: category pills + filters ----------
  function renderPills() {
    $('#pills').innerHTML = CATS.map((c) => `<button class="pill" type="button" data-target="${c.id}">${esc(c.short || c.name)}</button>`).join('');
    $$('#pills .pill').forEach((p) => p.addEventListener('click', () => {
      const sec = document.getElementById(p.dataset.target);
      if (sec) sec.scrollIntoView({ block: 'start' });
      else { state.query = ''; $('#search').value = ''; state.filters.clear(); renderFilters(); renderMenu(); document.getElementById(p.dataset.target)?.scrollIntoView({ block: 'start' }); }
    }));
    const tags = new Set();
    ITEMS.forEach((it) => (it.tags || []).forEach((t) => tags.add(t)));
    $('#filters').innerHTML = [...tags].map((t) => `<button class="chip" type="button" data-tag="${esc(t)}" aria-pressed="false">${TAG_ICON[t] || ''} ${esc(t)}</button>`).join('');
    $$('#filters .chip').forEach((c) => c.addEventListener('click', () => {
      const t = c.dataset.tag;
      if (state.filters.has(t)) state.filters.delete(t); else state.filters.add(t);
      renderFilters(); renderMenu();
    }));
  }
  function renderFilters() { $$('#filters .chip').forEach((c) => c.setAttribute('aria-pressed', String(state.filters.has(c.dataset.tag)))); }
  function updateActivePill() {
    const offset = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) + parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) + 24;
    let current = null;
    for (const sec of $$('.cat')) { if (sec.getBoundingClientRect().top <= offset) current = sec.id; else break; }
    if (!current) { const first = $('.cat'); current = first ? first.id : null; }
    const pills = $('#pills');
    $$('#pills .pill').forEach((p) => {
      const active = p.dataset.target === current;
      const wasActive = p.classList.contains('active');
      p.classList.toggle('active', active);
      if (active && !wasActive) {
        // keep the active pill visible, scrolling only the pill strip (never the page)
        const pr = p.getBoundingClientRect(), cr = pills.getBoundingClientRect();
        pills.scrollBy({ left: (pr.left + pr.width / 2) - (cr.left + cr.width / 2), behavior: 'smooth' });
      }
    });
  }

  // ---------- UI: menu ----------
  function itemMatches(it) {
    const q = state.query.trim().toLowerCase();
    if (q && !`${it.name} ${it.description} ${it.sectionTitle} ${it.categoryName}`.toLowerCase().includes(q)) return false;
    for (const f of state.filters) if (!(it.tags || []).includes(f)) return false;
    return true;
  }
  function itemCard(it) {
    let price;
    if (it.variants && it.variants.length) price = `<small>החל מ-</small>${money(Math.min(...it.variants.map((v) => v.price)))}`;
    else if (it.price == null) price = '<small>לפי מחיר בטלפון</small>';
    else price = money(it.price);
    const tags = (it.badges || []).map((b) => `<span class="tag badge-gold">★ ${esc(b)}</span>`).join('')
      + (it.tags || []).map((t) => `<span class="tag ${TAG_CLASS[t] || ''}">${esc(t)}</span>`).join('');
    const unavailable = it.price == null && !(it.variants && it.variants.length);
    return `<article class="item${unavailable ? ' unavailable' : ''}" data-id="${esc(it.id)}" tabindex="0" role="button" aria-label="${esc(it.name)}">
      <h4 class="name">${esc(it.name)}${tags}</h4>
      ${it.description ? `<p class="desc">${esc(it.description)}</p>` : ''}
      <div class="price">${price}${hasChoices(it) ? ' <small>· לבחירה</small>' : (it.ingredients && it.ingredients.length ? ' <small>· ניתן להתאים</small>' : '')}</div>
      ${unavailable ? '' : `<button class="add" type="button" aria-label="הוסף ${esc(it.name)} לסל" data-qty="${qtyInCart(it.id)}">+</button>`}
    </article>`;
  }
  function renderMenu() {
    const main = $('#menu');
    const parts = [];
    for (const cat of CATS) {
      const secs = cat.sections.map((sec) => ({ sec, items: sec.items.filter(itemMatches) })).filter((s) => s.items.length);
      if (!secs.length) continue;
      parts.push(`<section class="cat container" id="${esc(cat.id)}">
        <div class="cat-banner">${cat.image ? `<img src="${esc(cat.image)}" alt="" loading="lazy">` : ''}
          <div class="text"><h2>${esc(cat.name)}</h2>${cat.tagline ? `<p>${esc(cat.tagline)}</p>` : ''}</div>
        </div>
        ${secs.map(({ sec, items }) => {
          const showTitle = sec.title !== cat.name;
          const head = showTitle || sec.notes.length
            ? `<h3 class="section-title">${showTitle ? esc(sec.title) : ''}${sec.notes.length ? `<small>${esc(sec.notes.join(' · '))}</small>` : ''}</h3>` : '';
          return `${head}<div class="items">${items.map(itemCard).join('')}</div>`;
        }).join('')}
      </section>`);
    }
    main.innerHTML = parts.length ? parts.join('')
      : `<div class="empty container"><div class="ico">🍣</div><p>לא נמצאו מנות מתאימות לחיפוש</p><button class="btn btn-ghost" type="button" id="clear-filters">נקה חיפוש וסינון</button></div>`;
    $('#clear-filters')?.addEventListener('click', () => { state.query = ''; $('#search').value = ''; state.filters.clear(); renderFilters(); renderMenu(); });
    $('#featured').hidden = !!(state.query.trim() || state.filters.size) || !(MENU.featured || []).length;
    observeReveals(main);
    updateActivePill();
  }

  // ---------- UI: featured strip ----------
  function renderFeatured() {
    const ids = (MENU.featured || []).filter((id) => ITEMS.has(id));
    const sec = $('#featured');
    if (!ids.length) { sec.hidden = true; return; }
    sec.hidden = false;
    $('#featured-strip').innerHTML = ids.map((id) => {
      const it = ITEMS.get(id);
      const price = it.variants && it.variants.length ? money(Math.min(...it.variants.map((v) => v.price))) : money(it.price || 0);
      return `<article class="fcard" data-id="${esc(id)}" tabindex="0" role="button" aria-label="${esc(it.name)}">
        <div><div class="f-tag">★ ${esc((it.badges || [])[0] || it.categoryName)}</div><div class="f-name">${esc(it.name)}</div>${it.description ? `<div class="f-desc">${esc(it.description)}</div>` : ''}</div>
        <div class="f-foot"><span class="f-price">${price}</span><span class="add-mini" aria-hidden="true">+</span></div>
      </article>`;
    }).join('');
    observeReveals(sec);
  }
  function onFeaturedClick(e) {
    const card = e.target.closest('.fcard');
    if (card) openItemModal(ITEMS.get(card.dataset.id));
  }

  // ---------- motion: scroll reveal, fly-to-cart, parallax, count-up ----------
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealObs = !REDUCED && 'IntersectionObserver' in window ? new IntersectionObserver((entries) => entries.forEach((en) => {
    if (!en.isIntersecting) return;
    const el = en.target;
    el.classList.add('in');
    revealObs.unobserve(el);
    setTimeout(() => { el.classList.remove('reveal', 'in'); el.style.transitionDelay = ''; }, 750);
  }), { rootMargin: '0px 0px -6% 0px' }) : null;
  function observeReveals(root) {
    if (!revealObs) return;
    $$('.item, .cat-banner, .fcard', root).forEach((el, i) => {
      el.classList.add('reveal');
      el.style.transitionDelay = `${(i % 6) * 45}ms`;
      revealObs.observe(el);
    });
  }
  function flyToCart(fromEl) {
    const target = innerWidth <= 720 && !$('#bottombar').hidden ? $('#bottombar-btn') : $('#cart-btn');
    if (!fromEl || REDUCED || !target || !fromEl.getBoundingClientRect) { bump(); return; }
    const a = fromEl.getBoundingClientRect(), b = target.getBoundingClientRect();
    if (!a.width) { bump(); return; }
    const dot = document.createElement('div');
    dot.className = 'fly';
    dot.style.left = `${a.left + a.width / 2 - 8}px`;
    dot.style.top = `${a.top + a.height / 2 - 8}px`;
    document.body.appendChild(dot);
    const dx = (b.left + b.width / 2) - (a.left + a.width / 2), dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    const anim = dot.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 90}px) scale(1.25)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(.25)`, opacity: .5 },
    ], { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)' });
    anim.onfinish = () => { dot.remove(); bump(); };
  }
  function initParallax() {
    const media = $('#hero-media');
    if (!media || REDUCED) return;
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { media.style.transform = `translateY(${Math.min(scrollY, 900) * 0.28}px)`; ticking = false; });
    }, { passive: true });
  }
  function animateMoney(el, to) {
    const from = Number(el.dataset.value || 0);
    el.dataset.value = to;
    if (REDUCED || from === to) { el.textContent = money(to); return; }
    const start = performance.now(), dur = 380;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - t, 3);
      el.textContent = money(Math.round(from + (to - from) * e));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function onMenuClick(e) {
    const card = e.target.closest('.item');
    if (!card || card.classList.contains('unavailable')) return;
    const it = ITEMS.get(card.dataset.id);
    if (!it) return;
    // The "+" adds a plain dish straight away; anything else (or a dish with
    // choices / removable ingredients) opens the customisation sheet.
    const addBtn = e.target.closest('.add');
    if (addBtn && !isCustomizable(it)) addLine({ item: it, from: addBtn }); else openItemModal(it);
  }

  // ---------- UI: cart bits (badge, bottom bar, qty badges) ----------
  function renderCartBits() {
    const n = cartCount();
    $('#cart-count').textContent = n;
    $('#bottombar-count').textContent = n;
    animateMoney($('#bottombar-total'), total());
    $('#bottombar').hidden = n === 0 || $('#cart').classList.contains('open');
    $$('.item .add').forEach((b) => { b.dataset.qty = qtyInCart(b.closest('.item').dataset.id); });
    if ($('#cart').classList.contains('open')) renderCart();
  }

  // ---------- UI: cart drawer ----------
  function openCart() {
    renderCart();
    $('#cart').classList.add('open'); $('#cart').setAttribute('aria-hidden', 'false');
    $('#scrim').classList.add('show'); document.body.style.overflow = 'hidden';
    $('#bottombar').hidden = true;
    $('#cart-close').focus();
  }
  function closeCart() {
    $('#cart').classList.remove('open'); $('#cart').setAttribute('aria-hidden', 'true');
    $('#scrim').classList.remove('show'); document.body.style.overflow = '';
    renderCartBits();
  }
  function lineOptionsText(l) {
    const bits = [];
    if (l.variant) bits.push(l.variant.name);
    if (l.choices && l.choices.length) {
      const byGroup = {};
      l.choices.forEach((c) => { (byGroup[c.group] = byGroup[c.group] || []).push(c.name + (c.price ? ` (+${money(c.price)})` : '')); });
      Object.entries(byGroup).forEach(([g, names]) => bits.push(`${g}: ${names.join(', ')}`));
    }
    if (l.removed && l.removed.length) bits.push(`בלי ${l.removed.join(', ')}`);
    return bits.join(' · ');
  }
  function totalsHtml() {
    const sub = subtotal(), fee = deliveryFee();
    const freeLeft = state.service === 'delivery' && O.freeDeliveryFrom && sub < O.freeDeliveryFrom ? O.freeDeliveryFrom - sub : 0;
    return `<div class="totals">
      <div><span>סכום ביניים</span><span>${money(sub)}</span></div>
      ${state.service === 'delivery' ? `<div><span>דמי משלוח</span><span class="${fee === 0 ? 'free' : ''}">${fee === 0 ? 'חינם' : money(fee)}</span></div>` : ''}
      ${freeLeft ? `<div class="small" style="color:var(--muted)"><span>עוד ${money(freeLeft)} למשלוח חינם</span><span></span></div>` : ''}
      <div class="grand"><span>סה"כ לתשלום</span><span>${money(sub + fee)}</span></div>
    </div>`;
  }
  function renderCart() {
    const body = $('#cart-body'), foot = $('#cart-foot');
    if (!state.cart.length) {
      body.innerHTML = `<div class="empty"><div class="ico">🥢</div><p>הסל עדיין ריק</p><button class="btn btn-ghost" type="button" id="cart-browse">לתפריט</button></div>`;
      $('#cart-browse').addEventListener('click', closeCart);
      foot.hidden = true;
      return;
    }
    body.innerHTML = state.cart.map((l) => {
      const it = ITEMS.get(l.id);
      const opts = lineOptionsText(l);
      return `<div class="line" data-key="${esc(l.key)}">
        <div class="l-name">${esc(it.name)}</div>
        <div class="l-price">${money(lineTotal(l))}</div>
        ${opts ? `<div class="l-opts">${esc(opts)}</div>` : ''}
        ${l.notes ? `<div class="l-notes">הערה: ${esc(l.notes)}</div>` : ''}
        <div class="l-ctrl">
          <div class="stepper"><button type="button" data-act="dec" aria-label="הפחת">−</button><output>${l.qty}</output><button type="button" data-act="inc" aria-label="הוסף">+</button></div>
          <span class="small" style="color:var(--muted)">${money(lineUnit(l))} ליח׳</span>
          <button class="link-btn" type="button" data-act="remove" style="margin-inline-start:auto">הסרה</button>
        </div>
      </div>`;
    }).join('');
    const minLeft = (O.minimumOrder || 0) - subtotal();
    const open = isOpenNow();
    const canOrder = minimumOk() && (open || O.acceptOrdersWhenClosed);
    foot.hidden = false;
    foot.innerHTML = `
      ${minLeft > 0 ? `<div class="notice">מינימום הזמנה ${money(O.minimumOrder)} – חסרים עוד ${money(minLeft)}<div class="progress"><i style="width:${Math.min(100, subtotal() / O.minimumOrder * 100)}%"></i></div></div>` : ''}
      ${!open && !O.acceptOrdersWhenClosed ? `<div class="notice err">המסעדה סגורה כעת. ${esc(hoursText())}</div>` : ''}
      ${!open && O.acceptOrdersWhenClosed ? `<div class="notice">המסעדה סגורה כעת – ניתן להזמין מראש לשעות הפעילות</div>` : ''}
      ${totalsHtml()}
      <button class="btn btn-primary" type="button" id="to-checkout" ${canOrder ? '' : 'disabled'}>${open || O.acceptOrdersWhenClosed ? 'המשך להזמנה' : 'המסעדה סגורה כעת'}</button>`;
    $('#to-checkout').addEventListener('click', () => { closeCart(); openCheckout(); });
  }
  function onCartClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const key = btn.closest('.line').dataset.key;
    const l = state.cart.find((x) => x.key === key);
    if (!l) return;
    if (btn.dataset.act === 'inc') setQty(key, l.qty + 1);
    if (btn.dataset.act === 'dec') setQty(key, l.qty - 1);
    if (btn.dataset.act === 'remove') setQty(key, 0);
  }

  // ---------- UI: item modal (variants / options / notes / qty) ----------
  let lastFocus = null;
  function openItemModal(it) {
    lastFocus = document.activeElement;
    const modal = $('#item-modal');
    const card = document.createElement('div'); // fresh element: no stale listeners from a previous item
    card.className = 'modal-card';
    card.id = 'item-modal-card';
    modal.replaceChildren(card);
    const groups = [];
    if (it.variants && it.variants.length) {
      groups.push({ key: 'variant', name: 'בחירה', min: 1, max: 1, choices: it.variants.map((v) => ({ name: v.name, price: v.price, absolute: true })) });
    }
    (it.options || []).forEach((g, i) => groups.push({ key: `g${i}`, name: g.name, min: g.min ?? 0, max: g.max ?? 1, choices: g.choices }));
    card.innerHTML = `
      <div class="modal-head">
        <div><h2 id="item-modal-title">${esc(it.name)}</h2>${it.description ? `<p>${esc(it.description)}</p>` : ''}</div>
        <button class="icon-btn" type="button" data-close aria-label="סגור">✕</button>
      </div>
      <div class="modal-body">
        ${groups.map((g) => `<fieldset class="group" data-key="${g.key}" data-min="${g.min}" data-max="${g.max}" style="border:0;padding:0;margin:16px 0">
          <div class="group-head"><h3>${esc(g.name)}</h3>
            ${g.min > 0 ? `<span class="req">${g.max > 1 ? `יש לבחור ${g.min}` : 'חובה'}</span>` : `<span class="opt">${g.max > 1 ? `עד ${g.max} אפשרויות` : 'אופציונלי'}</span>`}</div>
          ${g.choices.map((c, j) => `<label class="choice">
            <input type="${g.max === 1 ? 'radio' : 'checkbox'}" name="${g.key}" value="${j}" data-group="${esc(g.name)}" data-name="${esc(c.name)}" data-price="${c.price || 0}" ${c.absolute ? 'data-absolute="1"' : ''} ${g.max === 1 && g.min > 0 && j === 0 && g.key === 'variant' ? 'checked' : ''}>
            <span>${esc(c.name)}</span>${c.price ? `<b>${c.absolute ? money(c.price) : `+${money(c.price)}`}</b>` : ''}
          </label>`).join('')}
        </fieldset>`).join('')}
        ${it.ingredients && it.ingredients.length ? `<div class="group">
          <div class="group-head"><h3>להסיר מרכיבים</h3><span class="opt">לחצו על מרכיב כדי להסיר אותו</span></div>
          <div class="chips">${it.ingredients.map((ing) => `<label class="chip-toggle"><input type="checkbox" name="remove" value="${esc(ing)}"><span>${esc(ing)}</span></label>`).join('')}</div>
        </div>` : ''}
        <div class="group"><div class="group-head"><h3>הערות למטבח</h3><span class="opt">אופציונלי</span></div>
          <textarea class="notes" id="item-notes" placeholder="למשל: בלי עירית, רוטב בצד…" maxlength="200"></textarea></div>
      </div>
      <div class="modal-foot">
        <div class="stepper"><button type="button" data-q="-1" aria-label="הפחת">−</button><output id="item-qty">1</output><button type="button" data-q="1" aria-label="הוסף">+</button></div>
        <button class="btn btn-primary" type="button" id="item-add">הוסף לסל · <span id="item-total"></span></button>
      </div>`;
    modal.hidden = false; document.body.style.overflow = 'hidden';
    let qty = 1;
    const basePrice = () => { const v = card.querySelector('input[name="variant"]:checked'); return v ? Number(v.dataset.price) : (it.price || 0); };
    const chosen = () => $$('fieldset.group input:checked', card).filter((i) => !i.dataset.absolute).map((i) => ({ group: i.dataset.group, name: i.dataset.name, price: Number(i.dataset.price) || 0 }));
    const update = () => {
      let valid = true;
      $$('fieldset.group', card).forEach((fs) => {
        const min = Number(fs.dataset.min), max = Number(fs.dataset.max);
        const checked = $$('input:checked', fs).length;
        if (checked < min) valid = false;
        const req = fs.querySelector('.req');
        if (req) { req.classList.toggle('done', checked >= min); if (max > 1) req.textContent = checked >= min ? `נבחרו ${checked}/${max} ✓` : `יש לבחור ${min} (נבחרו ${checked})`; }
        if (max > 1) $$('input', fs).forEach((i) => { i.disabled = !i.checked && checked >= max; });
      });
      const unit = basePrice() + chosen().reduce((s, c) => s + c.price, 0);
      $('#item-total').textContent = money(unit * qty);
      $('#item-qty').textContent = qty;
      $('#item-add').disabled = !valid;
    };
    card.addEventListener('change', update);
    $$('[data-q]', card).forEach((b) => b.addEventListener('click', () => { qty = Math.max(1, Math.min(50, qty + Number(b.dataset.q))); update(); }));
    $('#item-add').addEventListener('click', () => {
      const v = card.querySelector('input[name="variant"]:checked');
      const removed = $$('input[name="remove"]:checked', card).map((i) => i.value);
      addLine({ item: it, variant: v ? { name: v.dataset.name, price: Number(v.dataset.price) } : null, choices: chosen(), notes: $('#item-notes').value, qty, removed, from: $('#item-add') });
      closeModal(modal);
    });
    card.querySelector('[data-close]').addEventListener('click', () => closeModal(modal));
    update();
    (card.querySelector('fieldset.group input:not(:disabled)') || card.querySelector('[data-close]')).focus();
  }
  function closeModal(modal) {
    modal.hidden = true;
    if (!$('#cart').classList.contains('open')) document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // ---------- checkout ----------
  function validPhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.startsWith('972')) d = '0' + d.slice(3);
    return /^(05\d{8}|07\d{8}|0[2-4]\d{7}|0[89]\d{7})$/.test(d) ? d : null;
  }
  function openCheckout() {
    if (!state.cart.length) return;
    lastFocus = document.activeElement;
    const c = state.customer || {};
    const card = $('#checkout-card');
    const prep = (O.prepTimeMinutes || {})[state.service] || 45;
    const open = isOpenNow();
    const now = new Date();
    const defaultTime = new Date(now.getTime() + (prep + 15) * 60000);
    card.innerHTML = `
      <div class="modal-head"><div><h2 id="checkout-title">פרטי ההזמנה</h2><p>${cartCount()} פריטים · ${money(total())}</p></div>
        <button class="icon-btn" type="button" data-close aria-label="סגור">✕</button></div>
      <form class="modal-body" id="checkout-form" novalidate>
        ${CHANNELS_CONFIGURED ? '' : `<div class="demo-banner">מצב הדגמה: ההזמנה לא תישלח למסעדה עד שיוגדר ערוץ שליחה (WhatsApp / כתובת שרת / אימייל) בקובץ <code>js/config.js</code>. בסיום תוצג ההזמנה כטקסט להעתקה.</div>`}
        <div class="checkout-grid">
          <div>
            ${(O.deliveryEnabled !== false && O.pickupEnabled !== false) ? `<div class="segment" id="co-service" style="margin-bottom:14px">
              <button type="button" data-service="delivery" aria-pressed="${state.service === 'delivery'}">🛵 משלוח</button>
              <button type="button" data-service="pickup" aria-pressed="${state.service === 'pickup'}">🥢 איסוף עצמי</button></div>` : ''}
            <div class="form-grid">
              <div class="field"><label for="co-name">שם מלא *</label><input id="co-name" name="name" autocomplete="name" value="${esc(c.name || '')}" required><div class="err">נא להזין שם</div></div>
              <div class="field"><label for="co-phone">טלפון נייד *</label><input id="co-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" style="text-align:end" value="${esc(c.phone || '')}" required><div class="err">נא להזין מספר טלפון ישראלי תקין</div></div>
              <div id="co-address" class="full form-grid" style="gap:12px">
                <div class="field"><label for="co-street">רחוב *</label><input id="co-street" name="street" autocomplete="address-line1" value="${esc(c.street || '')}"><div class="err">נא להזין רחוב</div></div>
                <div class="field"><label for="co-house">מספר בית *</label><input id="co-house" name="house" inputmode="numeric" value="${esc(c.house || '')}"><div class="err">נא להזין מספר</div></div>
                <div class="field"><label for="co-apt">כניסה / קומה / דירה</label><input id="co-apt" name="apt" value="${esc(c.apt || '')}" placeholder="כניסה ב׳, קומה 3, דירה 12"></div>
                <div class="field"><label for="co-city">עיר *</label>
                  ${(O.deliveryCities || []).length > 1 ? `<select id="co-city" name="city">${(O.deliveryCities || []).map((ct) => `<option ${c.city === ct ? 'selected' : ''}>${esc(ct)}</option>`).join('')}</select>` : `<input id="co-city" name="city" value="${esc((O.deliveryCities || [])[0] || c.city || '')}" ${(O.deliveryCities || []).length === 1 ? 'readonly' : ''}>`}
                  <div class="err">נא להזין עיר</div></div>
              </div>
              <div class="field full"><label>מועד ${state.service === 'delivery' ? 'המשלוח' : 'האיסוף'}</label>
                <div class="radio-row" id="co-when">
                  <label><input type="radio" name="when" value="asap" ${open ? 'checked' : 'disabled'}> <span id="co-asap-label">בהקדם האפשרי${prep ? ` (כ-${prep} דק׳)` : ''}</span></label>
                  <label><input type="radio" name="when" value="scheduled" ${open ? '' : 'checked'}> בשעה מסוימת</label>
                </div>
                <div class="time-row" id="co-time-row" ${open ? 'hidden' : ''}>
                  <select id="co-day" name="day"><option value="0">היום</option><option value="1">מחר</option></select>
                  <input id="co-time" name="time" type="time" step="900" value="${pad(defaultTime.getHours())}:${pad(Math.floor(defaultTime.getMinutes() / 15) * 15)}">
                </div>
                <div class="err" id="co-time-err"></div>
              </div>
              <div class="field full"><label>אמצעי תשלום</label>
                <div class="radio-row">${(O.paymentMethods || [{ id: 'cash', label: 'מזומן' }]).map((p, i) => `<label><input type="radio" name="payment" value="${esc(p.id)}" ${(c.payment ? c.payment === p.id : i === 0) ? 'checked' : ''}> ${esc(p.label)}</label>`).join('')}</div></div>
              <div class="field full"><label for="co-notes">הערות להזמנה</label><textarea id="co-notes" name="notes" class="notes" placeholder="הוראות הגעה, אלרגיות, בקשות מיוחדות…" maxlength="300"></textarea></div>
            </div>
          </div>
          <aside class="summary" id="co-summary"></aside>
        </div>
      </form>
      <div class="modal-foot">
        <button class="btn btn-primary" type="submit" form="checkout-form" id="co-submit"></button>
      </div>`;
    const modal = $('#checkout-modal');
    modal.hidden = false; document.body.style.overflow = 'hidden';
    const form = $('#checkout-form');
    const F = (n) => form.elements[n];
    const refresh = () => {
      $('#co-address').hidden = state.service !== 'delivery';
      const p = (O.prepTimeMinutes || {})[state.service];
      $('#co-asap-label').textContent = `בהקדם האפשרי${p ? ` (כ-${p} דק׳)` : ''}`;
      $('#co-summary').innerHTML = `<h3>סיכום ההזמנה</h3><ul>${state.cart.map((l) => { const it = ITEMS.get(l.id); const o = lineOptionsText(l); return `<li><span>${l.qty} × ${esc(it.name)}${o ? `<small>${esc(o)}</small>` : ''}${l.notes ? `<small>הערה: ${esc(l.notes)}</small>` : ''}</span><span>${money(lineTotal(l))}</span></li>`; }).join('')}</ul>${totalsHtml()}<button class="link-btn" type="button" id="co-edit">עריכת הסל</button>`;
      $('#co-edit').addEventListener('click', () => { closeModal(modal); openCart(); });
      $('#co-submit').innerHTML = O.whatsappNumber ? `שליחת ההזמנה ב-WhatsApp · ${money(total())}` : `שליחת ההזמנה · ${money(total())}`;
    };
    refresh();
    $$('#co-service button').forEach((b) => b.addEventListener('click', () => { setService(b.dataset.service); $$('#co-service button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); refresh(); }));
    $$('input[name="when"]', form).forEach((r) => r.addEventListener('change', () => { $('#co-time-row').hidden = F('when').value !== 'scheduled'; }));
    card.querySelector('[data-close]').addEventListener('click', () => closeModal(modal));
    form.addEventListener('submit', (e) => { e.preventDefault(); submitOrder(form, modal); });
    $('#co-name').focus();
  }

  function scheduledDate(form) {
    const F = (n) => form.elements[n];
    const [h, m] = (F('time').value || '').split(':').map(Number);
    if (Number.isNaN(h)) return null;
    const d = new Date(); d.setDate(d.getDate() + Number(F('day').value)); d.setHours(h, m || 0, 0, 0);
    return d;
  }
  function submitOrder(form, modal) {
    const F = (n) => form.elements[n];
    let ok = true;
    const mark = (id, cond) => { const f = $(id).closest('.field'); f.classList.toggle('invalid', !cond); if (!cond) ok = false; };
    mark('#co-name', F('name').value.trim().length >= 2);
    const phone = validPhone(F('phone').value);
    mark('#co-phone', !!phone);
    if (state.service === 'delivery') {
      mark('#co-street', F('street').value.trim().length >= 2);
      mark('#co-house', F('house').value.trim().length >= 1);
      mark('#co-city', F('city').value.trim().length >= 2);
    }
    const timeErr = $('#co-time-err'); timeErr.style.display = 'none';
    let when = { type: 'asap', label: 'בהקדם האפשרי' };
    if (F('when').value === 'scheduled') {
      const d = scheduledDate(form);
      const prep = (O.prepTimeMinutes || {})[state.service] || 0;
      const earliest = new Date(Date.now() + prep * 60000);
      let msg = '';
      if (!d) msg = 'נא לבחור שעה';
      else if (d < earliest) msg = `זמן ההכנה המינימלי הוא ${prep} דק׳ – נא לבחור שעה מאוחרת יותר`;
      else if (!isOpenAt(d)) msg = `המסעדה סגורה בשעה זו. שעות הפעילות: ${hoursText()}`;
      if (msg) { timeErr.textContent = msg; timeErr.style.display = 'block'; ok = false; }
      else when = { type: 'scheduled', at: d.toISOString(), label: `${Number(F('day').value) ? 'מחר' : 'היום'} בשעה ${pad(d.getHours())}:${pad(d.getMinutes())}` };
    }
    if (!ok) { const first = $('.field.invalid input, .field.invalid select', form) || $('#co-time'); first?.focus(); return; }

    const customer = { name: F('name').value.trim(), phone, street: F('street').value.trim(), house: F('house').value.trim(), apt: F('apt').value.trim(), city: F('city').value.trim(), payment: F('payment').value };
    state.customer = customer; save('one-customer', customer);
    const payment = (O.paymentMethods || []).find((p) => p.id === F('payment').value);
    const order = {
      number: `ONE-${Date.now().toString(36).toUpperCase().slice(-6)}`,
      createdAt: new Date().toISOString(),
      service: state.service,
      when,
      customer: { name: customer.name, phone: customer.phone },
      address: state.service === 'delivery' ? { street: customer.street, house: customer.house, apt: customer.apt, city: customer.city } : null,
      payment: payment ? payment.label : F('payment').value,
      notes: F('notes').value.trim(),
      items: state.cart.map((l) => ({ id: l.id, name: ITEMS.get(l.id).name, qty: l.qty, unitPrice: lineUnit(l), total: lineTotal(l), variant: l.variant ? l.variant.name : null, choices: (l.choices || []).map((c) => ({ group: c.group, name: c.name, price: c.price || 0 })), removed: l.removed || [], notes: l.notes || '' })),
      subtotal: subtotal(), deliveryFee: deliveryFee(), total: total(), currency: CUR,
    };
    const text = orderText(order);
    save('one-last-order', { order, text });

    // WhatsApp must be opened synchronously inside the click/submit event to avoid popup blockers.
    let waUrl = null;
    if (O.whatsappNumber) {
      waUrl = `https://wa.me/${String(O.whatsappNumber).replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
      window.open(waUrl, '_blank', 'noopener');
    }
    const btn = $('#co-submit'); btn.disabled = true; btn.textContent = 'שולח…';
    const finish = (sent, err) => { showSuccess(modal, order, text, waUrl, sent, err); };
    if (O.orderEndpoint) {
      fetch(O.orderEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order) })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); finish(true); })
        .catch((e) => finish(false, e));
    } else if (O.orderEmail && !waUrl) {
      window.location.href = `mailto:${O.orderEmail}?subject=${encodeURIComponent(`הזמנה ${order.number} – ${order.customer.name}`)}&body=${encodeURIComponent(text)}`;
      finish(true);
    } else finish(!!waUrl);
  }
  function showSuccess(modal, order, text, waUrl, sent, err) {
    const card = $('#checkout-card');
    const failed = O.orderEndpoint && !sent;
    card.innerHTML = `<div class="modal-body success">
      <div class="check">${failed ? '⚠️' : '✓'}</div>
      <h2>${failed ? 'ההזמנה לא נשלחה לשרת' : CHANNELS_CONFIGURED ? 'ההזמנה נשלחה!' : 'ההזמנה מוכנה'}</h2>
      <p>מספר הזמנה <b>${esc(order.number)}</b></p>
      ${failed ? `<div class="notice err">אירעה שגיאה בשליחה (${esc(err && err.message)}). אנא התקשרו למסעדה: <a href="tel:${esc((R.phone || '').replace(/[^\d+]/g, ''))}">${esc(R.phone || '')}</a>${waUrl ? ' או שלחו את ההזמנה ב-WhatsApp.' : '.'}</div>` : ''}
      ${!CHANNELS_CONFIGURED ? `<div class="demo-banner">מצב הדגמה – לא הוגדר ערוץ שליחה. זהו הטקסט שהיה נשלח למסעדה:</div>` : `<p>${order.service === 'delivery' ? 'המשלוח יצא אליכם' : 'ההזמנה תהיה מוכנה לאיסוף'} ${esc(order.when.label)}. ${O.whatsappNumber ? 'המסעדה תאשר את ההזמנה בהודעה חוזרת.' : ''}</p>`}
      <div class="order-text" id="order-text">${esc(text)}</div>
      <div class="actions">
        ${waUrl ? `<a class="btn btn-wa" href="${esc(waUrl)}" target="_blank" rel="noopener">פתיחת ההזמנה ב-WhatsApp (אם לא נפתח אוטומטית)</a>` : ''}
        <button class="btn btn-ghost" type="button" id="copy-order">העתקת ההזמנה</button>
        <a class="btn btn-ghost" href="tel:${esc((R.phone || '').replace(/[^\d+]/g, ''))}">התקשרו למסעדה ${esc(R.phone || '')}</a>
        <button class="btn btn-dark" type="button" id="done">סיום וחזרה לתפריט</button>
      </div></div>`;
    $('#copy-order').addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); toast('ההזמנה הועתקה'); } catch { toast('לא ניתן להעתיק אוטומטית'); } });
    $('#done').addEventListener('click', () => { closeModal(modal); });
    if (!failed) { state.cart = []; persistCart(); }
  }
  function orderText(o) {
    const L = [];
    L.push(`🍣 הזמנה חדשה – ${R.name || 'one סושי בר'}`);
    L.push(`מס׳ הזמנה: ${o.number}`);
    L.push(`סוג: ${o.service === 'delivery' ? 'משלוח 🛵' : 'איסוף עצמי 🥢'}`);
    L.push(`שם: ${o.customer.name}`);
    L.push(`טלפון: ${o.customer.phone}`);
    if (o.address) L.push(`כתובת: ${o.address.street} ${o.address.house}${o.address.apt ? `, ${o.address.apt}` : ''}, ${o.address.city}`);
    L.push(`מועד: ${o.when.label}`);
    L.push(`תשלום: ${o.payment}`);
    L.push('――――――――――');
    o.items.forEach((it) => {
      const opts = [it.variant, ...it.choices.map((c) => c.name + (c.price ? ` +${money(c.price)}` : '')), ...(it.removed || []).map((r) => `בלי ${r}`)].filter(Boolean);
      L.push(`${it.qty} × ${it.name}${opts.length ? ` (${opts.join(', ')})` : ''} – ${money(it.total)}`);
      if (it.notes) L.push(`   הערה: ${it.notes}`);
    });
    L.push('――――――――――');
    L.push(`סכום ביניים: ${money(o.subtotal)}`);
    if (o.service === 'delivery') L.push(`משלוח: ${o.deliveryFee ? money(o.deliveryFee) : 'חינם'}`);
    L.push(`סה״כ: ${money(o.total)}`);
    if (o.notes) L.push(`הערות: ${o.notes}`);
    return L.join('\n');
  }

  // ---------- wiring ----------
  function init() {
    renderChrome();
    renderStatus();
    renderPills();
    renderFeatured();
    renderMenu();
    renderCartBits();
    initParallax();
    $('#menu').addEventListener('click', onMenuClick);
    $('#menu').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('item')) { e.preventDefault(); onMenuClick(e); } });
    $('#featured-strip').addEventListener('click', onFeaturedClick);
    $('#featured-strip').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('fcard')) { e.preventDefault(); onFeaturedClick(e); } });
    $('#cart-btn').addEventListener('click', openCart);
    $('#bottombar-btn').addEventListener('click', openCart);
    $('#cart-close').addEventListener('click', closeCart);
    $('#scrim').addEventListener('click', closeCart);
    $('#cart-body').addEventListener('click', onCartClick);
    let searchTimer;
    $('#search').addEventListener('input', (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = e.target.value; renderMenu(); }, 120); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#item-modal').hidden) closeModal($('#item-modal'));
      else if (!$('#checkout-modal').hidden) closeModal($('#checkout-modal'));
      else if ($('#cart').classList.contains('open')) closeCart();
    });
    $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); }));
    let ticking = false;
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { updateActivePill(); ticking = false; }); } }, { passive: true });
    setInterval(renderStatus, 60000);
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
