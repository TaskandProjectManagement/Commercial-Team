/* storage.js — ให้ทั้งทีมใช้ข้อมูลร่วมกันผ่าน Google Sheets (Apps Script) โดยใช้รหัสผ่านทีม
   ถ้ายังไม่ตั้งค่า sheets-config.js จะไม่ทำอะไร และใช้ storage-local.js (เก็บในเบราว์เซอร์) ต่อไป */
(function () {
  const cfg = window.SHEETS_CONFIG;
  if (!cfg || !/^https:\/\/script\.google\.com\//.test(cfg.url || '')) { console.info('Commercial Team: โหมดเครื่องเดียว (ยังไม่ได้ตั้งค่า Google Sheets)'); return; }
  window.__SHARED = true;
  if (cfg.title) { try { document.title = cfg.title; } catch (e) {} }

  const LS = 'tb_sheets_v1', POLL = 12000;
  const rnd = () => Math.random().toString(36).slice(2, 12);
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const err = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let st = {}; try { st = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) {}
  let store = st.store || {}, ver = st.v || 0, pass = st.pass || '', name = st.name || '', uid = st.uid || ('u-' + rnd());
  let gid = st.gid || '', gname = st.gname || '';   // กลุ่มงานของข้อมูลที่แคชไว้
  let started = false, loginMsg = '';
  const save = () => { try { localStorage.setItem(LS, JSON.stringify({ pass, name, uid, v: ver, store, gid, gname })); } catch (e) {} };
  const subs = new Set(), notify = () => subs.forEach(s => s.sched());

  /* ---------- เรียกเซิร์ฟเวอร์ ---------- */
  async function post(body) {
    let r, j;
    try { r = await fetch(cfg.url, { method: 'POST', body: JSON.stringify(Object.assign({ pass }, body)) }); }
    catch (e) { throw err('unavailable', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตและลิงก์ใน sheets-config.js'); }
    try { j = await r.json(); } catch (e) { throw err('unavailable', 'เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ (ตรวจว่า Deploy เป็น Anyone และใช้ลิงก์ /exec)'); }
    if (j.error === 'unauthorized') { pass = ''; loginMsg = 'รหัสผ่านทีมไม่ถูกต้อง'; save(); if (started) location.reload(); throw err('permission-denied', 'รหัสผ่านทีมไม่ถูกต้อง'); }
    if (j.error) throw err('unavailable', j.error);
    return j;
  }

  /* ---------- ซิงก์ข้อมูล ---------- */
  let syncing = false, pending = 0;
  async function sync(force, full) {
    if (!force && (syncing || pending || !pass)) return;
    syncing = true;
    try {
      let j = await post({ act: 'sync', since: full ? 0 : ver });
      if (j.gid && gid && j.gid !== gid) { store = {}; ver = 0; full = true; j = await post({ act: 'sync', since: 0 }); }   // เปลี่ยนกลุ่มงาน: ทิ้งข้อมูลแคชของกลุ่มเก่า
      if (j.gid) { gid = j.gid; gname = j.gn || ''; }
      if (full) store = {};
      (j.changes || []).forEach(c => { if (c.d === null) delete store[c.p]; else store[c.p] = c.d; });
      ver = j.v; save(); notify();
    } finally { syncing = false; }
  }

  /* ---------- เขียนข้อมูล (รวมหลายคำสั่งเป็นรอบเดียว) ---------- */
  let q = [], timer = 0;
  function enqueue(op, apply) {
    apply(); save(); notify(); pending++;
    return new Promise((res, rej) => { q.push({ op, res, rej }); if (!timer) timer = setTimeout(flush, 40); });
  }
  async function flush() {
    timer = 0; const b = q; q = [];
    try {
      const j = await post({ act: 'write', ops: b.map(x => x.op) });
      let bad = false;
      b.forEach((x, i) => { const r = (j.results || [])[i] || {}; if (r.error) { bad = true; x.rej(err(r.error, r.error)); } else x.res(); });
      pending -= b.length; await sync(true, bad).catch(() => {});
    } catch (e) { pending -= b.length; b.forEach(x => x.rej(e)); sync(true, true).catch(() => {}); }
  }

  /* ---------- API แบบเดียวกับฐานข้อมูลที่แอปใช้ ---------- */
  function listen(build, cb) {
    const sub = { off: false, t: 0, sched() { if (this.t || this.off) return; this.t = setTimeout(() => { this.t = 0; if (this.off) return; try { cb(build()); } catch (e) { console.error(e); } }, 0); } };
    subs.add(sub); sub.sched(); return () => { sub.off = true; subs.delete(sub); };
  }
  const docSnap = path => ({ id: path.split('/').pop(), exists: path in store, data: () => clone(store[path]) });
  const listColl = n => Object.keys(store).filter(k => k.startsWith(n + '/') && k.indexOf('/', n.length + 1) < 0).map(docSnap);
  function collSnap(n, qy) {
    let docs = listColl(n);
    if (qy.field) docs.sort((a, b) => { const x = a.data()[qy.field], y = b.data()[qy.field]; const r = x < y ? -1 : x > y ? 1 : 0; return qy.dir === 'desc' ? -r : r; });
    if (qy.n) docs = docs.slice(0, qy.n);
    return { docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f) };
  }
  function docRef(path) {
    return {
      id: path.split('/').pop(), path,
      get: async () => docSnap(path),
      set: d => enqueue({ t: 'set', p: path, d: clone(d) }, () => { store[path] = clone(d); }),
      update: d => !(path in store) ? Promise.reject(err('not-found', 'ไม่พบเอกสาร')) : enqueue({ t: 'update', p: path, d: clone(d) }, () => { store[path] = Object.assign({}, store[path], clone(d)); }),
      delete: () => enqueue({ t: 'delete', p: path }, () => { delete store[path]; }),
      onSnapshot: cb => listen(() => docSnap(path), cb)
    };
  }
  function query(n, qy) {
    return {
      orderBy: (f, d) => query(n, Object.assign({}, qy, { field: f, dir: d || 'asc' })),
      limit: k => query(n, Object.assign({}, qy, { n: k })),
      get: async () => collSnap(n, qy),
      onSnapshot: cb => listen(() => collSnap(n, qy), cb)
    };
  }
  const db = { doc: p => docRef(p), collection: n => Object.assign(query(n, {}), { doc: id => docRef(n + '/' + (id || rnd() + rnd())) }) };

  /* ---------- หน้าใส่ชื่อ + รหัสผ่านทีม ---------- */
  function askLogin() {
    return new Promise(resolve => {
      const go = () => {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#101719;color:#e6eeee;display:flex;align-items:center;justify-content:center;font:15px "IBM Plex Sans Thai","Noto Sans Thai",sans-serif;padding:20px';
        const inp = 'display:block;width:100%;margin:0 0 10px;padding:10px 12px;border-radius:10px;border:1px solid #3a4a4d;background:#182124;color:#e6eeee;font:inherit;box-sizing:border-box';
        ov.innerHTML = '<div style="width:300px;text-align:center"><h2 style="margin:0 0 6px">' + esc(cfg.title || 'TPM Work') + '</h2><p style="color:#8ea3a6;margin:0 0 16px">' + esc(cfg.subtitle || 'ใส่ชื่อของคุณและรหัสผ่านทีม') + '</p>' +
          (loginMsg ? '<p style="color:#ff7b86;margin:0 0 12px">' + esc(loginMsg) + '</p>' : '') +
          '<input id="lgN" placeholder="ชื่อของคุณ" value="' + esc(name) + '" style="' + inp + '"><input id="lgP" type="password" placeholder="รหัสผ่านทีม" style="' + inp + '">' +
          '<button id="lgB" style="padding:10px 26px;border-radius:99px;border:0;background:#4fc1bb;color:#06201f;font:inherit;font-weight:600;cursor:pointer">เข้าใช้งาน</button></div>';
        document.body.appendChild(ov);
        const submit = () => { const n = ov.querySelector('#lgN').value.trim(), p = ov.querySelector('#lgP').value; if (!n || !p) return; name = n; pass = p; loginMsg = ''; save(); ov.remove(); resolve(); };
        ov.querySelector('#lgB').onclick = submit; ov.onkeydown = e => { if (e.key === 'Enter') submit(); };
        ov.querySelector(name ? '#lgP' : '#lgN').focus();
      };
      if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
    });
  }
  function badge() {
    const go = () => {
      const b = document.createElement('button'); b.textContent = name + (gname ? ' · ' + gname : '') + ' · ออก'; b.title = 'ออกจากระบบ';
      b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9000;font-size:11px;padding:2px 10px;border-radius:99px;border:1px solid #8888;background:#0008;color:#fff;cursor:pointer;opacity:.7';
      b.onclick = () => { try { localStorage.removeItem(LS); } catch (e) {} location.reload(); };
      document.body.appendChild(b);
    };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
  }

  /* ---------- เริ่มต้น ---------- */
  const ready = (async () => {
    for (;;) {
      if (!pass || !name) await askLogin();
      try { await sync(true); break; }
      catch (e) {
        if (e.code === 'permission-denied') continue;
        if (ver > 0) break;                       // มีข้อมูลที่แคชไว้ ใช้ต่อแบบออฟไลน์ไปก่อน
        loginMsg = e.message; pass = ''; save();
      }
    }
    started = true; badge();
    if (!(('users/' + uid) in store) || store['users/' + uid].name !== name) db.doc('users/' + uid).set({ name }).catch(() => {});
    setInterval(() => { if (document.visibilityState === 'visible') sync().catch(() => {}); }, POLL);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync().catch(() => {}); });
    window.addEventListener('online', () => sync().catch(() => {}));
  })();

  const user = { id: async () => uid, can: () => true, profiles: async ids => Object.fromEntries((ids || []).map(i => [i, { name: (store['users/' + i] || {}).name || 'สมาชิก' }])) };
  window.claude = { use: async n => { if (n === 'db') { await ready; return db; } if (n === 'user') { await ready; return user; } if (n === 'downloads') return window.__downloads; throw err('unavailable', n + ' ไม่รองรับนอก Claude'); } };
})();
