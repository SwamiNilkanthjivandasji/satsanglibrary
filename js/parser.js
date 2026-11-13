// XML -> માળખું. બે પ્રકારની બુક સંભાળે છે:
//   1) <chapter><chapter_name/><sub_chapter><sub_chapter_name/><content/></sub_chapter></chapter>
//   2) <chapter><chapter_name/><content/></chapter>
// લખાણ બદલાતું નથી. ફક્ત [id = ...] માર્કર લખાણમાંથી કાઢીને ફકરા સાથે data-id તરીકે જોડાય છે.

const ID_MARKER = /\[\s*id\s*=\s*([^\]\r\n]+?)\s*\]/g;

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#039;': "'" };
const decodeEntities = (s) => s.replace(/&(amp|lt|gt|quot|apos|#039);/g, (m) => ENTITIES[m] || m);

export function cleanCdata(raw) {
  if (!raw) return '';
  return raw.replace(/^\s*<!\[CDATA\[/i, '').replace(/\]\]>\s*$/i, '').trim();
}

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

function chapterFrom(title, subChapters, content) {
  return {
    title,
    hasSubChapters: subChapters.length > 0,
    subChapters,
    content: subChapters.length > 0 ? '' : content,
  };
}

function parseWithDom(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return [];

  return Array.from(doc.getElementsByTagName('chapter')).map((chapNode, cIdx) => {
    const nameEl = chapNode.getElementsByTagName('chapter_name')[0];
    const title = nameEl ? collapse(nameEl.textContent) : `પ્રકરણ ${cIdx + 1}`;

    const subs = Array.from(chapNode.getElementsByTagName('sub_chapter')).map((subNode, sIdx) => {
      const subNameEl = subNode.getElementsByTagName('sub_chapter_name')[0];
      const rawName = subNameEl ? subNameEl.textContent : `પેટા-પ્રકરણ ${sIdx + 1}`;

      // <sub_chapter> માં <sub_chapter_name> પહેલાં આવેલું લખાણ (દા.ત. "1.") શીર્ષકનો ભાગ ગણાય
      let prefix = '';
      for (const child of subNode.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) prefix += child.textContent + ' ';
        else if (child.nodeName.toLowerCase() === 'sub_chapter_name') break;
      }

      const contentEl = subNode.getElementsByTagName('content')[0];
      return {
        title: collapse(`${prefix} ${rawName}`),
        content: contentEl ? cleanCdata(contentEl.textContent) : '',
      };
    });

    const contentEl = chapNode.getElementsByTagName('content')[0];
    return chapterFrom(title, subs, contentEl ? cleanCdata(contentEl.textContent) : '');
  });
}

// XML માં નાની ભૂલ (દા.ત. CDATA બહાર '&') હોય ત્યારે DOMParser નિષ્ફળ જાય; તો આ regex રસ્તો.
function parseWithRegex(xml) {
  const blocks = xml.match(/<chapter\b[^>]*>[\s\S]*?<\/chapter>/gi) || [];
  return blocks.map((block, cIdx) => {
    const nameM = block.match(/<chapter_name\b[^>]*>([\s\S]*?)<\/chapter_name>/i);
    const title = nameM ? collapse(decodeEntities(cleanCdata(nameM[1]))) : `પ્રકરણ ${cIdx + 1}`;

    const subs = (block.match(/<sub_chapter\b[^>]*>[\s\S]*?<\/sub_chapter>/gi) || []).map((sub, sIdx) => {
      const prefixM = sub.match(/<sub_chapter\b[^>]*>([\s\S]*?)<sub_chapter_name/i);
      const nameM2 = sub.match(/<sub_chapter_name\b[^>]*>([\s\S]*?)<\/sub_chapter_name>/i);
      const rawName = nameM2 ? decodeEntities(cleanCdata(nameM2[1])) : `પેટા-પ્રકરણ ${sIdx + 1}`;
      const contentM = sub.match(/<content\b[^>]*>([\s\S]*?)<\/content>/i);
      return {
        title: collapse(`${prefixM ? prefixM[1] : ''} ${rawName}`),
        content: contentM ? cleanCdata(contentM[1]) : '',
      };
    });

    const contentM = block.match(/<content\b[^>]*>([\s\S]*?)<\/content>/i);
    return chapterFrom(title, subs, contentM ? cleanCdata(contentM[1]) : '');
  });
}

export function parseBookXml(xmlString) {
  const xml = String(xmlString || '').replace(/^﻿/, '').trim();
  let chapters = parseWithDom(xml);
  if (chapters.length === 0) chapters = parseWithRegex(xml);
  return chapters;
}

export function summarize(chapters) {
  const subTotal = chapters.reduce((n, c) => n + c.subChapters.length, 0);
  return { chapterCount: chapters.length, subChapterCount: subTotal, nested: subTotal > 0 };
}

const QUESTION_HEADER = /^[“”"'‘’]?\s*પ્રશ્ન\s*[“”"'‘’]?$/;
const normalizeForCompare = (s) => collapse(s.replace(/[“”"'‘’]/g, ''));

// લખાણ -> ફકરાની યાદી [{ text, id, kind }]
//  - [id = ...] માર્કર લખાણમાંથી કાઢી નાખીને id તરીકે રાખે છે
//  - પહેલી લીટી શીર્ષક જેવી જ હોય તો હટાવે છે (શીર્ષક બે વાર ન દેખાય)
//  - શ્લોક (।।) અને "પ્રશ્ન" લીટીને kind = 'highlight' આપે છે
export function toBlocks(raw, title) {
  if (!raw) return [];
  const wantedTitle = normalizeForCompare(title || '');
  const blocks = [];
  let isFirstLine = true;

  for (const rawLine of raw.split(/\r?\n/)) {
    let id = null;
    const line = rawLine
      .replace(ID_MARKER, (_m, g) => {
        if (!id) id = g.trim();
        return '';
      })
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    if (!line) {
      // માર્કર એકલો એક લીટીમાં હોય તો તેને આગલા ફકરા સાથે જોડો
      if (id && blocks.length && !blocks[blocks.length - 1].id) blocks[blocks.length - 1].id = id;
      continue;
    }

    if (isFirstLine) {
      isFirstLine = false;
      if (normalizeForCompare(line) === wantedTitle) continue;
    }

    const highlight = line.includes('।।') || QUESTION_HEADER.test(line);
    blocks.push({ text: line, id, kind: highlight ? 'highlight' : 'text' });
  }
  return blocks;
}
