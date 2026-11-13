import { CONFIG } from './config.js';
import { prefs as storage, titleFromFile, keyFromFile } from './util.js';
import * as store from './store.js';
import { BookLoader } from './loader.js';
import * as ui from './ui.js';
import { initPwa } from './pwa.js';
import { runSearch, MIN_LENGTH } from './search.js';

const $ = (sel) => document.querySelector(sel);
const viewEl = $('#view');

/* ---------- છેલ્લે વાંચેલી જગ્યા (આ ઉપકરણ પૂરતી, localStorage) ---------- */
const LAST_KEY = 'sp.last';
function readLast() {
  try {
    return JSON.parse(storage.get(LAST_KEY, '') || 'null');
  } catch (_) {
    return null;
  }
}
const writeLast = (rec) => storage.set(LAST_KEY, JSON.stringify(rec));
const scrollRatio = () => {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
};
function saveScroll() {
  if (!document.body.classList.contains('reader-open')) return;
  const rec = readLast();
  if (!rec) return;
  rec.r = scrollRatio();
  writeLast(rec);
}
let scrollTimer = null;
window.addEventListener('scroll', () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(saveScroll, 300);
}, { passive: true });
window.addEventListener('pagehide', saveScroll);

const state = {
  books: [],
  listState: 'loading', // loading | ready | error
  loader: null,
  query: '',
  search: null, // { q, status: 'running' | 'done' | 'short', progress, result }
  searchToken: null,
  prefs: {
    theme: storage.get('sp.theme', 'sepia'),
    fontSize: Number(storage.get('sp.fs', window.innerWidth < 640 ? CONFIG.font.mobileDefault : CONFIG.font.desktopDefault)),
    serif: storage.get('sp.serif', '1') === '1',
  },
};

/* ---------- ટોસ્ટ ---------- */
let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  $('#toast-message').textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), CONFIG.toastMs);
}

/* ---------- થીમ ---------- */
function applyTheme(theme) {
  state.prefs.theme = theme;
  document.documentElement.dataset.theme = theme;
  storage.set('sp.theme', theme);
  document.querySelectorAll('[data-theme-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeBtn === theme)));
  const color = getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim();
  if (color) $('meta[name="theme-color"]').setAttribute('content', color);
}

/* ---------- routing ---------- */
function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  let seg;
  try {
    seg = path.split('/').filter(Boolean).map(decodeURIComponent);
  } catch (_) {
    seg = [];
  }
  const int = (v) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
  if (seg[0] === 'search') {
    return { name: 'search', q: (new URLSearchParams(qs || '').get('q') || '').trim() };
  }
  if (seg[0] === 'b' && seg[1]) {
    const q = new URLSearchParams(qs || '');
    return { name: 'book', key: seg[1], c: int(seg[2]), s: int(seg[3]), p: q.get('p'), h: q.get('h') || '', resume: q.get('resume') === '1' };
  }
  return { name: 'home' };
}

let lastRouteSig = '';
let lastReaderKey = '';

