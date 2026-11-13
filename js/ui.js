// શુદ્ધ રેન્ડર ફંક્શન: ડેટા -> HTML string. કોઈ global state નહીં.
import { esc } from './util.js';
import { toBlocks } from './parser.js';

const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export const href = (key, c, s) =>
  `#/b/${encodeURIComponent(key)}${c !== null && c !== undefined ? `/${c}` : ''}${s !== null && s !== undefined ? `/${s}` : ''}`;

const ERROR_TEXT = {
  offline: 'ઇન્ટરનેટ નથી અને આ બુક હજી સેવ થઈ નથી.',
  notfound: 'આ બુકની ફાઇલ સર્વર પર મળી નથી.',
  invalid: 'આ બુકની XML ફાઇલ વાંચી શકાઈ નહીં.',
  http: 'સર્વરે જવાબ આપ્યો નહીં.',
  network: 'બુક લોડ થઈ નહીં.',
};
export const errorText = (code) => ERROR_TEXT[code] || ERROR_TEXT.network;

/* ---------- બુક લાઇબ્રેરી ---------- */

function statusChip(book) {
  switch (book.status) {
    case 'loading':
      return `<span class="chip chip--busy"><span class="spinner" aria-hidden="true"></span>લોડ થઈ રહ્યું છે…</span>`;
    case 'error':
      return `<span class="chip chip--error">${icon('alert')}લોડ ન થયું</span>
              <button class="link-btn" type="button" data-action="retry" data-file="${esc(book.file)}">${icon('refresh')}ફરી પ્રયત્ન</button>`;
    case 'ready':
      return `<span class="chip chip--ok">${icon('check')}${book.saved ? 'ઓફલાઇન તૈયાર' : 'તૈયાર'}</span>`;
    default:
      return `<span class="chip chip--muted">કતારમાં</span>`;
  }
}

function countsLabel(book) {
  if (book.status !== 'ready' || !book.stats) return 'પ્રકરણો વાંચવા માટે ખોલો';
  const { chapterCount, subChapterCount, nested } = book.stats;
  return nested ? `${chapterCount} પ્રકરણ • ${subChapterCount} પેટા-પ્રકરણ` : `${chapterCount} પ્રકરણો`;
}

export function bookCard(book) {
  return `
    <article class="book-card" data-file="${esc(book.file)}">
      <a class="book-card__main" href="${href(book.key)}">
        <div class="book-cover" aria-hidden="true"><span class="book-cover__spine"></span>${icon('book')}</div>
        <div class="book-card__text">
          <h3 class="book-card__title">${esc(book.title)}</h3>
          <p class="book-card__meta">${esc(countsLabel(book))}</p>
        </div>
        ${icon('chevron-right', 'book-card__go')}
      </a>
      <div class="book-card__foot">${statusChip(book)}</div>
    </article>`;
}

function resumeBanner(last, books) {
  if (!last || !books.some((b) => b.key === last.key)) return '';
  const to = `${href(last.key, last.c, last.s)}?resume=1`;
  return `
    <a class="resume" href="${to}">
      <span class="resume__icon">${icon('book-open')}</span>
      <span class="resume__text">
        <span class="resume__label">આગળ વાંચો</span>
        <span class="resume__title">${esc(last.bookTitle || '')}${last.title ? ` • ${esc(last.title)}` : ''}</span>
      </span>
      ${icon('chevron-right', 'resume__go')}
    </a>`;
}

