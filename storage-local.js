/* storage.js — แทนที่ฐานข้อมูลของ Claude (window.claude) ด้วยการเก็บใน localStorage ของเบราว์เซอร์
   จำลอง API แบบ Firestore ที่แอปใช้: doc/collection, get/set/update/delete, orderBy/limit, onSnapshot */
(function () {
  const KEY = 'teamboard_db_v1', UID = 'teamboard_uid';
  let store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { store = {}; }
  const subs = new Set();
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const err = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };
  const rid = () => { let s = ''; const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; for (let i = 0; i < 20; i++) s += c[Math.floor(Math.random() * c.length)]; return s; };

  function commit(fn) {
    const prev = store; store = Object.assign({}, store); fn(store);
    try { localStorage.setItem(KEY, JSON.stringify(store)); }
    catch (e) { store = prev; throw err('resource-exhausted', 'พื้นที่จัดเก็บในเบราว์เซอร์เต็ม ลองส่งออกไฟล์สำรองแล้วล้างข้อมูลเก่า'); }
    subs.forEach(s => s.sched());
  }
  function listen(build, cb) {
    const sub = { off: false, t: 0, sched() { if (this.t || this.off) return; this.t = setTimeout(() => { this.t = 0; if (this.off) return; try { cb(build()); } catch (e) { console.error(e); } }, 0); } };
    subs.add(sub); sub.sched();
    return () => { sub.off = true; subs.delete(sub); };
  }
  const docSnap = path => ({ id: path.split('/').pop(), exists: path in store, data: () => clone(store[path]) });
  const listColl = name => Object.keys(store).filter(k => k.startsWith(name + '/') && k.indexOf('/', name.length + 1) < 0).map(docSnap);
  function collSnap(name, q) {
    let docs = listColl(name);
    if (q.field) docs.sort((a, b) => { const x = a.data()[q.field], y = b.data()[q.field]; const r = x < y ? -1 : x > y ? 1 : 0; return q.dir === 'desc' ? -r : r; });
    if (q.n) docs = docs.slice(0, q.n);
    return { docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f) };
  }
  function docRef(path) {
    return {
      id: path.split('/').pop(), path,
      get: async () => docSnap(path),
      set: async d => commit(s => { s[path] = clone(d); }),
      update: async d => { if (!(path in store)) throw err('not-found', 'ไม่พบเอกสาร'); commit(s => { s[path] = Object.assign({}, s[path], clone(d)); }); },
      delete: async () => commit(s => { delete s[path]; }),
      onSnapshot: (cb) => listen(() => docSnap(path), cb)
    };
  }
  function query(name, q) {
    return {
      orderBy: (f, d) => query(name, Object.assign({}, q, { field: f, dir: d || 'asc' })),
      limit: n => query(name, Object.assign({}, q, { n })),
      get: async () => collSnap(name, q),
      onSnapshot: cb => listen(() => collSnap(name, q), cb)
    };
  }
  const db = {
    doc: p => docRef(p),
    collection: name => Object.assign(query(name, {}), { doc: id => docRef(name + '/' + (id || rid())) })
  };

  let uid = ''; try { uid = localStorage.getItem(UID) || ''; if (!uid) { uid = 'local-' + rid(); localStorage.setItem(UID, uid); } } catch (e) { uid = 'local-' + rid(); }
  const user = { id: async () => uid, can: () => true, profiles: async ids => Object.fromEntries((ids || []).map(i => [i, { name: 'ผู้ใช้เครื่องนี้' }])) };

  window.addEventListener('storage', e => { if (e.key === KEY) { try { store = JSON.parse(e.newValue || '{}') || {}; } catch (x) {} subs.forEach(s => s.sched()); } });
  window.claude = { use: async n => { if (n === 'db') return db; if (n === 'user') return user; throw err('unavailable', n + ' ไม่รองรับนอก Claude'); } };
})();
