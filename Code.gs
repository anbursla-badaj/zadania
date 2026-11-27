/**
 * Zadania — backend w Google Sheets (Apps Script).
 *
 * Arkusze tworzą się same przy pierwszym użyciu:
 *   Użytkownicy: ID | Imię | Hasło (skrót, nie samo hasło) | Rola (Administrator / Użytkownik) | Aktywny | Utworzono
 *   Zadania:     ID | Nr | Tytuł | Opis | Status | Przypisane | Termin | Pilne | PP | Utworzył | Utworzono | Zmieniono | Zakończono
 *   Pozycje:     ID | Zadanie | Typ | Tekst | Kod | Ilość | PP | Zrobione | Kto | Kiedy | Wpis magazynu | Kolejność
 *   Zdjęcia:     ID | Zadanie | Plik | Rodzaj | Kto | Kiedy | Miniatura
 *   Komentarze:  ID | Zadanie | Kto | Kiedy | Tekst | System
 *   Numery PP:   ID | Numer | Opis | Dodał | Utworzono   (lista podpowiedzi PP, uzupełniana w aplikacji)
 *
 * Właściwości skryptu (Ustawienia projektu ⚙ → Właściwości skryptu):
 *   MAGAZYN_ID — ID arkusza magazynQR (fragment adresu między /d/ a /edit). Bez niego działa wszystko oprócz magazynu.
 *   SALT, FOLDER_ID — tworzą się same, nie ruszaj.
 *
 * Integracja z magazynem: odhaczenie pozycji „z magazynu” dopisuje do arkusza magazynQR (Wpisy)
 * zwykłe „Wydanie” z Dokument = „Zadanie #Nr”. Odznaczenie usuwa ten wpis po jego ID.
 * Kod magazynQR nie jest zmieniany.
 *
 * Uprawnienia: zadania, pozycje, zdjęcia i komentarze może dodawać, zmieniać i usuwać każdy.
 * Każdy zmienia swoje imię i hasło. Konta innych osób (dodawanie, hasło, wyłączanie, usuwanie,
 * nadawanie administratora) zmienia tylko administrator. Pierwsze konto jest administratorem.
 */
const VER = '5';
const MAX_FAILS_NAME = 8, MAX_FAILS_ALL = 40, LOCK_MIN = 10;
const STATUSES = ['Nowe', 'W trakcie', 'Zrobione'];
const PROPS = PropertiesService.getScriptProperties();

const T = {
  users:    { name: 'Użytkownicy', head: ['ID', 'Imię', 'Hasło', 'Rola', 'Aktywny', 'Utworzono'],
              f: ['id', 'name', 'pin', 'role', 'active', 'created'], text: [1, 2, 3] },
  tasks:    { name: 'Zadania', head: ['ID', 'Nr', 'Tytuł', 'Opis', 'Status', 'Przypisane', 'Termin', 'Pilne', 'PP', 'Utworzył', 'Utworzono', 'Zmieniono', 'Zakończono'],
              f: ['id', 'nr', 'title', 'desc', 'status', 'assignee', 'due', 'urgent', 'pp', 'by', 'created', 'updated', 'closed'], text: [1, 3, 4, 6, 7, 9] },
  items:    { name: 'Pozycje', head: ['ID', 'Zadanie', 'Typ', 'Tekst', 'Kod', 'Ilość', 'PP', 'Zrobione', 'Kto', 'Kiedy', 'Wpis magazynu', 'Kolejność'],
              f: ['id', 'task', 'type', 'text', 'code', 'qty', 'pp', 'done', 'doneBy', 'doneAt', 'entry', 'order'], text: [1, 2, 4, 5, 7, 11] },
  photos:   { name: 'Zdjęcia', head: ['ID', 'Zadanie', 'Plik', 'Rodzaj', 'Kto', 'Kiedy', 'Miniatura'],
              f: ['id', 'task', 'file', 'kind', 'by', 'at', 'thumb'], text: [1, 2, 3, 7] },
  comments: { name: 'Komentarze', head: ['ID', 'Zadanie', 'Kto', 'Kiedy', 'Tekst', 'System'],
              f: ['id', 'task', 'by', 'at', 'text', 'sys'], text: [1, 2, 5] },
  pps:      { name: 'Numery PP', head: ['ID', 'Numer', 'Opis', 'Dodał', 'Utworzono'],
              f: ['id', 'pp', 'desc', 'by', 'created'], text: [1, 2, 3] }
};