export function booksView({ books, listState, query, last }) {
  const head = (count) => `
    <div class="page-head">
      <div>
        <h2 class="page-head__title">ગ્રંથો અને પુસ્તકો</h2>
        <p class="page-head__sub">વાંચવા માટે પુસ્તક પસંદ કરો</p>
      </div>
      ${count === null ? '' : `<span class="pill">કુલ ${count} પુસ્તકો</span>`}
    </div>`;

  if (listState === 'loading') {
    return `${head(null)}<div class="book-grid" aria-busy="true">${'<div class="book-card skeleton"></div>'.repeat(3)}</div>`;
  }
  if (listState === 'error') {
    return `${head(null)}
      <div class="panel panel--center">
        ${icon('alert', 'panel__icon')}
        <p class="panel__title">પુસ્તકોની યાદી લોડ થઈ નહીં</p>
        <p class="panel__text">ઇન્ટરનેટ તપાસીને ફરી પ્રયત્ન કરો.</p>
        <button class="btn btn--primary" type="button" data-action="reload-list">${icon('refresh')}ફરી પ્રયત્ન કરો</button>
      </div>`;
  }

  const q = query.toLowerCase();
  const shown = books.filter(
    (b) => !q || b.title.toLowerCase().includes(q) || b.chapters.some((c) => c.title.toLowerCase().includes(q)),
  );
  if (shown.length === 0) {
    return `${head(0)}<div class="panel panel--center">${icon('search', 'panel__icon')}<p class="panel__title">કોઈ પુસ્તક મળ્યું નથી</p><p class="panel__text">અન્ય શબ્દ લખીને ફરી શોધો</p></div>`;
  }
  return `${head(shown.length)}${query ? '' : resumeBanner(last, books)}<div class="book-grid" id="books-grid">${shown.map(bookCard).join('')}</div>`;
}

/* ---------- પુસ્તક ખૂલતી વખતે (હજી લોડ નથી) ---------- */

export function bookPendingView(book) {
  if (book.status === 'error') {
    return `
      <div class="panel panel--center">
        ${icon('alert', 'panel__icon')}
        <p class="panel__title">${esc(book.title)}</p>
        <p class="panel__text">${esc(errorText(book.error))}</p>
        <div class="btn-row">
          <button class="btn btn--primary" type="button" data-action="retry" data-file="${esc(book.file)}">${icon('refresh')}ફરી પ્રયત્ન કરો</button>
          <a class="btn" href="#/">પુસ્તકાલય</a>
        </div>
      </div>`;
  }
  return `
    <div class="panel panel--center" aria-busy="true">
      <span class="spinner spinner--lg" aria-hidden="true"></span>
      <p class="panel__title">${esc(book.title)}</p>
      <p class="panel__text">બુક લોડ થઈ રહી છે… કૃપા કરીને થોડી રાહ જુઓ</p>
    </div>`;
}

export const notFoundView = () => `
  <div class="panel panel--center">
    ${icon('search', 'panel__icon')}
    <p class="panel__title">પુસ્તક મળ્યું નથી</p>
    <a class="btn btn--primary" href="#/">પુસ્તકાલય પર જાઓ</a>
  </div>`;

/* ---------- પ્રકરણ યાદી ---------- */

const emptyResult = (text) => `<div class="panel panel--center"><p class="panel__title">${text}</p></div>`;

export function chaptersView({ book, query }) {
  const q = query.toLowerCase();
  const rows = book.chapters
    .map((chap, idx) => ({ chap, idx }))
    .filter(
      ({ chap }) =>
        !q || chap.title.toLowerCase().includes(q) || chap.subChapters.some((s) => s.title.toLowerCase().includes(q)),
    );

  const items = rows
    .map(({ chap, idx }) => {
      const badge = chap.hasSubChapters
        ? `<span class="chip chip--accent">${icon('list')}${chap.subChapters.length} પેટા-પ્રકરણ</span>`
        : `<span class="chip chip--muted">${icon('file')}સીધું વાંચન</span>`;
      return `
        <a class="list-item" href="${href(book.key, idx)}">
          <span class="list-item__num">${idx + 1}</span>
          <span class="list-item__body">
            <span class="list-item__title">${esc(chap.title)}</span>
            <span class="list-item__badge">${badge}</span>
          </span>
          ${icon('chevron-right', 'list-item__go')}
        </a>`;
    })
    .join('');

  return `
    <div class="page-head page-head--card">
      <a class="icon-btn" href="#/" aria-label="પાછા જાઓ">${icon('arrow-left')}</a>
      <div class="page-head__grow">
        <span class="chip chip--accent">અનુક્રમણિકા</span>
        <h2 class="page-head__title">${esc(book.title)}</h2>
        <p class="page-head__sub">${esc(countsLabel(book))}</p>
      </div>
    </div>
    <div class="list">${items || emptyResult('કોઈ પ્રકરણ મળ્યું નથી')}</div>`;
}

