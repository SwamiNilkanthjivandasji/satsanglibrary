// બુક લોડર.
//  1) books.json આવે એટલે નામ તરત દેખાય (આ ફાઇલમાં નથી, app.js માં).
//  2) અહીં: પહેલાં બ્રાઉઝરમાં સેવ કરેલી બુક તરત તૈયાર, પછી બાકીની બુક એક પછી એક બેકગ્રાઉન્ડમાં.
//  3) યુઝર કોઈ બુક પર ક્લિક કરે તો તે કતારમાં સૌથી આગળ; જો બીજી બુક અત્યારે લોડ થતી હોય તો
//     તેની રાહ જોયા વગર ક્લિક કરેલી બુક અલગથી તરત fetch થાય. (બેકગ્રાઉન્ડમાં તે જ બુક ચાલુ હોય તો ફરી fetch નહીં.)
//  4) સર્વર પરથી હંમેશા ફરી ચકાસે (no-cache). XML બદલાઈ હોય તો સેવ કરેલી નકલ પણ બદલાય.
//  5) ઇન્ટરનેટ ન હોય તો સેવ કરેલી નકલ ચાલુ રહે.
import { CONFIG } from './config.js';
import * as store from './store.js';
import { parseBookXml, summarize } from './parser.js';
import { sleep } from './util.js';

const cacheKey = (file) => `book:${file}`;
const bookUrl = (file) => CONFIG.booksBase + encodeURIComponent(file);

function loadError(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

export class BookLoader {
  // books: [{ file, key, title, status, chapters, ... }]   onChange(book, type)  type: 'status' | 'updated'
  constructor(books, onChange) {
    this.books = books;
    this.byFile = new Map(books.map((b) => [b.file, b]));
    this.onChange = onChange || (() => {});
    this.queue = [];
    this.inflight = new Map();
    this.draining = false;
    this.hydrated = null;
    for (const b of books) Object.assign(b, { status: 'queued', loaded: false, saved: false, refreshing: false, error: null, chapters: [], stats: null });
  }

  _set(book, patch, type = 'status') {
    Object.assign(book, patch);
    this.onChange(book, type);
  }

  start() {
    this.hydrated = Promise.all(this.books.map((b) => this._hydrate(b)));
    return this.hydrated.then(() => {
      // જે બુક હજી નથી તે પહેલાં, સેવ કરેલી બુકની તાજગી ચકાસણી પછી
      this.queue = [...this.books.filter((b) => !b.loaded), ...this.books.filter((b) => b.loaded)].map((b) => b.file);
      this._drain();
    });
  }

  // બ્રાઉઝરમાં સેવ કરેલી નકલ હોય તો તરત તૈયાર કરો
  async _hydrate(book) {
    const rec = await store.get(cacheKey(book.file));
    if (!rec || !rec.xml) return;
    try {
      const chapters = parseBookXml(rec.xml);
      if (chapters.length === 0) return;
      this._set(book, { chapters, stats: summarize(chapters), status: 'ready', loaded: true, saved: true, fromCache: true });
    } catch (_) {
      /* ખરાબ નકલ: નેટવર્કથી ફરી લાવશે */
    }
  }

  async _drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const file = this.queue.shift();
        await this._run(file).catch(() => {});
      }
    } finally {
      this.draining = false;
    }
  }

  // યુઝરે બુક ખોલી: સૌથી આગળ. તૈયાર હોય તો તરત; નહીં તો અલગથી તરત fetch.
  prioritize(file) {
    const book = this.byFile.get(file);
    if (!book) return Promise.resolve(null);
    const i = this.queue.indexOf(file);
    if (i >= 0) this.queue.splice(i, 1);
    if (book.loaded) return Promise.resolve(book);
    return this._run(file).catch(() => book);
  }

  retry(file) {
    return this.prioritize(file);
  }

  // ઇન્ટરનેટ પાછું આવે ત્યારે: નિષ્ફળ બુક અને બાકી બધી ફરી ચકાસો
  resync() {
    const failed = this.books.filter((b) => !b.loaded);
    const rest = this.books.filter((b) => b.loaded);
    this.queue = [...failed, ...rest].map((b) => b.file).filter((f) => !this.inflight.has(f));
    this._drain();
  }

  _run(file) {
    if (this.inflight.has(file)) return this.inflight.get(file);
    const book = this.byFile.get(file);
    const p = (this.hydrated || Promise.resolve())
      .then(() => this._load(book))
      .finally(() => this.inflight.delete(file));
    this.inflight.set(file, p);
    return p;
  }

  async _load(book) {
    const hadData = book.loaded;
    if (hadData) this._set(book, { refreshing: true });
    else this._set(book, { status: 'loading', error: null });

    try {
      const xml = await this._fetchXml(bookUrl(book.file));
      const rec = await store.get(cacheKey(book.file));

      if (hadData && rec && rec.xml === xml) {
        this._set(book, { refreshing: false, status: 'ready' });
        return book;
      }

      const chapters = parseBookXml(xml);
      if (chapters.length === 0) throw loadError('invalid', 'કોઈ <chapter> મળ્યું નહીં');

      const saved = await store.set(cacheKey(book.file), { xml, savedAt: Date.now() });
      if (saved) store.requestPersistence();

      this._set(book, { chapters, stats: summarize(chapters), status: 'ready', loaded: true, saved, refreshing: false, error: null, fromCache: false });
      if (hadData) this.onChange(book, 'updated');
      return book;
    } catch (err) {
      if (hadData) {
        // સેવ કરેલી નકલ ચાલુ રહે; અપડેટ ચકાસણી નિષ્ફળ ગઈ તે શાંતિથી અવગણો
        this._set(book, { refreshing: false, status: 'ready' });
      } else {
        this._set(book, { status: 'error', error: err.code || 'network' });
      }
      throw err;
    }
  }

  async _fetchXml(url) {
    const { attempts, baseDelayMs, timeoutMs } = CONFIG.retry;
    let last;
    for (let i = 0; i < attempts; i++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { cache: 'no-cache', signal: ctrl.signal });
        if (res.status === 404) throw Object.assign(loadError('notfound', 'ફાઇલ મળી નથી'), { fatal: true });
        if (!res.ok) throw loadError('http', `HTTP ${res.status}`);
        const text = await res.text();
        // 404 પેજ HTML હોય તો તેને બુક તરીકે સ્વીકારવું નહીં
        if (!/<chapter\b/i.test(text)) throw Object.assign(loadError('invalid', 'XML માન્ય નથી'), { fatal: true });
        return text;
      } catch (e) {
        last = e;
        if (e.fatal) break;
        if (!navigator.onLine) {
          last = loadError('offline', 'ઇન્ટરનેટ નથી');
          break;
        }
        if (!e.code) last = loadError('network', e.message);
        if (i < attempts - 1) await sleep(baseDelayMs * 2 ** i);
      } finally {
        clearTimeout(timer);
      }
    }
    throw last;
  }
}
