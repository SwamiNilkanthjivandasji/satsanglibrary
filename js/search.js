// લખાણ શોધ. યુઝર Enter દબાવે ત્યારે જ ચાલે; ટાઇપ કરતી વખતે નહીં.
//  - ફક્ત લોડ થયેલી બુકમાં શોધે (બાકીની બુક પરિણામ પેજ પર જણાવાય છે)
//  - કામ નાના ટુકડામાં થાય અને વચ્ચે બ્રાઉઝરને શ્વાસ આપે, એટલે મોટી બુકમાં પણ સ્ક્રીન અટકતી નથી
//  - શબ્દ જેમ લખ્યો તેમ (phrase) શોધાય; અક્ષરોની મોટી/નાની (Latin) ફરક ગણાતો નથી
//  - વાંચનમાં જે લખાણ દેખાય છે તે જ શોધાય: [id = …] માર્કર અને લખાણની શરૂઆતમાં આવતું બેવડું શીર્ષક બહાર
import { toBlocks } from './parser.js';

export const MIN_LENGTH = 2;
export const MAX_ITEMS = 150; // યાદીમાં વધુમાં વધુ આટલા પ્રકરણ/પેટા-પ્રકરણ બતાવવા

const SNIPPET_BEFORE = 60;
const SNIPPET_AFTER = 90;
const WORK_SLICE_MS = 10;

export const normalize = (s) =>
  String(s || '')
    .normalize('NFC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// દરેક પ્રકરણ/પેટા-પ્રકરણનું "શોધવા લાયક" લખાણ એકવાર બનાવીને સાચવાય. બુક ફરી parse થાય તો જૂનું આપમેળે ફેંકાય.
const textCache = new WeakMap();
function searchableText(item) {
  let t = textCache.get(item);
  if (t === undefined) {
    t = normalize(
      toBlocks(item.content, item.title)
        .map((b) => b.text)
        .join(' '),
    );
    textCache.set(item, t);
  }
  return t;
}

const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeSnippet(text, index, length) {
  let start = Math.max(0, index - SNIPPET_BEFORE);
  let end = Math.min(text.length, index + length + SNIPPET_AFTER);
  if (start > 0) {
    const sp = text.indexOf(' ', start);
    if (sp !== -1 && sp < index) start = sp + 1;
  }
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end);
    if (sp > index + length) end = sp;
  }
  return {
    before: (start > 0 ? '… ' : '') + text.slice(start, index),
    match: text.slice(index, index + length),
    after: text.slice(index + length, end) + (end < text.length ? ' …' : ''),
  };
}

// token: { cancelled: boolean }. નવી શોધ શરૂ થાય ત્યારે જૂની શોધનો token cancelled કરવો.
// પરત: પરિણામ object, અથવા રદ થઈ હોય તો null.
export async function runSearch(books, rawQuery, token, onProgress) {
  const q = normalize(rawQuery);
  const loaded = books.filter((b) => b.loaded);
  const notLoaded = books.filter((b) => !b.loaded).map((b) => b.title);
  const groups = [];
  let matchedItems = 0;
  let listedItems = 0;
  let totalMatches = 0;
  let sliceStart = performance.now();

  for (let bi = 0; bi < loaded.length; bi++) {
    const book = loaded[bi];
    const hits = [];
    if (onProgress) onProgress(bi, loaded.length, book.title);

    for (let ci = 0; ci < book.chapters.length; ci++) {
      const chapter = book.chapters[ci];
      const units = chapter.hasSubChapters
        ? chapter.subChapters.map((item, si) => ({ item, si }))
        : [{ item: chapter, si: null }];

      for (const { item, si } of units) {
        if (performance.now() - sliceStart > WORK_SLICE_MS) {
          await yieldToMain();
          if (token.cancelled) return null;
          sliceStart = performance.now();
        }
        const text = searchableText(item);
        const first = text.indexOf(q);
        if (first < 0) continue;

        let count = 0;
        for (let from = first; from >= 0; from = text.indexOf(q, from + q.length)) count++;
        matchedItems++;
        totalMatches += count;
        if (listedItems >= MAX_ITEMS) continue; // ગણતરી ચાલુ, યાદી કાપેલી
        listedItems++;
        hits.push({ ci, si, title: item.title, chapterTitle: chapter.title, count, snippet: makeSnippet(text, first, q.length) });
      }
    }
    if (hits.length) groups.push({ book, hits });
  }
  if (token.cancelled) return null;

  return {
    query: rawQuery.trim().replace(/\s+/g, ' '),
    groups,
    matchedItems,
    listedItems,
    totalMatches,
    truncated: matchedItems > listedItems,
    searchedBooks: loaded.length,
    notLoaded,
  };
}
