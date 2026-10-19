(() => {
  const app = document.getElementById('app');
  const live = document.getElementById('live');
  const state = { me: null, sub: null, cfg: { brand: 'Stillwater Yoga', priceLabel: '', paypal: {} }, classes: null };

  /* ---------- helpers ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return el;
  }
  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null; try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error((data && data.error) || 'Something went wrong. Please try again.');
    return data;
  }
  function show(title, node) {
    app.replaceChildren(node);
    document.title = `${title} · ${state.cfg.brand}`;
    const h1 = app.querySelector('h1');
    if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    live.textContent = title;
    window.scrollTo(0, 0);
    document.querySelectorAll('#nav a').forEach((a) => {
      a.getAttribute('href') === location.hash.split('/').slice(0, 2).join('/') ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
    });
  }
  const go = (hash) => { location.hash = hash; };
  function setBusy(btn, busy, label) { btn.disabled = busy; if (label) btn.textContent = busy ? label : btn.dataset.label; }

  async function refreshMe() {
    try { const r = await api('/me'); state.me = r.user; state.sub = r.subscription; }
    catch { state.me = null; state.sub = null; }
    renderNav();
  }
  function renderNav() {
    const nav = document.getElementById('nav');
    nav.replaceChildren(
      h('a', { href: '#/classes' }, 'Classes'),
      h('a', { href: '#/pricing' }, 'Membership'),
      state.me ? h('a', { href: '#/account' }, 'Account') : h('a', { href: '#/login' }, 'Sign in'),
      state.me ? null : h('a', { class: 'btn btn-small', href: '#/signup' }, 'Join now')
    );
  }
  const isMember = () => !!(state.sub && state.sub.active);

  /* ---------- components ---------- */
  function classCard(c) {
    const thumb = h('div', { class: 'thumb', 'data-style': c.style, 'aria-hidden': 'true' }, c.style);
    if (c.thumb_key) thumb.style.backgroundImage = `url(/api/thumb/${encodeURIComponent(c.id)})`;
    return h('li', {}, h('article', { class: 'card' },
      h('a', { class: 'card-link', href: `#/class/${c.slug}` }, thumb,
        h('div', { class: 'card-body' },
          c.is_free_preview ? h('span', { class: 'badge' }, 'Free preview') : null,
          h('h3', {}, c.title),
          h('span', { class: 'meta' }, `${c.duration_min} min, ${c.level}, ${c.style}`),
          h('p', {}, c.description)))));
  }
  async function loadClasses() {
    if (!state.classes) state.classes = (await api('/classes')).classes;
    return state.classes;
  }
  function field(id, label, attrs, hint) {
    return h('div', {}, h('label', { for: id }, label), h('input', { id, name: id, required: true, ...attrs }),
      hint ? h('p', { class: 'hint', id: id + '-hint' }, hint) : null);
  }

  /* ---------- pages ---------- */
  async function home() {
    const classes = await loadClasses().catch(() => []);
    show('Yoga classes on your schedule', h('div', {},
      h('section', { class: 'hero' },
        h('div', {},
          h('h1', {}, 'Yoga you can start in the next five minutes'),
          h('p', { class: 'lead' }, 'Pre-recorded classes for every level. Watch on your phone, tablet or computer, whenever it suits you.'),
          h('div', { class: 'actions' },
            h('a', { class: 'btn', href: state.me ? '#/classes' : '#/signup' }, state.me ? 'Browse classes' : 'Create a free account'),
            h('a', { class: 'btn btn-ghost', href: '#/classes' }, 'See all classes'))),
        h('div', { class: 'breath', 'aria-hidden': 'true' }, h('div', { class: 'ring' }), h('div', { class: 'orb' }),
          h('div', { class: 'cue' }, h('span', { class: 'in' }, 'Breathe in'), h('span', { class: 'out' }, 'Breathe out')))),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', {}, 'Start with a class'), h('a', { href: '#/classes' }, 'All classes')),
        h('ul', { class: 'grid' }, classes.slice(0, 3).map(classCard)))));
  }

  async function classes() {
    const all = await loadClasses();
    const list = h('ul', { class: 'grid' });
    const count = h('p', { class: 'meta', role: 'status' });
    const sel = (id, label, opts) => h('div', {}, h('label', { for: id }, label),
      h('select', { id, onchange: draw }, h('option', { value: '' }, 'Any'), opts.map((o) => h('option', { value: o }, o))));
    const uniq = (k) => [...new Set(all.map((c) => c[k]))];
    const filters = h('div', { class: 'filters' }, sel('f-level', 'Level', uniq('level')), sel('f-style', 'Style', uniq('style')),
      sel('f-len', 'Length', ['Up to 15 min', '16 to 30 min', 'Over 30 min']));
    function draw() {
      const lv = document.getElementById('f-level').value, st = document.getElementById('f-style').value, ln = document.getElementById('f-len').value;
      const out = all.filter((c) => (!lv || c.level === lv) && (!st || c.style === st) &&
        (!ln || (ln.startsWith('Up') ? c.duration_min <= 15 : ln.startsWith('16') ? c.duration_min > 15 && c.duration_min <= 30 : c.duration_min > 30)));
      list.replaceChildren(...out.map(classCard));
      count.textContent = out.length ? `${out.length} ${out.length === 1 ? 'class' : 'classes'}` : 'No classes match. Try changing a filter.';
    }
    show('Classes', h('div', {}, h('h1', {}, 'Classes'), filters, count, list));
    draw();
  }

  async function classPage(slug) {
    let data;
    try { data = await api('/classes/' + encodeURIComponent(slug)); }
    catch (e) { return show('Not found', h('div', {}, h('h1', {}, 'Class not found'), h('p', {}, 'It may have been removed.'), h('a', { class: 'btn', href: '#/classes' }, 'Back to classes'))); }
    const c = data.class;
    let stage;
    if (data.access === 'granted') {
      const v = h('video', { controls: true, controlsList: 'nodownload noremoteplayback', disablepictureinpicture: true, playsinline: true, preload: 'metadata', src: `/api/video/${c.id}`, 'aria-label': c.title });
      v.addEventListener('contextmenu', (e) => e.preventDefault());
      v.addEventListener('error', () => { stage.after(h('p', { class: 'error', role: 'alert' }, 'This video could not be loaded. Check your connection and reload the page.')); });
      stage = h('div', { class: 'player-wrap' }, v);
    } else {
      const login = data.access === 'login';
      stage = h('div', { class: 'locked' }, h('div', { class: 'inner' },
        h('h2', {}, login ? 'Sign in to watch' : 'This class is for members'),
        h('p', {}, login ? 'Create a free account to try the free preview classes, or sign in if you already have one.' : `Get unlimited access to every class for ${state.cfg.priceLabel}. Cancel any time.`),
        h('div', { class: 'actions', style: 'justify-content:center' },
          login ? [h('a', { class: 'btn', href: '#/signup' }, 'Create account'), h('a', { class: 'btn btn-ghost', href: '#/login' }, 'Sign in')]
                : h('a', { class: 'btn', href: '#/pricing' }, 'See membership'))));
    }
    show(c.title, h('div', {}, h('p', {}, h('a', { href: '#/classes' }, 'All classes')), h('h1', {}, c.title),
      h('div', { class: 'class-meta' }, h('span', {}, `${c.duration_min} min`), h('span', {}, c.level), h('span', {}, c.style), h('span', {}, `with ${c.instructor}`)),
      stage, h('div', { class: 'section' }, h('p', {}, c.description))));
  }

  function authPage(mode) {
    const signup = mode === 'signup';
    const err = h('p', { class: 'error', role: 'alert' });
    const btn = h('button', { class: 'btn', type: 'submit', 'data-label': signup ? 'Create account' : 'Sign in' }, signup ? 'Create account' : 'Sign in');
    const form = h('form', { class: 'form', novalidate: true },
      signup ? field('name', 'Name', { autocomplete: 'name' }) : null,
      field('email', 'Email', { type: 'email', autocomplete: 'email' }),
      field('password', 'Password', { type: 'password', autocomplete: signup ? 'new-password' : 'current-password', minlength: 10, 'aria-describedby': signup ? 'password-hint' : null }, signup ? 'At least 10 characters.' : null),
      err, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = '';
      const body = Object.fromEntries(new FormData(form));
      if (!form.checkValidity()) { form.reportValidity(); return; }
      setBusy(btn, true, signup ? 'Creating account…' : 'Signing in…');
      try { await api(signup ? '/auth/signup' : '/auth/login', { body }); await refreshMe(); go(state.next || '#/classes'); state.next = null; }
      catch (ex) { err.textContent = ex.message; setBusy(btn, false, true); }
    });
    show(signup ? 'Create account' : 'Sign in', h('div', { class: 'section' }, h('h1', {}, signup ? 'Create your account' : 'Welcome back'),
      h('div', { class: 'panel' }, form),
      h('p', { style: 'margin-top:1.25rem' }, signup ? 'Already have an account? ' : 'New here? ',
        h('a', { href: signup ? '#/login' : '#/signup' }, signup ? 'Sign in' : 'Create an account'))));
  }

  async function pricing() {
    const body = h('div', { class: 'panel' },
      h('p', { class: 'price' }, state.cfg.priceLabel),
      h('ul', { class: 'checks' }, h('li', {}, 'Unlimited access to every class'), h('li', {}, 'Watch on phone, tablet and computer'), h('li', {}, 'Cancel any time from your account')));
    const msg = h('p', { class: 'error', role: 'alert' });
    if (!state.me) {
      state.next = '#/pricing';
      body.append(h('a', { class: 'btn', href: '#/signup' }, 'Create account to join'), h('p', { class: 'hint' }, 'You will choose card or PayPal on the next step.'));
    } else if (isMember()) {
      body.append(h('p', { class: 'status' }, 'You are a member. Enjoy your practice.'), h('a', { class: 'btn', href: '#/classes' }, 'Browse classes'));
    } else {
      const card = h('button', { class: 'btn', type: 'button', 'data-label': 'Pay by card' }, 'Pay by card');
      card.addEventListener('click', async () => {
        setBusy(card, true, 'Opening checkout…'); msg.textContent = '';
        try { location.href = (await api('/billing/stripe/checkout', { body: {} })).url; }
        catch (e) { msg.textContent = e.message; setBusy(card, false, true); }
      });
      const pp = h('div', { id: 'paypal-btn', 'aria-label': 'Pay with PayPal' });
      body.append(h('div', { class: 'pay' }, card, pp), msg);
      loadPayPal(pp, msg);
    }
    show('Membership', h('div', { class: 'section' }, h('h1', {}, 'One membership, every class'), body));
  }
  function loadPayPal(el, msg) {
    const { clientId, planId } = state.cfg.paypal || {};
    if (!clientId || clientId === 'REPLACE') return;
    const render = () => window.paypal.Buttons({
      style: { layout: 'vertical', shape: 'pill', label: 'subscribe' },
      createSubscription: (_d, actions) => actions.subscription.create({ plan_id: planId, custom_id: state.me.id }),
      onApprove: async (d) => {
        try { await api('/billing/paypal/activate', { body: { subscriptionID: d.subscriptionID } }); await refreshMe(); go('#/welcome'); }
        catch (e) { msg.textContent = e.message; }
      },
      onError: () => { msg.textContent = 'PayPal could not complete the payment. Try again or pay by card.'; },
    }).render(el);
    if (window.paypal) return render();
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&vault=true&intent=subscription`;
    s.onload = render; s.onerror = () => { msg.textContent = 'PayPal is unavailable right now. You can pay by card instead.'; };
    document.head.append(s);
  }

  async function welcome() {
    const status = h('p', { class: 'status', role: 'status' }, 'Confirming your payment…');
    show('Welcome', h('div', { class: 'section' }, h('h1', {}, 'Thanks for joining'), status));
    for (let i = 0; i < 10 && !isMember(); i++) { await refreshMe(); if (!isMember()) await new Promise((r) => setTimeout(r, 2000)); }
    status.replaceChildren(isMember() ? 'Your membership is active.' : 'Your payment is still processing. This can take a minute. Refresh this page shortly.');
    if (isMember()) status.after(h('a', { class: 'btn', href: '#/classes' }, 'Start practicing'));
  }

  function account() {
    if (!state.me) { state.next = '#/account'; return go('#/login'); }
    const msg = h('p', { class: 'error', role: 'alert' });
    const out = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Sign out');
    out.addEventListener('click', async () => { await api('/auth/logout', { body: {} }).catch(() => {}); state.me = null; state.sub = null; renderNav(); go('#/'); });
    const renew = state.sub && state.sub.renewsAt ? new Date(state.sub.renewsAt * 1000).toLocaleDateString(undefined, { dateStyle: 'long' }) : null;
    const manage = state.me.hasStripe ? h('button', { class: 'btn', type: 'button' }, 'Manage card billing') : null;
    if (manage) manage.addEventListener('click', async () => { try { location.href = (await api('/billing/stripe/portal', { body: {} })).url; } catch (e) { msg.textContent = e.message; } });
    show('Account', h('div', { class: 'section' }, h('h1', {}, 'Your account'),
      h('div', { class: 'panel' },
        h('p', {}, h('strong', {}, state.me.name), h('br'), state.me.email),
        h('p', { class: 'status' }, isMember() ? `Membership active${renew ? `. Next billing or end date: ${renew}.` : '.'}` : 'No active membership.'),
        !isMember() ? h('p', {}, h('a', { class: 'btn', href: '#/pricing' }, 'Join now')) : null,
        state.sub && state.sub.provider === 'paypal' ? h('p', { class: 'hint' }, 'Paid with PayPal. Manage or cancel in your PayPal account under Automatic payments.') : null,
        h('div', { class: 'actions' }, manage, out), msg)));
  }

  /* ---------- router ---------- */
  async function route() {
    const [, page = '', arg] = (location.hash.slice(1) || '/').split('/');
    try {
      if (page === '') await home();
      else if (page === 'classes') await classes();
      else if (page === 'class') await classPage(arg);
      else if (page === 'pricing') await pricing();
      else if (page === 'login') authPage('login');
      else if (page === 'signup') authPage('signup');
      else if (page === 'welcome') await welcome();
      else if (page === 'account') account();
      else show('Not found', h('div', {}, h('h1', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
    } catch (e) {
      show('Error', h('div', {}, h('h1', {}, 'Something went wrong'), h('p', { role: 'alert' }, e.message), h('button', { class: 'btn', onclick: () => location.reload() }, 'Reload')));
    }
  }

  (async function boot() {
    document.getElementById('year').textContent = new Date().getFullYear();
    try { state.cfg = await api('/config'); } catch {}
    document.getElementById('brand-name').textContent = state.cfg.brand;
    document.getElementById('brand-foot').textContent = state.cfg.brand;
    await refreshMe();
    window.addEventListener('hashchange', route);
    route();
  })();
})();