function render({ scroll = true } = {}) {
  const route = parseRoute();
  const book = route.name === 'book' ? state.books.find((b) => b.key === route.key) : null;
  let chapterIndex = null;
  let subIndex = null;
  let html = '';
  let title = CONFIG.appName;
  let readerOpen = false;
  let searchVisible = true;
  let pending = false;
  let readerTitle = '';

  if (route.name === 'home') {
    html = ui.booksView({ books: state.books, listState: state.listState, query: state.query, last: readLast() });
  } else if (state.listState === 'loading') {
    html = ui.bookPendingView({ title: route.name === 'search' ? 'શોધ' : 'પુસ્તકાલય', status: 'loading', file: '' });
    pending = true;
  } else if (route.name === 'search') {
    title = `“${route.q}” • શોધ • ${CONFIG.appName}`;
    ensureSearch(route.q);
    html = ui.searchView({ search: state.search, query: route.q });
  } else if (!book) {
    html = ui.notFoundView();
  } else {
    title = `${book.title} • ${CONFIG.appName}`;
    if (!book.loaded) {
      // ક્લિક કરેલી બુકને લોડિંગમાં પ્રાયોરિટી. 'error' માં આપમેળે ફરી નહીં (અનંત લૂપ ટાળવા); ત્યાં "ફરી પ્રયત્ન" બટન છે.
      if (book.status !== 'error') state.loader.prioritize(book.file);
      html = ui.bookPendingView(book);
      pending = true;
      searchVisible = false;
    } else {
      const chap = route.c !== null ? book.chapters[route.c] : null;
      if (route.c === null || !chap) {
        html = ui.chaptersView({ book, query: state.query });
      } else {
        chapterIndex = route.c;
        const sub = chap.hasSubChapters && route.s !== null ? chap.subChapters[route.s] : null;
        if (chap.hasSubChapters && !sub) {
          html = ui.subChaptersView({ book, chapterIndex, query: state.query });
          title = `${chap.title} • ${book.title}`;
        } else {
          subIndex = sub ? route.s : null;
          const reader = ui.readerView({ book, chapterIndex, subIndex, prefs: state.prefs, highlight: route.h });
          html = reader.html;
          title = `${reader.title} • ${book.title}`;
          readerTitle = reader.title;
          readerOpen = true;
          searchVisible = false;
        }
      }
    }
  }

  viewEl.innerHTML = html;
  viewEl.dataset.pending = pending ? '1' : '';
  document.title = title;
  document.body.classList.toggle('reader-open', readerOpen);
  $('#search-container').hidden = !searchVisible;
  $('#breadcrumbs').innerHTML = ui.breadcrumbs({
    book: book && book.loaded ? book : null,
    chapterIndex,
    subIndex,
    onHome: route.name === 'home',
    searching: route.name === 'search',
  });
  const crumbs = $('#breadcrumbs');
  crumbs.scrollLeft = crumbs.scrollWidth;

  const sig = location.hash.split('?')[0];
  if (scroll && sig !== lastRouteSig) {
    window.scrollTo(0, 0);
    viewEl.focus({ preventScroll: true });
  }
  lastRouteSig = sig;

  // છેલ્લે વાંચેલી જગ્યા સાચવો. "આગળ વાંચો" થી આવ્યા હોઈએ તો સ્ક્રોલ સ્થાન પણ પાછું લાવો.
  const readerKey = readerOpen ? `${book.key}/${chapterIndex}/${subIndex}` : '';
  if (readerOpen && readerKey !== lastReaderKey) {
    const prev = readLast();
    const same = prev && prev.key === book.key && prev.c === chapterIndex && prev.s === subIndex;
    const r = same && route.resume ? prev.r || 0 : 0; // સામાન્ય રીતે ખોલ્યું હોય તો ટોચથી શરૂ
    writeLast({ key: book.key, c: chapterIndex, s: subIndex, bookTitle: book.title, title: readerTitle, r, t: Date.now() });
    if (route.resume && same && r > 0.01 && !route.p) {
      requestAnimationFrame(() => window.scrollTo(0, r * (document.documentElement.scrollHeight - window.innerHeight)));
    }
  }
  lastReaderKey = readerKey;

  // શોધમાંથી આવ્યા હોઈએ તો પહેલા મળેલા શબ્દ પર લઈ જાઓ
  if (readerOpen && route.h && !route.p && !route.resume) {
    const first = viewEl.querySelector('#reader-body mark');
    if (first) first.scrollIntoView({ block: 'center' });
  }

  // ફકરાની id પર સીધી લિંક: #/b/…/c/s?p=<id>
  if (readerOpen && route.p) {
    const target = Array.from(viewEl.querySelectorAll('[data-id]')).find((n) => n.dataset.id === route.p);
    if (target) {
      target.scrollIntoView({ block: 'center' });
      target.classList.add('is-flash');
    }
  }
}