export function subChaptersView({ book, chapterIndex, query }) {
  const chapter = book.chapters[chapterIndex];
  const q = query.toLowerCase();
  const rows = chapter.subChapters
    .map((sub, idx) => ({ sub, idx }))
    .filter(({ sub }) => !q || sub.title.toLowerCase().includes(q) || sub.content.toLowerCase().includes(q));

  const items = rows
    .map(
      ({ sub, idx }) => `
        <a class="list-item" href="${href(book.key, chapterIndex, idx)}">
          <span class="list-item__num list-item__num--soft">${idx + 1}</span>
          <span class="list-item__body"><span class="list-item__title list-item__title--sm">${esc(sub.title)}</span></span>
          <span class="list-item__read">વાંચો</span>
          ${icon('chevron-right', 'list-item__go')}
        </a>`,
    )
    .join('');

  return `
    <div class="page-head page-head--card">
      <a class="icon-btn" href="${href(book.key)}" aria-label="પ્રકરણ યાદી પર પાછા જાઓ">${icon('arrow-left')}</a>
      <div class="page-head__grow">
        <span class="page-head__eyebrow">${esc(book.title)}</span>
        <h2 class="page-head__title">${esc(chapter.title)}</h2>
        <p class="page-head__sub">${chapter.subChapters.length} પેટા-પ્રકરણ • વાંચવા માટે પસંદ કરો</p>
      </div>
    </div>
    <div class="list">${items || emptyResult('કોઈ પેટા-પ્રકરણ મળ્યું નથી')}</div>`;
}

/* ---------- વાંચન ---------- */

// આખી બુકનો સળંગ વાંચન ક્રમ: પેટા-પ્રકરણ હોય તો દરેક પેટા-પ્રકરણ, નહીં તો પ્રકરણ.
// "અગાઉનું/આગળનું" આ ક્રમમાં ચાલે છે, એટલે પ્રકરણ બદલાય ત્યારે પણ બટન ચાલુ રહે.
function sequenceOf(book) {
  if (book._seqFor !== book.chapters) {
    const seq = [];
    book.chapters.forEach((c, ci) => {
      if (c.hasSubChapters) c.subChapters.forEach((sub, si) => seq.push({ ci, si, title: sub.title, chapterTitle: c.title }));
      else seq.push({ ci, si: null, title: c.title, chapterTitle: c.title });
    });
    book._seq = seq;
    book._seqFor = book.chapters;
  }
  return book._seq;
}

