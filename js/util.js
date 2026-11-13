export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// localStorage ક્યારેક બંધ/ખાલી હોઈ શકે (private mode વગેરે), એટલે બધું try/catch માં.
export const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (_) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (_) {
      /* અવગણો */
    }
  },
};

// "અક્ષરાનંદ_સ્વામીની_વાતો.xml" -> "અક્ષરાનંદ સ્વામીની વાતો"
export function titleFromFile(file) {
  return String(file || '')
    .split('/')
    .pop()
    .replace(/\.xml$/i, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function keyFromFile(file) {
  return String(file || '').replace(/\.xml$/i, '');
}
