import { CONFIG } from './config.js';
import { prefs as storage, titleFromFile, keyFromFile } from './util.js';
import * as store from './store.js';
import { BookLoader } from './loader.js';
import * as ui from './ui.js';
import { initPwa } from './pwa.js';

const $ = (sel) => document.querySelector(sel);
const viewEl = $('#view');

const state = {
  books: [],
  listState: 'loading', // loading | ready | error
  loader: null,
  query: '',
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
  if (seg[0] === 'b' && seg[1]) {
    return { name: 'book', key: seg[1], c: int(seg[2]), s: int(seg[3]), p: new URLSearchParams(qs || '').get('p') };
  }
  return { name: 'home' };
}

let lastRouteSig = '';

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

  if (route.name === 'home') {
    html = ui.booksView({ books: state.books, listState: state.listState, query: state.query });
  } else if (state.listState === 'loading') {
    html = ui.bookPendingView({ title: 'પુસ્તકાલય', status: 'loading', file: '' });
    pending = true;
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
          const reader = ui.readerView({ book, chapterIndex, subIndex, prefs: state.prefs });
          html = reader.html;
          title = `${reader.title} • ${book.title}`;
          readerOpen = true;
          searchVisible = false;
        }
      }
    }
  }

  viewEl.innerHTML = html;
  viewEl.dataset.pending = pending ? '1' : '';
  document.title = title;
  document.body.classList.toggle('has-reader-bar', readerOpen);
  $('#search-container').hidden = !searchVisible;
  $('#breadcrumbs').innerHTML = ui.breadcrumbs({
    book: book && book.loaded ? book : null,
    chapterIndex,
    subIndex,
    onHome: route.name === 'home',
  });
  const crumbs = $('#breadcrumbs');
  crumbs.scrollLeft = crumbs.scrollWidth;

  const sig = location.hash.split('?')[0];
  if (scroll && sig !== lastRouteSig) {
    window.scrollTo(0, 0);
    viewEl.focus({ preventScroll: true });
  }
  lastRouteSig = sig;

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
    render({ scroll: false }); // બુકના નામ તરત દેખાય
    state.loader.start(); // પછી બેકગ્રાઉન્ડમાં બુક
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

/* ---------- ક્લિક / ઇનપુટ ---------- */
function setFontSize(next) {
  const { min, max } = CONFIG.font;
  state.prefs.fontSize = Math.min(max, Math.max(min, next));
  storage.set('sp.fs', state.prefs.fontSize);
  const body = $('#reader-body');
  if (body) body.style.fontSize = `${state.prefs.fontSize}px`;
  document.querySelectorAll('[data-role="font-size"]').forEach((el, i) => {
    el.textContent = el.closest('.reader-bar') ? state.prefs.fontSize : `${state.prefs.fontSize}px`;
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
searchInput.addEventListener('input', () => {
  state.query = searchInput.value.trim();
  $('#clear-search').hidden = !state.query;
  render({ scroll: false });
});
$('#clear-search').addEventListener('click', () => {
  searchInput.value = '';
  state.query = '';
  $('#clear-search').hidden = true;
  render({ scroll: false });
  searchInput.focus();
});

window.addEventListener('hashchange', () => {
  if (state.query) {
    state.query = '';
    searchInput.value = '';
    $('#clear-search').hidden = true;
  }
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
syncOnlineBadge();
initPwa({ toast });
loadLibrary();