/* ---------- બુક યાદી (books.json) ---------- */
function normalizeList(json) {
  if (!Array.isArray(json)) throw new Error('books.json એક યાદી હોવી જોઈએ');
  return json
    .map((item) => {
      const rawFile = typeof item === 'string' ? item : item && (item.file || item.xmlPath);
      if (!rawFile) return null;
      const file = String(rawFile).replace(/^\/?books\//, '');
      return {
        file,
        key: keyFromFile(file),
        title: (typeof item === 'object' && item.title) || titleFromFile(file),
      };
    })
    .filter(Boolean);
}

async function fetchBookList() {
  try {
    const res = await fetch(CONFIG.booksIndex, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = normalizeList(await res.json());
    store.set('list', list);
    return list;
  } catch (err) {
    const cached = await store.get('list'); // ઓફલાઇન: છેલ્લી સેવ કરેલી યાદી
    if (cached && cached.length) return cached;
    throw err;
  }
}

async function loadLibrary() {
  state.listState = 'loading';
  render({ scroll: false });
  try {
    const list = await fetchBookList();
    state.books = list.map((b) => ({ ...b }));
    state.loader = new BookLoader(state.books, onBookChange);
    state.listState = 'ready';
    state.loader.start(); // સેવ કરેલી બુક તરત તૈયાર, પછી બાકીની બેકગ્રાઉન્ડમાં
    render({ scroll: false }); // બુકના નામ તરત દેખાય
  } catch (_) {
    state.listState = 'error';
    render({ scroll: false });
  }
}

/* ---------- લોડર બદલાય ત્યારે ફક્ત જરૂરી ભાગ જ ફરી દોરવો ---------- */
function onBookChange(book, type) {
  const route = parseRoute();

  if (type === 'updated') {
    toast(`“${book.title}” નવી આવૃત્તિ સાથે અપડેટ થઈ.`);
  }

  if (route.name === 'home') {
    const card = viewEl.querySelector(`.book-card[data-file="${CSS.escape(book.file)}"]`);
    if (card) {
      card.outerHTML = ui.bookCard(book);
    } else if (state.query) {
      render({ scroll: false }); // શોધ પ્રકરણના નામ પર પણ ચાલે, તેથી યાદી બદલાઈ શકે
    }
    return;
  }

  if (route.key === book.key) {
    // આ બુક લોડ થવાની રાહ જોવાતી હતી, અથવા તેની સામગ્રી અપડેટ થઈ: ફરી દોરો. બીજા ફેરફારો અવગણો.
    if (viewEl.dataset.pending === '1' || type === 'updated') render({ scroll: false });
  }
}

/* ---------- લખાણ શોધ (Enter દબાવે ત્યારે જ) ---------- */
function ensureSearch(q) {
  if (state.search && state.search.q === q) return;
  if (state.searchToken) state.searchToken.cancelled = true;
  if (q.length < MIN_LENGTH) {
    state.search = { q, status: 'short' };
    return;
  }
  const token = { cancelled: false };
  state.searchToken = token;
  state.search = { q, status: 'running' };

  (async () => {
    await (state.loader && state.loader.hydrated ? state.loader.hydrated : Promise.resolve());
    const result = await runSearch(state.books, q, token, (done, total, bookTitle) => {
      const el = document.getElementById('search-progress');
      if (el && !token.cancelled) el.textContent = `${done + 1}/${total} • ${bookTitle}`;
    });
    if (!result || token.cancelled) return;
    state.search = { q, status: 'done', result };
    if (parseRoute().name === 'search') render({ scroll: false });
  })();
}

function submitSearch() {
  const q = searchInput.value.trim().replace(/\s+/g, ' ');
  if (q.length < MIN_LENGTH) {
    toast('શોધવા માટે ઓછામાં ઓછા 2 અક્ષર લખો.');
    return;
  }
  const route = parseRoute();
  if (route.name === 'search' && route.q === q) {
    state.search = null; // એ જ શબ્દ ફરી: નવેસરથી શોધો
    render({ scroll: false });
  } else {
    location.hash = `#/search?q=${encodeURIComponent(q)}`;
  }
  searchInput.blur();
}

function syncSearchInput() {
  const route = parseRoute();
  if (route.name === 'search') {
    searchInput.value = route.q;
    state.query = '';
    $('#clear-search').hidden = !route.q;
  } else if (state.query) {
    state.query = '';
    searchInput.value = '';
    $('#clear-search').hidden = true;
  }
}

/* ---------- ક્લિક / ઇનપુટ ---------- */
function setFontSize(next) {
  const { min, max } = CONFIG.font;
  state.prefs.fontSize = Math.min(max, Math.max(min, next));
  storage.set('sp.fs', state.prefs.fontSize);
  const body = $('#reader-body');
  if (body) body.style.fontSize = `${state.prefs.fontSize}px`;
  document.querySelectorAll('[data-role="font-size"]').forEach((el) => {
    el.textContent = `${state.prefs.fontSize}px`;
  });
}

async function copyReader() {
  const title = $('.paper__title')?.textContent || '';
  const text = `${title}\n\n${$('#reader-body')?.innerText || ''}`;
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (__) {
      toast('કોપી થઈ શક્યું નહીં.');
      ta.remove();
      return;
    }
    ta.remove();
  }
  toast('લખાણ કોપી થઈ ગયું છે.');
}

const actions = {
  'font-smaller': () => setFontSize(state.prefs.fontSize - CONFIG.font.step),
  'font-bigger': () => setFontSize(state.prefs.fontSize + CONFIG.font.step),
  'toggle-font-family': () => {
    state.prefs.serif = !state.prefs.serif;
    storage.set('sp.serif', state.prefs.serif ? '1' : '0');
    render({ scroll: false });
  },
  copy: copyReader,
  retry: (el) => state.loader && state.loader.retry(el.dataset.file),
  'reload-list': () => loadLibrary(),
  'search-again': () => {
    state.search = null;
    render({ scroll: false });
  },
  'hide-toast': () => ($('#toast').hidden = true),
};

document.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (actionEl && actions[actionEl.dataset.action]) {
    e.preventDefault();
    actions[actionEl.dataset.action](actionEl);
    return;
  }
  const themeEl = e.target.closest('[data-theme-btn]');
  if (themeEl) {
    applyTheme(themeEl.dataset.themeBtn);
    return;
  }
  // આગળ/પાછળ બટન: ઇતિહાસ ન વધે (બ્રાઉઝર Back સીધું યાદી પર લઈ જાય)
  const nav = e.target.closest('a[data-nav="replace"]');
  if (nav && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
    e.preventDefault();
    location.replace(nav.getAttribute('href'));
  }
});

