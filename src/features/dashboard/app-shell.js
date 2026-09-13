const VERSION_RE = /^[0-9a-f]{7,40}$/i;
const SCROLL_KEY = 'bsn-ui-scroll-v1';
export const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown';
export const navigation = [
  { href: 'index.html', icon: 'crm', label: 'Điều hành CRM' },
  { href: 'marketing.html', icon: 'marketing', label: 'Marketing' },
  { href: 'settings.html', icon: 'data', label: 'Dữ liệu' }
];
function renderNavigation() {
  const current = location.pathname.split('/').pop() || 'index.html';
  for (const [selector, base] of [['.main-tabs-container', 'main-tab'], ['.mobile-bottom-nav', 'nav-item']]) {
    const element = document.querySelector(selector);
    if (!element) continue;
    element.innerHTML = navigation.map(item => `<a href="${item.href}" class="${base}${item.href === current ? ` ${base}--active` : ''}"${item.href === current ? ' aria-current="page"' : ''}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="/icons/navigation.svg#${item.icon}"></use></svg><span>${item.label}</span></a>`).join('');
  }
}

function banner(kind, message, action) {
  let el = document.querySelector(`[data-app-banner="${kind}"]`);
  if (!el) {
    el = document.createElement('div'); el.dataset.appBanner = kind;
    el.className = `app-shell-banner app-shell-banner--${kind}`;
    el.innerHTML = '<span class="app-shell-banner__text"></span><button class="btn btn--secondary" type="button"></button>';
    (document.querySelector('.dashboard') || document.body).prepend(el);
  }
  el.querySelector('.app-shell-banner__text').textContent = message;
  const button = el.querySelector('button'); button.hidden = !action; if (action) { button.textContent = action.label; button.onclick = action.onClick; }
  return el;
}
function setOffline(disabled) {
  document.querySelectorAll('[data-action="telegram-record"], [data-telegram-send], [data-action="telegram-share"]').forEach(button => {
    if (disabled) { button.dataset.offlineDisabled = 'true'; button.disabled = true; button.title = 'Cần kết nối mạng để gửi Telegram'; }
    else if (button.dataset.offlineDisabled) { button.disabled = false; delete button.dataset.offlineDisabled; button.title = button.getAttribute('aria-label') || 'Gửi Telegram'; }
  });
}
export function restoreScroll() {
  if (restoreScroll.done) return;
  restoreScroll.done = true;
  try { const key = location.pathname + location.hash; const saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}')[key]; if (Number.isFinite(saved)) requestAnimationFrame(() => requestAnimationFrame(() => scrollTo(0, saved))); } catch {}
}
function saveScroll() { try { const all = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}'); all[location.pathname + location.hash] = scrollY; sessionStorage.setItem(SCROLL_KEY, JSON.stringify(all)); } catch {} }
export function initAppShell({ refresh, lastSuccess, isBusy = () => false } = {}) {
  renderNavigation();
  let refreshing = false;
  let checking = false;
  async function refreshIfStale() {
    const stamp = lastSuccess?.();
    const last = typeof stamp === 'string' ? Date.parse(stamp) : Number(stamp || 0);
    if (!navigator.onLine || document.hidden || refreshing || isBusy() || Date.now() - (last || 0) <= 300000 || !refresh) return;
    refreshing = true;
    try { await refresh(); } catch {} finally { refreshing = false; }
  }
  window.addEventListener('pagehide', saveScroll, { once: false });
  const updateConnectivity = () => { const offline = !navigator.onLine; setOffline(offline); if (offline) banner('offline', 'Đang ngoại tuyến. Kết nối mạng để tải dữ liệu mới hoặc gửi Telegram.'); else document.querySelector('[data-app-banner="offline"]')?.remove(); };
  window.addEventListener('offline', updateConnectivity); window.addEventListener('online', () => { updateConnectivity(); refreshIfStale(); checkVersion(); });
  updateConnectivity();
  const checkVersion = async () => {
    if (checking || !navigator.onLine || document.hidden) return;
    checking = true;
    try {
      const res = await fetch('/api/version', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!res.ok) return;
      const value = (await res.json()).version;
      if (!VERSION_RE.test(value || '') || !VERSION_RE.test(appVersion) || value === appVersion) return;
      banner('update', 'Có phiên bản mới của BSN CRM.', { label: 'Cập nhật', onClick: () => { if (!isBusy()) { saveScroll(); location.reload(); } } });
      updateBusy();
    } catch {} finally { checking = false; }
  };
  const updateBusy = () => { const button = document.querySelector('[data-app-banner="update"] button'); if (button) button.disabled = Boolean(isBusy()); };
  window.addEventListener('bsn:busy-change', updateBusy);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateConnectivity(); refreshIfStale(); checkVersion(); updateBusy(); } });
  document.addEventListener('click', event => {
    if (!navigator.onLine && event.target.closest('[data-action="telegram-record"], [data-telegram-send], [data-action="telegram-share"]')) { event.preventDefault(); event.stopImmediatePropagation(); updateConnectivity(); }
  }, true);
  checkVersion(); const timer = setInterval(() => { checkVersion(); refreshIfStale(); }, 300000);
  // The interval stays alive in bfcache and resumes without duplicate initialization.
  const observer = new MutationObserver(() => { if (!navigator.onLine) setOffline(true); }); observer.observe(document.body, { childList: true, subtree: true });
  return () => { clearInterval(timer); observer.disconnect(); };
}
