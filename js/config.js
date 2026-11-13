// કેન્દ્રીય સેટિંગ્સ. પાથ બદલવા હોય તો ફક્ત અહીં બદલવા.
export const CONFIG = {
  appName: 'સત્સંગ પુસ્તકાલય',
  booksBase: 'books/',
  booksIndex: 'books/books.json',
  // દરેક XML માટે: કેટલી વાર પ્રયત્ન કરવો, અને પ્રયત્નો વચ્ચે રાહ (બમણી થતી જાય છે)
  retry: { attempts: 3, baseDelayMs: 800, timeoutMs: 90000 },
  storage: { dbName: 'satsang-library', storeName: 'kv', version: 1 },
  font: { min: 14, max: 32, step: 2, mobileDefault: 18, desktopDefault: 20 },
  toastMs: 4500,
};