export function readerView({ book, chapterIndex, subIndex, prefs }) {
  const chapter = book.chapters[chapterIndex];
  const hasSub = chapter.hasSubChapters && subIndex !== null && chapter.subChapters[subIndex];

  let title, raw, meta, backHref, backText, prev = null, next = null;

  if (hasSub) {
    const sub = chapter.subChapters[subIndex];
    title = sub.title;
    raw = sub.content;
    meta = `${book.title} • ${chapter.title}`;
    backHref = href(book.key, chapterIndex);
    backText = 'પેટા-પ્રકરણ યાદી';
  } else {
    title = chapter.title;
    raw = chapter.content;
    meta = book.title;
    backHref = href(book.key);
    backText = 'પ્રકરણ યાદી';
  }

  const seq = sequenceOf(book);
  const currentSi = hasSub ? subIndex : null;
  const pos = seq.findIndex((x) => x.ci === chapterIndex && x.si === currentSi);
  const neighbor = (item) =>
    item && {
      // બીજા પ્રકરણમાં જતું હોય તો પ્રકરણનું નામ પણ બતાવો
      title: item.ci !== chapterIndex && item.chapterTitle !== item.title ? `${item.chapterTitle} • ${item.title}` : item.title,
      to: href(book.key, item.ci, item.si),
    };
  prev = pos > 0 ? neighbor(seq[pos - 1]) : null;
  next = pos >= 0 && pos < seq.length - 1 ? neighbor(seq[pos + 1]) : null;

  const blocks = toBlocks(raw, title);
  const body = blocks.length
    ? blocks
        .map((b) => {
          const idAttr = b.id ? ` data-id="${esc(b.id)}"` : '';
          return b.kind === 'highlight'
            ? `<div class="shloka"${idAttr}>${esc(b.text)}</div>`
            : `<p${idAttr}>${esc(b.text)}</p>`;
        })
        .join('')
    : `<p class="muted center">આ પ્રકરણમાં કોઈ લખાણ ઉપલબ્ધ નથી.</p>`;

  const controls = (mobile) => `
    <button class="btn btn--sm" type="button" data-action="toggle-font-family" aria-pressed="${prefs.serif}">
      ${prefs.serif ? (mobile ? 'સેરિફ' : 'સેરિફ ફોન્ટ') : mobile ? 'સાદા' : 'સાદા ફોન્ટ'}
    </button>
    <div class="stepper" role="group" aria-label="અક્ષરનું કદ">
      <button type="button" data-action="font-smaller" aria-label="અક્ષર નાના કરો">A−</button>
      <span class="stepper__value" data-role="font-size">${prefs.fontSize}${mobile ? '' : 'px'}</span>
      <button type="button" data-action="font-bigger" aria-label="અક્ષર મોટા કરો">A+</button>
    </div>
    <button class="icon-btn icon-btn--sm" type="button" data-action="copy" aria-label="લખાણ કોપી કરો">${icon('copy')}</button>`;

  const pager = (item, dir) =>
    item
      ? `<a class="pager__btn pager__btn--${dir}" href="${item.to}" data-nav="replace">
           ${dir === 'prev' ? icon('chevron-left') : ''}
           <span class="pager__text"><span class="pager__label">${dir === 'prev' ? 'અગાઉનું' : 'આગળનું'}</span><span class="pager__title">${esc(item.title)}</span></span>
           ${dir === 'next' ? icon('chevron-right') : ''}
         </a>`
      : `<span class="pager__btn pager__btn--${dir} is-disabled" aria-disabled="true">
           ${dir === 'prev' ? icon('chevron-left') : ''}
           <span class="pager__text"><span class="pager__label">${dir === 'prev' ? 'અગાઉનું' : 'આગળનું'}</span><span class="pager__title">${dir === 'prev' ? 'આ પ્રથમ છે' : 'આ છેલ્લું છે'}</span></span>
           ${dir === 'next' ? icon('chevron-right') : ''}
         </span>`;

  return {
    title,
    html: `
      <div class="reader">
        <div class="reader__toolbar">
          <a class="btn" href="${backHref}">${icon('arrow-left')}<span>${backText}</span></a>
          <div class="reader__controls">${controls(false)}</div>
        </div>
        <article class="paper">
          <header class="paper__head">
            <p class="paper__meta">${esc(meta)}</p>
            <h1 class="paper__title">${esc(title)}</h1>
          </header>
          <div id="reader-body" class="reader-body ${prefs.serif ? 'is-serif' : 'is-sans'}" style="font-size:${prefs.fontSize}px">${body}</div>
        </article>
        <nav class="pager" aria-label="અગાઉનું / આગળનું">${pager(prev, 'prev')}${pager(next, 'next')}</nav>
        <div class="reader-bar" role="toolbar" aria-label="વાંચન સેટિંગ્સ">
          <a class="btn btn--sm" href="${backHref}">${icon('arrow-left')}<span>પાછા</span></a>
          <div class="reader__controls">${controls(true)}</div>
        </div>
      </div>`,
  };
}

/* ---------- breadcrumbs ---------- */

export function breadcrumbs({ book, chapterIndex, subIndex, onHome }) {
  const sep = icon('chevron-right', 'crumb__sep');
  const parts = [
    `<a class="crumb ${onHome ? 'is-current' : ''}" href="#/">${icon('library')}<span>પુસ્તકાલય</span></a>`,
  ];
  if (book) {
    const chapter = chapterIndex !== null ? book.chapters[chapterIndex] : null;
    const bookIsLast = chapterIndex === null;
    parts.push(sep, `<a class="crumb ${bookIsLast ? 'is-current' : ''}" href="${href(book.key)}">${esc(book.title)}</a>`);
    if (chapter) {
      const chapterIsLast = !(chapter.hasSubChapters && subIndex !== null);
      parts.push(sep, `<a class="crumb ${chapterIsLast ? 'is-current' : ''}" href="${href(book.key, chapterIndex)}">${esc(chapter.title)}</a>`);
      if (!chapterIsLast && chapter.subChapters[subIndex]) {
        parts.push(sep, `<span class="crumb is-current">${esc(chapter.subChapters[subIndex].title)}</span>`);
      }
    }
  }
  return parts.join('');
}