const searchInput = $('#search-input');
// ટાઇપ કરતી વખતે ફક્ત પુસ્તક/પ્રકરણના નામ ગાળે છે (હલકું). લખાણમાં શોધ Enter દબાવ્યા પછી.
searchInput.addEventListener('input', () => {
  $('#clear-search').hidden = !searchInput.value.trim();
  if (parseRoute().name === 'search') return;
  state.query = searchInput.value.trim();
  render({ scroll: false });
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    submitSearch();
  }
});
$('#clear-search').addEventListener('click', () => {
  searchInput.value = '';
  state.query = '';
  $('#clear-search').hidden = true;
  if (parseRoute().name !== 'search') render({ scroll: false });
  searchInput.focus();
});

window.addEventListener('hashchange', () => {
  syncSearchInput();
  render();
});

/* ---------- ઓફલાઇન સૂચક ---------- */
function syncOnlineBadge() {
  $('#offline-badge').hidden = navigator.onLine;
}
window.addEventListener('offline', syncOnlineBadge);
window.addEventListener('online', () => {
  syncOnlineBadge();
  if (state.listState === 'error') loadLibrary();
  else if (state.loader) state.loader.resync();
});

/* ---------- શરૂઆત ---------- */
applyTheme(state.prefs.theme);
syncSearchInput();
syncOnlineBadge();
initPwa({ toast });
loadLibrary();