/* ---------- wejście ---------- */

function doGet() {
  return out({ ok: false, error: 'To jest serwer aplikacji Zadania — otwórz aplikację' });
}

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'Zły format danych' }); }
  try {
    return out(route(b));
  } catch (err) {
    const o = { ok: false, error: String((err && err.message) || err) };
    if (err && err.auth) o.auth = true;
    return out(o);
  }
}

function route(b) {
  const a = b.action;
  if (a === 'hello') return { ok: true, ver: VER, empty: read('users').length === 0 };
  if (a === 'firstAdmin') return locked(() => firstAdmin(b));
  const me = auth(b);
  if (a === 'login') return { ok: true, me: pubUser(me) };
  if (a === 'sync') return sync(b, me);
  if (a === 'detail') return detail(b);
  if (a === 'photo') return photo(b);
  if (a === 'magazyn') return magazyn();
  return locked(() => {
    switch (a) {
      case 'saveTask': return saveTask(b, me);
      case 'setStatus': return setStatus(b, me);
      case 'deleteTask': return deleteTask(b, me);
      case 'addItems': return addItems(b, me);
      case 'editItem': return editItem(b, me);
      case 'deleteItem': return deleteItem(b, me);
      case 'toggleItem': return toggleItem(b, me);
      case 'addPhoto': return addPhoto(b, me);
      case 'deletePhoto': return deletePhoto(b, me);
      case 'addComment': return addComment(b, me);
      case 'changePin': return changePin(b, me);
      case 'addUser': return addUser(b, me);
      case 'updateUser': return updateUser(b, me);
      case 'deleteUser': return deleteUser(b, me);
      case 'savePP': return savePP(b, me);
      case 'deletePP': return deletePP(b, me);
    }
    throw new Error('Nieznana akcja — odśwież aplikację');
  });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function locked(fn) {
  const l = LockService.getScriptLock();
  l.waitLock(20000);
  try { return fn(); } finally { l.releaseLock(); }
}

/* ---------- arkusze ---------- */

function sheet(key) {
  const t = T[key], ss = SpreadsheetApp.getActive();
  let s = ss.getSheetByName(t.name);
  if (!s) {
    s = ss.insertSheet(t.name);
    s.getRange(1, 1, 1, t.head.length).setValues([t.head]).setFontWeight('bold');
    s.setFrozenRows(1);
    t.text.forEach(c => { const L = String.fromCharCode(64 + c); s.getRange(L + ':' + L).setNumberFormat('@'); });
  }
  return s;
}

function read(key, cols) {
  const t = T[key], s = sheet(key), n = s.getLastRow() - 1;
  if (n < 1) return [];
  const w = cols || t.f.length;
  return s.getRange(2, 1, n, w).getValues().map((r, i) => {
    const o = { _row: i + 2 };
    for (let c = 0; c < w; c++) o[t.f[c]] = r[c];
    o.id = String(o.id || '');
    return o;
  }).filter(o => o.id);
}

function rowOf(key, o) {
  const t = T[key];
  return t.f.map((f, i) => {
    const v = o[f];
    if (v === undefined || v === null) return '';
    // kolumny tekstowe (format „@”) zapisują się dosłownie; w pozostałych chronimy przed formułami
    if (typeof v === 'string' && t.text.indexOf(i + 1) < 0) return safe(v);
    return v;
  });
}

function append(key, o) { sheet(key).appendRow(rowOf(key, o)); }
function write(key, o) { sheet(key).getRange(o._row, 1, 1, T[key].f.length).setValues([rowOf(key, o)]); }
function removeRows(key, list) {
  const s = sheet(key);
  list.map(o => o._row).sort((a, b) => b - a).forEach(r => s.deleteRow(r));
}
function find(key, id) {
  const o = read(key).find(x => x.id === String(id || ''));
  if (!o) throw new Error('Nie znaleziono — odśwież aplikację');
  return o;
}

// tekst zaczynający się od = + - @ arkusz wziąłby za formułę
function safe(s) { return /^[=+\-@]/.test(s) ? "'" + s : s; }
function clean(s, max) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function cleanText(s, max) { return String(s == null ? '' : s).replace(/\r/g, '').trim().slice(0, max || 4000); }
function norm(s) { return clean(s).toLowerCase(); }
function on(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function uid(p) { return p + Utilities.getUuid().replace(/-/g, '').slice(0, 11); }
function fmt(d) {
  if (!(d instanceof Date)) return String(d || '');
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm");
}
function day(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function fail(msg, extra) { return Object.assign(new Error(msg), extra || {}); }

/* ---------- logowanie ---------- */

function salt() {
  let s = PROPS.getProperty('SALT');
  if (!s) { s = Utilities.getUuid(); PROPS.setProperty('SALT', s); }
  return s;
}
function hashPin(pin, userId) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt() + '|' + userId + '|' + pin, Utilities.Charset.UTF_8);
  return 'h' + d.map(x => ('0' + ((x + 256) % 256).toString(16)).slice(-2)).join('');
}
function checkPinFormat(pin) {
  const p = String(pin || '');
  if (p.length < 6) throw new Error('Hasło musi mieć co najmniej 6 znaków');
  if (p.length > 64) throw new Error('Hasło może mieć najwyżej 64 znaki');
}

function auth(b) {
  const cache = CacheService.getScriptCache();
  if (cache.get('lockAll')) throw fail('Zbyt wiele błędnych prób. Spróbuj ponownie za kilka minut.', { auth: true });
  const name = norm(b.u), pin = String(b.p || ''), key = 'f:' + Utilities.base64EncodeWebSafe(name).slice(0, 200);
  if (cache.get('lock' + key)) throw fail('Zbyt wiele błędnych prób dla tego imienia. Spróbuj za ' + LOCK_MIN + ' min.', { auth: true });
  const u = name && usersFixed().find(x => norm(x.name) === name && on(x.active));
  if (u && pin && String(u.pin) === hashPin(pin, u.id)) return u;
  Utilities.sleep(1500);
  const fn = (Number(cache.get(key)) || 0) + 1, fa = (Number(cache.get('failsAll')) || 0) + 1;
  cache.put(key, String(fn), 600); cache.put('failsAll', String(fa), 600);
  if (fn >= MAX_FAILS_NAME) { cache.put('lock' + key, '1', LOCK_MIN * 60); cache.remove(key); }
  if (fa >= MAX_FAILS_ALL) { cache.put('lockAll', '1', 5 * 60); cache.remove('failsAll'); }
  throw fail('Złe imię lub hasło', { auth: true });
}

function firstAdmin(b) {
  if (read('users').length) throw new Error('Pierwsze konto już istnieje — zaloguj się');
  const name = clean(b.name, 40);
  if (!name) throw new Error('Wpisz imię');
  checkPinFormat(b.pin);
  const u = { id: uid('u'), name: name, role: 'Administrator', active: true, created: new Date() };
  u.pin = hashPin(String(b.pin), u.id);
  ensureAll();
  sheet('users').getRange(1, 1, 1, T.users.head.length).setValues([T.users.head]);  // nagłówki w aktualnej wersji
  append('users', u);
  return { ok: true, me: pubUser(u) };
}

function ensureAll() { Object.keys(T).forEach(sheet); }

/* ---------- odczyt ---------- */

function pubUser(u) { return { id: u.id, name: String(u.name), role: String(u.role), active: on(u.active) }; }
function pubTask(t) {
  return { id: t.id, nr: Number(t.nr) || 0, title: String(t.title), desc: String(t.desc), status: String(t.status) || 'Nowe',
    assignee: String(t.assignee || ''), due: day(t.due), urgent: on(t.urgent), pp: String(t.pp || ''), by: String(t.by),
    created: fmt(t.created), updated: fmt(t.updated), closed: fmt(t.closed) };
}
function pubItem(i) {
  return { id: i.id, task: String(i.task), type: String(i.type) === 'mag' ? 'mag' : 'txt', text: String(i.text), code: String(i.code || ''),
    qty: Number(i.qty) || 0, pp: String(i.pp || ''), done: on(i.done), doneBy: String(i.doneBy || ''), doneAt: fmt(i.doneAt),
    order: Number(i.order) || 0 };
}

function sync(b, me) {
  const cutoff = b.all ? 0 : Date.now() - 60 * 864e5;
  let hidden = 0;
  const tasks = read('tasks').filter(t => {
    const keep = String(t.status) !== 'Zrobione' || !(t.closed instanceof Date) || t.closed.getTime() >= cutoff;
    if (!keep) hidden++;
    return keep;
  });
  const ids = {};
  tasks.forEach(t => ids[t.id] = true);
  const photos = {}, comments = {};
  read('photos', 2).forEach(p => { if (ids[p.task]) photos[p.task] = (photos[p.task] || 0) + 1; });
  read('comments').forEach(c => { if (ids[c.task] && !on(c.sys)) comments[c.task] = (comments[c.task] || 0) + 1; });
  return {
    ok: true, ver: VER, me: pubUser(me),
    users: read('users').map(pubUser),
    tasks: tasks.map(pubTask),
    items: read('items').filter(i => ids[i.task]).map(pubItem),
    pps: read('pps').map(p => ({ id: p.id, pp: String(p.pp), desc: String(p.desc || ''), by: String(p.by || '') })),
    photos: photos, comments: comments, hidden: hidden,
    magazyn: !!PROPS.getProperty('MAGAZYN_ID')
  };
}

function detail(b) {
  const id = String(b.task || '');
  return {
    ok: true,
    photos: read('photos').filter(p => p.task === id).map(p => ({ id: p.id, kind: String(p.kind), by: String(p.by), at: fmt(p.at), thumb: String(p.thumb || '') })),
    comments: read('comments').filter(c => c.task === id).map(c => ({ id: c.id, by: String(c.by), at: fmt(c.at), text: String(c.text), sys: on(c.sys) }))
  };
}

function photo(b) {
  const p = find('photos', b.id);
  const blob = DriveApp.getFileById(String(p.file)).getBlob();
  return { ok: true, mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

/* ---------- zadania ---------- */

function userName(id, users) {
  const u = (users || read('users')).find(x => x.id === id);
  return u ? String(u.name) : '';
}

function sys(taskId, me, text) {
  append('comments', { id: uid('k'), task: taskId, by: String(me.name), at: new Date(), text: text, sys: true });
}

function saveTask(b, me) {
  const t = b.task || {}, users = read('users');
  const title = clean(t.title, 150);
  if (!title) throw new Error('Wpisz tytuł zadania');
  let assignee = String(t.assignee || '');
  if (assignee && !users.some(u => u.id === assignee && on(u.active))) assignee = '';
  const f = { title: title, desc: cleanText(t.desc, 4000), assignee: assignee, due: day(t.due), urgent: !!t.urgent, pp: clean(t.pp, 40) };
  if (!t.id) {
    const nr = read('tasks', 2).reduce((m, x) => Math.max(m, Number(x.nr) || 0), 0) + 1;
    const o = Object.assign({ id: uid('z'), nr: nr, status: 'Nowe', by: String(me.name), created: new Date(), updated: new Date(), closed: '' }, f);
    append('tasks', o);
    return { ok: true, task: pubTask(o) };
  }
  const o = find('tasks', t.id);
  if (String(o.assignee || '') !== assignee) sys(o.id, me, assignee ? 'przypisał(a) do: ' + userName(assignee, users) : 'ustawił(a): dla wszystkich');
  Object.assign(o, f, { updated: new Date() });
  write('tasks', o);
  return { ok: true, task: pubTask(o) };
}

function setStatus(b, me) {
  const st = String(b.status);
  if (STATUSES.indexOf(st) < 0) throw new Error('Zły status');
  const o = find('tasks', b.id);
  if (String(o.status) === st) return { ok: true, task: pubTask(o) };
  o.status = st; o.updated = new Date(); o.closed = st === 'Zrobione' ? new Date() : '';
  write('tasks', o);
  sys(o.id, me, 'zmienił(a) status na: ' + st);
  return { ok: true, task: pubTask(o) };
}

function deleteTask(b, me) {
  const o = find('tasks', b.id);
  const photos = read('photos', 3).filter(p => p.task === o.id);
  photos.forEach(p => { try { DriveApp.getFileById(String(p.file)).setTrashed(true); } catch (e) {} });
  removeRows('photos', photos);
  removeRows('comments', read('comments', 2).filter(c => c.task === o.id));
  removeRows('items', read('items', 2).filter(i => i.task === o.id));
  removeRows('tasks', [find('tasks', o.id)]);
  return { ok: true };
}

/* ---------- pozycje ---------- */

function addItems(b, me) {
  const t = find('tasks', b.task);
  const lines = (b.lines || []).slice(0, 100);
  let names = null;
  if (lines.some(l => l.type === 'mag')) {
    names = {};
    magProducts().forEach(p => names[p.code] = p.name);
  }
  let order = read('items').filter(i => i.task === t.id).reduce((m, i) => Math.max(m, Number(i.order) || 0), 0);
  const added = [];
  lines.forEach(l => {
    const o = { id: uid('p'), task: t.id, done: false, doneBy: '', doneAt: '', entry: '' };
    if (l.type === 'mag') {
      const code = String(l.code || ''), qty = Math.round(Number(l.qty));
      if (!names[code]) throw new Error('Nie ma takiego produktu w magazynie — odśwież listę');
      if (!(qty > 0)) throw new Error('Ilość musi być większa od zera');
      Object.assign(o, { type: 'mag', text: names[code], code: code, qty: qty, pp: clean(l.pp, 40) });
    } else {
      const text = clean(l.text, 300);
      if (!text) return;
      Object.assign(o, { type: 'txt', text: text, code: '', qty: '', pp: '' });
    }
    o.order = ++order;
    append('items', o);
    added.push(pubItem(o));
  });
  if (!added.length) throw new Error('Nic nie dodano');
  return { ok: true, items: added };
}

function editItem(b, me) {
  const o = find('items', b.id);
  if (on(o.done)) throw new Error('Najpierw odznacz pozycję');
  if (String(o.type) === 'mag') {
    const qty = Math.round(Number(b.qty));
    if (!(qty > 0)) throw new Error('Ilość musi być większa od zera');
    o.qty = qty; o.pp = clean(b.pp, 40);
  } else {
    const text = clean(b.text, 300);
    if (!text) throw new Error('Wpisz treść');
    o.text = text;
  }
  write('items', o);
  return { ok: true, item: pubItem(o) };
}

function deleteItem(b, me) {
  const o = find('items', b.id);
  if (on(o.done) && String(o.type) === 'mag') throw new Error('Najpierw odznacz pozycję — wtedy wydanie wróci do magazynu');
  removeRows('items', [o]);
  return { ok: true };
}

function toggleItem(b, me) {
  const o = find('items', b.id), done = !!b.done;
  const t = find('tasks', o.task);
  if (on(o.done) === done) return { ok: true, item: pubItem(o), task: pubTask(t) };
  if (String(o.type) === 'mag') {
    if (done) o.entry = magIssue(o, t, me);
    else { magCancel(String(o.entry || '')); o.entry = ''; }
  }
  o.done = done; o.doneBy = done ? String(me.name) : ''; o.doneAt = done ? new Date() : '';
  write('items', o);
  if (done && String(t.status) === 'Nowe') {
    t.status = 'W trakcie'; t.updated = new Date();
    write('tasks', t);
    sys(t.id, me, 'zmienił(a) status na: W trakcie');
  }
  return { ok: true, item: pubItem(o), task: pubTask(t) };
}

/* ---------- magazyn (arkusz magazynQR) ---------- */

function magSS() {
  const id = PROPS.getProperty('MAGAZYN_ID');
  if (!id) return null;
  try { return SpreadsheetApp.openById(id.trim()); }
  catch (e) { throw new Error('Nie mogę otworzyć arkusza magazynu — sprawdź MAGAZYN_ID we właściwościach skryptu'); }
}
function magRows(ss, name, cols) {
  const s = ss.getSheetByName(name);
  if (!s || s.getLastRow() < 2) return [];
  return s.getRange(2, 1, s.getLastRow() - 1, cols).getValues();
}
function magProducts(ss) {
  ss = ss || magSS();
  if (!ss) throw new Error('Magazyn nie jest podłączony (brak MAGAZYN_ID)');
  return magRows(ss, 'Produkty', 2).filter(r => r[0]).map(r => ({ code: String(r[0]), name: String(r[1]) }));
}

function magazyn() {
  const ss = magSS();
  if (!ss) return { ok: true, connected: false, products: [], sets: [], stock: {} };
  const stock = {};
  magRows(ss, 'Wpisy', 8).forEach(r => {
    if (!r[2]) return;
    const q = Number(r[3]) || 0, typ = String(r[7]);
    const s = typ === 'Przyjęcie' || typ === 'Korekta' ? q : -q;
    stock[String(r[2])] = (stock[String(r[2])] || 0) + s;
  });
  const sets = [], by = {};
  magRows(ss, 'Zestawy', 3).forEach(r => {
    const n = String(r[0]).trim(), c = String(r[1]).trim();
    if (!n || !c) return;
    if (!by[n]) { by[n] = { name: n, items: [] }; sets.push(by[n]); }
    by[n].items.push({ code: c, qty: Number(r[2]) || 1 });
  });
  return { ok: true, connected: true, products: magProducts(ss), sets: sets, stock: stock };
}

function magEntryRow(sh, id) {
  const n = sh.getLastRow() - 1;
  if (n < 1 || !id) return -1;
  const ids = sh.getRange(2, 7, n, 1).getValues();
  for (let i = n - 1; i >= 0; i--) if (String(ids[i][0]) === id) return i + 2;
  return -1;
}

// jedno „Wydanie” w arkuszu magazynQR, w tym samym formacie co wpisy z aplikacji magazynu
function magIssue(item, task, me) {
  const ss = magSS();
  if (!ss) throw new Error('Magazyn nie jest podłączony (brak MAGAZYN_ID)');
  const p = magProducts(ss).find(x => x.code === String(item.code));
  if (!p) throw new Error('Produktu „' + item.text + '” nie ma już w magazynie');
  const pp = clean(item.pp || task.pp, 40);
  if (!pp) throw new Error('Wpisz numer PP w zadaniu albo przy pozycji');
  const qty = Math.round(Number(item.qty)) || 0;
  if (!(qty > 0)) throw new Error('Zła ilość');
  const sh = ss.getSheetByName('Wpisy');
  if (!sh) throw new Error('W arkuszu magazynu nie ma zakładki „Wpisy”');
  const id = Utilities.getUuid().slice(0, 12);
  const row = [new Date(), p.name, p.code, qty, pp, String(me.name), id, 'Wydanie', 'Zadanie #' + task.nr, ''];
  for (let attempt = 0; attempt < 3; attempt++) {
    sh.appendRow(row);
    SpreadsheetApp.flush();
    if (magEntryRow(sh, id) > 0) return id;   // aplikacja magazynu mogła w tej samej chwili nadpisać wiersz
    Utilities.sleep(400);
  }
  throw new Error('Nie udało się zapisać wydania w magazynie — spróbuj jeszcze raz');
}

function magCancel(entryId) {
  if (!entryId) return;
  const ss = magSS();
  if (!ss) throw new Error('Magazyn nie jest podłączony (brak MAGAZYN_ID)');
  const sh = ss.getSheetByName('Wpisy');
  const r = sh ? magEntryRow(sh, entryId) : -1;
  if (r > 0) sh.deleteRow(r);    // brak wpisu = ktoś usunął go już w magazynie, nic do cofnięcia
}

/* ---------- zdjęcia i komentarze ---------- */

function folder() {
  const id = PROPS.getProperty('FOLDER_ID');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  const f = DriveApp.createFolder('Zadania – zdjęcia');
  PROPS.setProperty('FOLDER_ID', f.getId());
  return f;
}

function addPhoto(b, me) {
  const t = find('tasks', b.task);
  const data = String(b.data || '');
  if (!data) throw new Error('Brak zdjęcia');
  const kinds = ['przed', 'po', 'inne'], kind = kinds.indexOf(b.kind) >= 0 ? b.kind : 'inne';
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm-ss');
  const blob = Utilities.newBlob(Utilities.base64Decode(data), 'image/jpeg', 'Zadanie-' + t.nr + '_' + kind + '_' + stamp + '.jpg');
  const file = folder().createFile(blob);
  let thumb = String(b.thumb || '');
  if (thumb.length > 45000 || !/^[A-Za-z0-9+\/=]*$/.test(thumb)) thumb = '';
  const o = { id: uid('f'), task: t.id, file: file.getId(), kind: kind, by: String(me.name), at: new Date(), thumb: thumb };
  append('photos', o);
  return { ok: true, photo: { id: o.id, kind: kind, by: o.by, at: fmt(o.at), thumb: thumb } };
}

function deletePhoto(b, me) {
  const p = find('photos', b.id);
  try { DriveApp.getFileById(String(p.file)).setTrashed(true); } catch (e) {}
  removeRows('photos', [p]);
  return { ok: true };
}

function addComment(b, me) {
  const t = find('tasks', b.task);
  const text = cleanText(b.text, 2000);
  if (!text) throw new Error('Wpisz komentarz');
  const o = { id: uid('k'), task: t.id, by: String(me.name), at: new Date(), text: text, sys: false };
  append('comments', o);
  return { ok: true, comment: { id: o.id, by: o.by, at: fmt(o.at), text: text, sys: false } };
}

/* ---------- lista numerów PP ---------- */

function savePP(b, me) {
  const pp = clean(b.pp, 40), desc = clean(b.desc, 80);
  if (!pp) throw new Error('Wpisz numer PP');
  const all = read('pps');
  const o = b.id ? all.find(x => x.id === String(b.id)) : all.find(x => norm(x.pp) === norm(pp));
  if (o) {
    if (all.some(x => x.id !== o.id && norm(x.pp) === norm(pp))) throw new Error('PP ' + pp + ' już jest na liście');
    o.pp = pp; if (b.desc !== undefined) o.desc = desc;
    write('pps', o);
    return { ok: true, pp: { id: o.id, pp: String(o.pp), desc: String(o.desc || ''), by: String(o.by || '') } };
  }
  const n = { id: uid('n'), pp: pp, desc: desc, by: String(me.name), created: new Date() };
  append('pps', n);
  return { ok: true, pp: { id: n.id, pp: pp, desc: desc, by: n.by } };
}

function deletePP(b, me) {
  const o = find('pps', b.id);
  removeRows('pps', [o]);
  return { ok: true };
}

/* ---------- użytkownicy ---------- */

function changePin(b, me) {
  checkPinFormat(b.newPin);
  const u = find('users', me.id);
  u.pin = hashPin(String(b.newPin), u.id);
  write('users', u);
  return { ok: true };
}

function isAdmin(u) { return String(u.role) === 'Administrator'; }
function mustBeAdmin(me) {
  if (!isAdmin(me)) throw new Error('To może zrobić tylko administrator');
}

// gdyby nie było żadnego aktywnego administratora, zostaje nim pierwsza aktywna osoba
function usersFixed() {
  const all = read('users');
  if (all.length && !all.some(x => isAdmin(x) && on(x.active))) {
    const first = all.find(x => on(x.active));
    if (first) { first.role = 'Administrator'; write('users', first); }
  }
  return all;
}

function addUser(b, me) {
  mustBeAdmin(me);
  const name = clean(b.name, 40);
  if (!name) throw new Error('Wpisz imię');
  checkPinFormat(b.pin);
  if (read('users').some(u => norm(u.name) === norm(name))) throw new Error('Osoba „' + name + '” już jest na liście');
  const u = { id: uid('u'), name: name, role: b.admin ? 'Administrator' : 'Użytkownik', active: true, created: new Date() };
  u.pin = hashPin(String(b.pin), u.id);
  append('users', u);
  return { ok: true, user: pubUser(u) };
}

function updateUser(b, me) {
  const all = read('users'), u = all.find(x => x.id === String(b.id || ''));
  if (!u) throw new Error('Nie znaleziono osoby — odśwież aplikację');
  const self = u.id === me.id, admin = isAdmin(me);
  if (!self && !admin) throw new Error('Konta innych osób może zmieniać tylko administrator');
  if (b.name !== undefined) {
    if (!self) throw new Error('Imię może zmienić tylko ta osoba');
    const name = clean(b.name, 40);
    if (!name) throw new Error('Wpisz imię');
    if (all.some(x => x.id !== u.id && norm(x.name) === norm(name))) throw new Error('Osoba „' + name + '” już jest na liście');
    u.name = name;
  }
  if (b.pin) { checkPinFormat(b.pin); u.pin = hashPin(String(b.pin), u.id); }
  if (b.active !== undefined) {
    if (!admin) throw new Error('To może zrobić tylko administrator');
    if (self) throw new Error('Nie możesz wyłączyć samego siebie');
    u.active = !!b.active;
  }
  if (b.admin !== undefined) {
    if (!admin) throw new Error('To może zrobić tylko administrator');
    u.role = b.admin ? 'Administrator' : 'Użytkownik';
  }
  if (!all.map(x => x.id === u.id ? u : x).some(x => isAdmin(x) && on(x.active)))
    throw new Error('Musi zostać co najmniej jeden aktywny administrator');
  write('users', u);
  return { ok: true, user: pubUser(u) };
}

function deleteUser(b, me) {
  mustBeAdmin(me);
  const u = find('users', b.id);
  if (u.id === me.id) throw new Error('Nie możesz usunąć samego siebie');
  // zadania tej osoby zostają, tylko są teraz „dla wszystkich”
  read('tasks').filter(t => String(t.assignee) === u.id).forEach(t => { t.assignee = ''; write('tasks', t); });
  removeRows('users', [find('users', u.id)]);
  return { ok: true };
}

/* Do ręcznego uruchomienia w edytorze (opcjonalnie): tworzy wszystkie zakładki. */
function setup() { ensureAll(); }
