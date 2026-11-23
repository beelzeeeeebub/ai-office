/**
 * AI Office · Arsco × Investment — Google Apps Script (MODE ASLI) v13 (+ API JSON untuk GitHub Pages)
 * v13: kolom "Perintah" di web: POST action 'chat' (teks + file + link) -> file ke Drive "AI Office Uploads",
 *      baris Obrolan Kris -> bot, lalu bangunkan bot lewat webhook (event 'chat'). GET ?api=chat = riwayat chat Kris.
 *      Approve juga mengabari Arsip (event 'archive') supaya file final masuk Grok Bot Library.
 * v12: Approve/Revisi dari web LANGSUNG membangunkan bot pemilik tugas lewat webhook routine-nya
 *      (Script Property WEBHOOK_<ID>_URL + WEBHOOK_<ID>_KEY), dicoba ulang 1x kalau gagal, cadangan lewat Jon,
 *      hasilnya dicatat di Activity + kolom tahap, dan dikirim balik ke web (field "wake").
 *      Penjaga opsional: resendStaleRevisions() tiap 10 menit (pasang sekali dengan installWatchdog()).
 * Membaca Google Sheet "AI Office - Status" dan menampilkan kantor AI.
 * Halaman (index.html) cek Sheet tiap 5 detik lewat getState().
 * Approve / revisi dari pop-up hasil lewat approveTask() & reviseTask() (mode asli).
 */
var SHEET_ID = '1a1gj5z_toocN8n4ov8DvEPh-xBSkr1zTdkiT8gaEbqw';          // Sheet "AI Office - Status" (folder Grok Arsco)
var IMAGE_FILE_ID = '1sCrtHVBIKsfxWRjNbodYSe3OfNINK9AO';     // Gambar kantor "AI Office - background.jpg" (privat, dibaca sebagai akun kamu)
var DEMO_MODE = false;                  // false = MODE ASLI: hanya data Sheet asli, tombol Latihan & Reset disembunyikan & dimatikan.
var TZ = 'Asia/Jakarta';

/**
 * v11 — doGet:
 *   tanpa ?api            -> halaman HtmlService seperti biasa (index)
 *   ?api=state            -> JSON state (sama dengan getState()); ?callback=fn untuk JSONP
 *   ?api=ping             -> {ok:true,...} cek koneksi
 * Frontend statis (GitHub Pages) memakai ?api=state dengan fetch (CORS: Apps Script
 * mengalihkan ke googleusercontent.com yang mengizinkan origin mana pun).
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.api) {
    try {
      if (p.api === 'state') return jsonOut_(getState(), p.callback);
      if (p.api === 'chat') return jsonOut_(JSON.stringify(chatHistory_(p.bot, p.limit)), p.callback);
      if (p.api === 'ping') return jsonOut_(JSON.stringify({ ok: true, version: 'v13', serverTime: now_(), wake: wakeMap_(), features: ['chat', 'archive'] }), p.callback);
      return jsonOut_(JSON.stringify({ ok: false, error: 'api tidak dikenal: ' + p.api }), p.callback);
    } catch (err) {
      return jsonOut_(JSON.stringify({ ok: false, error: String(err && err.message || err) }), p.callback);
    }
  }
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('AI Office · Arsco × Investment')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * v11 — doPost: body teks JSON (kirim dengan Content-Type text/plain supaya tanpa preflight CORS):
 *   {"action":"approve","task_id":"T-0003"}
 *   {"action":"revise","task_id":"T-0003","note":"catatan revisi"}
 *   {"action":"obrolan","dari":"Cio","ke":"Anna","task_id":"T-0002","ringkas":"…","isi":"…"}
 *   v13: {"action":"chat","to":"Jon","text":"…","task_id":"T-0007","files":[{"name","mime","dataBase64"}],"links":["https://…"]}
 *        -> {"ok":true,"chat_id":"C-…","wake":{…},"files":[{name,url}]}
 * Semua action WAJIB menyertakan "key" = Script Property WEB_KEY (Project Settings > Script Properties).
 * Kalau WEB_KEY belum di-set, approve/revise ditolak. GET ?api=state tetap terbuka (baca saja).
 * Jalur lama google.script.run (halaman HtmlService, approveTask/reviseTask) tidak memakai key.
 * Balasan: {"ok":true,"msg":"…","wake":{"status":"ok|fail|none","agent":"Prop","via":"Prop|Jon"}} atau {"ok":false,"error":"…"}.
 */
function doPost(e) {
  var out;
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    var b = raw ? JSON.parse(raw) : ((e && e.parameter) || {});
    var act = String(b.action || '').toLowerCase();
    checkWebKey_(act, b.key);
    if (act === 'approve') {
      var ra = approveTask_(b.task_id || b.taskId);
      out = { ok: true, msg: ra.msg, wake: ra.wake || null, archive: ra.archive || null };
    } else if (act === 'revise' || act === 'revisi') {
      var rr = reviseTask_(b.task_id || b.taskId, b.note || b.catatan);
      out = { ok: true, msg: rr.msg, wake: rr.wake || null };
    } else if (act === 'chat') {
      out = chatSend_(b);
    } else if (act === 'obrolan') {
      if (!b.dari) throw new Error('dari wajib diisi');
      logObrolan(b.dari, b.ke, b.task_id || b.taskId, b.ringkas, b.isi);
      out = { ok: true, msg: 'Obrolan tercatat' };
    } else {
      throw new Error('action tidak dikenal: ' + act);
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return jsonOut_(JSON.stringify(out));
}

/** Cek kunci rahasia untuk doPost. Error diawali "KEY:" supaya frontend tahu harus minta kunci lagi. */
function checkWebKey_(act, key) {
  var want = PropertiesService.getScriptProperties().getProperty('WEB_KEY');
  if (!want) throw new Error('WEB_KEY belum di-set di Script Properties');
  if (!safeEq_(String(key == null ? '' : key), String(want))) throw new Error('KEY: kunci salah atau kosong');
}
/** Perbandingan string (hampir) constant-time. */
function safeEq_(a, b) {
  var n = Math.max(a.length, b.length), d = a.length ^ b.length;
  for (var i = 0; i < n; i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

/** Keluarkan JSON (string) lewat ContentService; kalau ada callback valid -> JSONP. */
function jsonOut_(jsonStr, callback) {
  if (callback && /^[A-Za-z_$][A-Za-z0-9_$.]{0,60}$/.test(String(callback))) {
    return ContentService.createTextOutput(callback + '(' + jsonStr + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(jsonStr).setMimeType(ContentService.MimeType.JSON);
}

/** Dipanggil halaman tiap 5 detik. */
function getState() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var agents = readTab_(ss, 'Agents'), tasks = readTab_(ss, 'Tasks'), activity = readTab_(ss, 'Activity');
  if (!DEMO_MODE) {            // mode asli: buang sisa baris DEMO kalau masih ada
    tasks = tasks.filter(function (t) { return !isDemo_(t.task_id); });
    activity = activity.filter(function (a) { return !/^DEMO\s*·/.test(String(a.aksi || '')); });
    agents.forEach(function (a) { if (isDemo_(a.tugas_aktif)) a.tugas_aktif = ''; });
  }
  return JSON.stringify({
    agents: agents,
    tasks: tasks,
    activity: activity,
    obrolan: recentObrolan_(ss),
    demoMode: DEMO_MODE,
    wake: wakeMap_(),
    serverTime: now_()
  });
}

/** Gambar latar kantor (dari Drive, tidak perlu dishare publik). */
function getBackground() {
  var blob = DriveApp.getFileById(IMAGE_FILE_ID).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

// ---------------- helper (boleh dipakai manual dari editor) ----------------
/** 40 baris terakhir tab Obrolan dalam 24 jam terakhir (untuk bubble omongan & thread). */
function recentObrolan_(ss) {
  var rows = readTab_(ss, 'Obrolan');
  if (!rows.length) return [];
  var batas = Utilities.formatDate(new Date(Date.now() - 24 * 3600 * 1000), TZ, 'yyyy-MM-dd HH:mm');
  rows = rows.filter(function (o) { return o.dari && waktuStd_(o.waktu) >= batas; });
  return rows.slice(-40);
}
/** '2026-11-12 9:05' -> '2026-11-12 09:05' supaya bisa dibandingkan sebagai teks. */
function waktuStd_(w) {
  var m = String(w || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return '';
  function p(x) { return ('0' + x).slice(-2); }
  return m[1] + '-' + p(m[2]) + '-' + p(m[3]) + ' ' + p(m[4]) + ':' + m[5];
}
/** Bot mencatat obrolan: logObrolan('Anna','Cio','T-0003','Minta data BTC 1 bulan','isi lengkap…') */
function logObrolan(dari, ke, taskId, ringkas, isi) {
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Obrolan');
  if (!sh) { sh = SpreadsheetApp.openById(SHEET_ID).insertSheet('Obrolan'); sh.getRange(1, 1, 1, 6).setValues([['waktu', 'dari', 'ke', 'task_id', 'ringkas', 'isi']]); }
  ringkas = String(ringkas || isi || '').replace(/\s+/g, ' ').trim();
  if (ringkas.length > 60) ringkas = ringkas.slice(0, 59) + '…';
  sh.getRange(sh.getLastRow() + 1, 1, 1, 6).setNumberFormat('@').setValues([[now_(), dari, ke || 'semua', taskId || '', ringkas, isi || ringkas]]);
}

// ---------------- WEBHOOK PER AGENT (v12) ----------------
/**
 * Setelah Approve/Revisi dari web, bangunkan bot pemilik tugas lewat routine webhook-nya.
 * Script Properties (Project Settings > Script Properties):
 *   WEBHOOK_<ID>_URL   Webhook URL routine "AI Office webhook" bot itu (mis. WEBHOOK_PROP_URL)
 *   WEBHOOK_<ID>_KEY   Webhook key routine itu (dikirim sebagai header Authorization: Bearer <key>)
 *   WEBHOOK_KEY_HEADER (opsional, default "Authorization")
 *   WEBHOOK_FALLBACK   (opsional, default "Jon") bot cadangan kalau bot pemilik belum punya webhook;
 *                      bot cadangan menerima payload yang sama + for_agent, lalu meneruskan ke bot pemilik.
 * Tidak pernah membuat aksi Kris gagal. Kembalian: {status:'ok'|'fail'|'none', agent, via, code}
 */
function propKey_(id) { return String(id || '').toUpperCase().replace(/[^A-Z0-9]/g, '_'); }

/** Peta agent -> true kalau WEBHOOK_<ID>_URL sudah di-set (tanpa membocorkan URL/key). */
function wakeMap_() {
  var out = {};
  try {
    var all = PropertiesService.getScriptProperties().getProperties();
    Object.keys(all).forEach(function (k) {
      var m = k.match(/^WEBHOOK_(.+)_URL$/);
      if (m && /^https:\/\//.test(String(all[k] || ''))) out[m[1]] = true;
    });
  } catch (e) {}
  return out;
}

function postWebhook_(url, key, payload) {
  var hName = PropertiesService.getScriptProperties().getProperty('WEBHOOK_KEY_HEADER') || 'Authorization';
  var headers = {};
  if (key) headers[hName] = (hName.toLowerCase() === 'authorization' && !/^(Bearer|Basic)\s/i.test(key)) ? 'Bearer ' + key : key;
  var res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', headers: headers,
    payload: JSON.stringify(payload), muteHttpExceptions: true, followRedirects: true });
  return res.getResponseCode();
}

/**
 * Kirim payload ke webhook bot `agentId` (cadangan: WEBHOOK_FALLBACK, default Jon, dengan for_agent).
 * logLabel: teks pendek untuk baris Activity. Kembalian {status:'ok'|'fail'|'none', agent, via, code}.
 */
function sendWebhook_(agentId, payload, logLabel) {
  var info = { status: 'none', agent: agentId || '', via: '', code: 0 };
  try {
    if (!agentId) return info;
    var props = PropertiesService.getScriptProperties();
    var fbName = String(props.getProperty('WEBHOOK_FALLBACK') || 'Jon').trim();
    var own = propKey_(agentId), fb = propKey_(fbName);
    var target = own, url = props.getProperty('WEBHOOK_' + own + '_URL');
    if (!url && fb && fb !== own) { target = fb; url = props.getProperty('WEBHOOK_' + fb + '_URL'); }
    var viaName = target === own ? agentId : fbName;
    if (!url) {
      addLog('Sistem', logLabel + ': ' + agentId + ' belum tersambung webhook (WEBHOOK_' + own + '_URL kosong) — tercatat di Sheet, bot baru kerja saat dibuka/di-chat');
      return info;
    }
    var key = props.getProperty('WEBHOOK_' + target + '_KEY');
    payload.for_agent = agentId; payload.via = viaName;
    if (!payload.sheet_id) payload.sheet_id = SHEET_ID;
    if (!payload.waktu) payload.waktu = now_();
    var code = 0, err = '';
    for (var attempt = 0; attempt < 2; attempt++) {
      try { code = postWebhook_(url, key, payload); err = ''; } catch (e) { code = 0; err = String(e && e.message || e).slice(0, 80); }
      if (code >= 200 && code < 300) break;
      if (code >= 400 && code < 500 && code !== 408 && code !== 429) break;   // URL/key salah: tidak perlu dicoba ulang
      Utilities.sleep(1500);
    }
    var ok = code >= 200 && code < 300;
    info = { status: ok ? 'ok' : 'fail', agent: agentId, via: viaName, code: code };
    addLog('Sistem', 'Webhook ' + logLabel + ' → ' + viaName + (viaName !== agentId ? ' (untuk ' + agentId + ')' : '') + ': ' + (ok ? 'OK ' + code : 'gagal ' + (code || err)));
  } catch (e) {
    info.status = 'fail';
    try { addLog('Sistem', 'Webhook ' + logLabel + ' → ' + agentId + ': error ' + String(e && e.message || e).slice(0, 80)); } catch (e2) {}
  }
  return info;
}

function notifyAgent_(event, t, catatan, extra) {
  if (!t || !t.agent) return { status: 'none', agent: '', via: '', code: 0 };
  var resend = !!(extra && extra.resend);
  var payload = {
    event: event,                                   // 'revisi' | 'approve' (dipakai routine lama)
    action: event === 'approve' ? 'approve' : 'revise',
    task_id: t.task_id, agent: t.agent, agent_id: t.agent,
    judul: t.judul || '', status: event === 'approve' ? 'Selesai' : 'Revisi',
    catatan: catatan || '', catatan_revisi: (extra && extra.catatan_revisi) || t.catatan_revisi || '',
    link_file: t.link_file || '', tipe_hasil: t.tipe_hasil || '',
    resend: resend
  };
  return sendWebhook_(t.agent, payload, (event === 'approve' ? 'approve ' : 'revisi ') + (resend ? '(ulang) ' : '') + t.task_id);
}

/** v13: tugas divisi Investment (Anna, Cio, ruang INVESTMENT) TIDAK masuk arsip Library Arsco.
 *  Script Property ARCHIVE_EXCLUDE (opsional) = daftar id dipisah koma, default "Anna,Cio". */
function archiveAllowed_(t) {
  var ex = String(PropertiesService.getScriptProperties().getProperty('ARCHIVE_EXCLUDE') || 'Anna,Cio').split(',').map(function (x) { return x.trim(); }).filter(String);
  if (ex.indexOf(String(t.agent || '')) >= 0) return false;
  try {
    var a = agentRow_(SpreadsheetApp.openById(SHEET_ID), t.agent);
    if (a && (String(a.divisi || '') === 'Investment' || String(a.ruangan_kerja || '').toUpperCase() === 'INVESTMENT')) return false;
  } catch (e) {}
  return true;
}

/** v13: setelah approve, kabari Arsip supaya file final disimpan ke Grok Bot Library. */
function notifyArchive_(t) {
  if (!t || !t.task_id) return null;
  var arsip = String(PropertiesService.getScriptProperties().getProperty('ARCHIVE_AGENT') || 'Arsip').trim();
  if (!arsip || arsip === 'off') return null;
  return sendWebhook_(arsip, { event: 'archive', action: 'archive', task_id: t.task_id, agent: t.agent || '',
    judul: t.judul || '', link_file: t.link_file || '', gambar: t.gambar || '', tipe_hasil: t.tipe_hasil || '' }, 'archive ' + t.task_id);
}

/** Tulis hasil "bangunkan bot" ke kolom tahap supaya terlihat di web. */
function wakeTahap_(event, info) {
  var a = info.agent || 'bot';
  if (event === 'approve') return info.status === 'ok' ? 'Di-approve Kris (web) · ' + info.via + ' dikabari' : 'Di-approve Kris (web)';
  if (info.status === 'ok') return 'Revisi diproses ' + a + (info.via !== a ? ' (lewat ' + info.via + ')' : '');
  if (info.status === 'fail') return 'Revisi dari Kris · gagal membangunkan ' + a + ', chat ' + a;
  return 'Revisi dari Kris · menunggu ' + a + ' dibuka (webhook belum dipasang)';
}

/**
 * Penjaga (opsional): revisi yang 15+ menit belum disentuh bot dikirim ulang SEKALI.
 * Pasang sekali: jalankan installWatchdog() dari editor (minta izin trigger).
 */
function resendStaleRevisions() {
  if (DEMO_MODE) return;
  var ss = SpreadsheetApp.openById(SHEET_ID), props = PropertiesService.getScriptProperties();
  var batas = Utilities.formatDate(new Date(Date.now() - 15 * 60 * 1000), TZ, 'yyyy-MM-dd HH:mm');
  var hari = Utilities.formatDate(new Date(Date.now() - 24 * 3600 * 1000), TZ, 'yyyy-MM-dd HH:mm');
  readTab_(ss, 'Tasks').forEach(function (t) {
    if (t.status !== 'Revisi' || String(t.jon_todo || '').toUpperCase() !== 'REVISI') return;
    var w = waktuStd_(t.diperbarui);
    if (!w || w > batas || w < hari) return;
    var pk = 'RESENT_' + propKey_(t.task_id);
    if (props.getProperty(pk) === w) return;            // sudah dikirim ulang untuk revisi ini
    props.setProperty(pk, w);
    var info = notifyAgent_('revisi', t, lastNote_(t.catatan_revisi), { resend: true });
    if (info.status === 'ok') setRow_('Tasks', t.task_id, { tahap: wakeTahap_('revisi', info) + ' · dikirim ulang' });
  });
}
function installWatchdog() {
  // dijalankan sekali dari editor (Run). Aman dijalankan ulang: trigger lama diganti.
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'resendStaleRevisions') ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('resendStaleRevisions').timeBased().everyMinutes(10).create();
  return 'Penjaga revisi aktif (tiap 10 menit)';
}
/** Catatan terakhir dari kolom catatan_revisi ("[waktu] isi" per baris). */
function lastNote_(hist) {
  var L = String(hist || '').split('\n').filter(function (x) { return x.trim(); });
  return L.length ? L[L.length - 1].replace(/^\[[^\]]*\]\s*/, '') : '';
}
/** Tes manual dari editor: kirim webhook 'ping' ke satu bot tanpa mengubah tugas. testWebhook('Prop') */
function testWebhook(agentId) {
  var props = PropertiesService.getScriptProperties(), k = propKey_(agentId || 'Jon');
  var url = props.getProperty('WEBHOOK_' + k + '_URL');
  if (!url) { console.log('WEBHOOK_' + k + '_URL belum di-set'); return 'WEBHOOK_' + k + '_URL belum di-set'; }
  var code = postWebhook_(url, props.getProperty('WEBHOOK_' + k + '_KEY'), { event: 'ping', agent: agentId, waktu: now_(),
    catatan: 'Tes koneksi dari AI Office. Tidak ada tugas, cukup balas Kris "webhook AI Office tersambung".' });
  console.log('WEBHOOK_' + k + ' → HTTP ' + code);
  return 'WEBHOOK_' + k + ' → HTTP ' + code;
}

function isDemo_(v) { return /T-DEMO-|^DEMO\s*·|\(DEMO\)/.test(String(v || '')); }   // penanda baris contoh lama
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }

function readTab_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getDisplayValues();
  var h = v.shift().map(function (s) { return String(s).trim(); });
  return v.filter(function (r) { return r.some(function (c) { return c !== ''; }); })
    .map(function (r) { var o = {}; h.forEach(function (k, i) { o[k] = r[i]; }); return o; });
}

/** Ubah satu baris berdasarkan kolom pertama (id / task_id). Contoh: setRow_('Agents','Prop',{status:'Bekerja'}) */
function setRow_(tab, id, fields) {
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(tab);
  var v = sh.getDataRange().getValues(), h = v[0];
  for (var r = 1; r < v.length; r++) {
    if (String(v[r][0]) === id) {
      Object.keys(fields).forEach(function (k) {
        var c = h.indexOf(k); if (c >= 0) sh.getRange(r + 1, c + 1).setNumberFormat('@').setValue(fields[k] == null ? '' : String(fields[k]));
      });
      return true;
    }
  }
  return false;
}
function setAgent(id, fields) { fields.update_terakhir = now_(); return setRow_('Agents', id, fields); }
function setTask(id, fields) { fields.diperbarui = now_(); return setRow_('Tasks', id, fields); }
function addLog(agent, aksi) {
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Activity');
  sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setNumberFormat('@').setValues([[now_(), agent, aksi]]);
}

// ---------------- APPROVE & REVISI DARI WEB (mode asli) ----------------
var TASK_EXTRA_COLS = ['gambar', 'catatan_revisi', 'jon_todo'];

/** Pastikan kolom tambahan ada di header Tasks (ditambah di ujung kanan, baris lain tidak disentuh). */
function ensureTaskCols_(sh) {
  var lastCol = Math.max(1, sh.getLastColumn());
  var h = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (x) { return String(x).trim(); });
  while (h.length && h[h.length - 1] === '') h.pop();
  var miss = TASK_EXTRA_COLS.filter(function (c) { return h.indexOf(c) < 0; });
  if (miss.length) {
    if (sh.getMaxColumns() < h.length + miss.length) sh.insertColumnsAfter(sh.getMaxColumns(), h.length + miss.length - sh.getMaxColumns());
    sh.getRange(1, h.length + 1, 1, miss.length).setValues([miss]);
    h = h.concat(miss);
  }
  return h;
}

function webTaskAction_(taskId, fn) {
  if (DEMO_MODE) throw new Error('Approve/revisi dari web hanya aktif di mode asli (DEMO_MODE = false).');
  taskId = String(taskId || '').trim();
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(taskId)) throw new Error('task_id tidak valid: ' + taskId);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Sheet sedang dipakai, coba lagi sebentar.');
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID), sh = ss.getSheetByName('Tasks');
    if (!sh) throw new Error('Tab Tasks tidak ada.');
    var h = ensureTaskCols_(sh);
    var ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues() : [];
    var r = -1;
    for (var i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === taskId) { r = i + 2; break; }
    if (r < 0) throw new Error('Tugas ' + taskId + ' tidak ditemukan di Sheet.');
    var row = sh.getRange(r, 1, 1, h.length).getDisplayValues()[0], t = {};
    h.forEach(function (k, j) { t[k] = row[j]; });
    var res = fn(t, function (fields) {
      Object.keys(fields).forEach(function (k) {
        var c = h.indexOf(k); if (c >= 0) sh.getRange(r, c + 1).setNumberFormat('@').setValue(String(fields[k] == null ? '' : fields[k]));
      });
    }, ss);
    SpreadsheetApp.flush();
    return res;
  } finally { lock.releaseLock(); }
}

/** Data agent (baris Agents) berdasarkan id. */
function agentRow_(ss, id) {
  var rows = readTab_(ss, 'Agents');
  for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
  return null;
}
/** Agent ini sedang pegang tugas taskId? (atau tidak pegang tugas lain) */
function agentOnTask_(a, taskId) {
  var ta = String(a.tugas_aktif || '');
  return !ta || ta.indexOf(taskId) >= 0 || a.status === 'Menunggu approve' || a.status === 'Idle';
}

/** Dipanggil tombol "✓ Approve" di pop-up hasil (google.script.run: kembalian teks). */
function approveTask(taskId) { return approveTask_(taskId).msg; }
function approveTask_(taskId) {
  var r = webTaskAction_(taskId, function (t, setT, ss) {
    if (t.status === 'Selesai') return 'Tugas ' + t.task_id + ' sudah Selesai.';
    var waktu = now_();
    setT({ status: 'Selesai', tahap: 'Di-approve Kris (web)', diperbarui: waktu, jon_todo: 'APPROVE' });
    var a = t.agent && agentRow_(ss, t.agent);
    if (a && agentOnTask_(a, t.task_id)) setAgent(t.agent, { status: 'Idle', ruangan_sekarang: 'CAFE', tugas_aktif: '' });
    addLog('Kris', 'Kris approve ' + t.task_id + ' via web');
    return { msg: 'Approve ' + t.task_id + ' tersimpan', t: t };
  });
  if (typeof r === 'string') return { msg: r, wake: null };
  var info = notifyAgent_('approve', r.t, '');
  if (info.status === 'ok') { try { setRow_('Tasks', r.t.task_id, { tahap: wakeTahap_('approve', info) }); } catch (e) {} }
  var arc = null;
  if (r.t.agent !== 'Arsip' && (r.t.link_file || r.t.gambar) && archiveAllowed_(r.t)) arc = notifyArchive_(r.t);
  return { msg: r.msg + wakeMsg_('approve', info) + (arc && arc.status === 'ok' ? ' · Arsip dikabari untuk Library' : ''), wake: info, archive: arc };
}

/** Dipanggil tombol "↻ Kirim revisi". note = catatan revisi dari Kris. */
function reviseTask(taskId, note) { return reviseTask_(taskId, note).msg; }
function reviseTask_(taskId, note) {
  note = String(note || '').replace(/\r/g, '').trim();
  if (!note) throw new Error('Catatan revisi masih kosong.');
  if (note.length > 3000) note = note.slice(0, 3000);
  var r = webTaskAction_(taskId, function (t, setT, ss) {
    var waktu = now_();
    var hist = String(t.catatan_revisi || '').trim();
    var all = (hist ? hist + '\n' : '') + '[' + waktu + '] ' + note;
    setT({ status: 'Revisi', tahap: 'Revisi dari Kris', diperbarui: waktu, jon_todo: 'REVISI', catatan_revisi: all });
    t.catatan_revisi = all;
    var a = t.agent && agentRow_(ss, t.agent);
    if (a) setAgent(t.agent, { status: 'Bekerja', ruangan_sekarang: a.ruangan_kerja || 'CAFE',
      tugas_aktif: t.task_id + ' · Revisi: ' + String(t.judul || '').slice(0, 80) });
    var pendek = note.replace(/\s+/g, ' '); if (pendek.length > 80) pendek = pendek.slice(0, 77) + '…';
    addLog('Kris', 'Kris minta revisi ' + t.task_id + ': ' + pendek);
    try { logObrolan('Kris', t.agent || 'semua', t.task_id, 'Tolong revisi ya', note); } catch (e) {}
    return { msg: 'Revisi ' + t.task_id + ' terkirim', t: t };
  });
  var info = notifyAgent_('revisi', r.t, note, { catatan_revisi: r.t.catatan_revisi });
  try { setRow_('Tasks', r.t.task_id, { tahap: wakeTahap_('revisi', info) }); } catch (e) {}
  return { msg: r.msg + wakeMsg_('revisi', info), wake: info };
}
function wakeMsg_(event, info) {
  if (!info || !info.agent) return '';
  if (info.status === 'ok') return ', ' + info.agent + (info.via !== info.agent ? ' dikabari lewat ' + info.via : ' langsung dibangunkan') + ' ⚡';
  if (info.status === 'fail') return ', tapi gagal membangunkan ' + info.agent + ' — chat ' + info.agent + ' langsung';
  return event === 'approve' ? '' : ', tapi ' + info.agent + ' belum tersambung webhook — chat ' + info.agent + ' supaya langsung dikerjakan';
}

// ---------------- v13: CHAT "PERINTAH" DARI WEB ----------------
var CHAT_MAX_FILES = 5;
var CHAT_MAX_FILE_BYTES = 10 * 1024 * 1024;     // per file
var CHAT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;    // total per pesan (Apps Script menerima body POST ±50 MB; base64 +33%)
var CHAT_MAX_TEXT = 4000;

/** Daftar id agent dari tab Agents. */
function agentIds_(ss) { return readTab_(ss, 'Agents').map(function (a) { return String(a.id || '').trim(); }).filter(String); }

/** Folder Drive untuk upload: Script Property UPLOAD_FOLDER_ID, atau buat/pakai "AI Office Uploads" lalu simpan id-nya. */
function uploadFolder_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('UPLOAD_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { throw new Error('UPLOAD_FOLDER_ID tidak bisa dibuka: ' + String(e && e.message || e).slice(0, 80)); } }
  var it = DriveApp.getFoldersByName('AI Office Uploads');
  var f = it.hasNext() ? it.next() : DriveApp.createFolder('AI Office Uploads');
  props.setProperty('UPLOAD_FOLDER_ID', f.getId());
  return f;
}

function cleanName_(n) {
  n = String(n || 'file').replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim();
  return (n || 'file').slice(0, 120);
}

/** Jalankan sekali dari editor (Run) setelah deploy v13: memicu izin Drive & membuat folder "AI Office Uploads". */
function setupUploads() {
  var f = uploadFolder_();
  console.log('Folder upload siap: ' + f.getName() + ' (' + f.getId() + ')');
  return f.getId();
}

/** Pesan Kris -> bot. b = {to, text, task_id?, files:[{name,mime,dataBase64}], links:[...]} */
function chatSend_(b) {
  if (DEMO_MODE) throw new Error('Chat hanya aktif di mode asli.');
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var to = String(b.to || 'Jon').trim();
  var ids = agentIds_(ss);
  if (ids.indexOf(to) < 0) throw new Error('Penerima tidak dikenal: ' + to);
  var text = String(b.text || '').replace(/\r/g, '').trim();
  if (text.length > CHAT_MAX_TEXT) throw new Error('Pesan terlalu panjang (maks ' + CHAT_MAX_TEXT + ' karakter).');
  var taskId = String(b.task_id || '').trim();
  if (taskId && !/^[A-Za-z0-9._-]{1,40}$/.test(taskId)) throw new Error('task_id tidak valid: ' + taskId);
  var links = (Array.isArray(b.links) ? b.links : []).map(String).filter(function (u) { return /^https?:\/\/\S+$/i.test(u); }).slice(0, 20);
  var files = Array.isArray(b.files) ? b.files : [];
  if (!text && !files.length && !links.length) throw new Error('Pesan kosong.');
  if (files.length > CHAT_MAX_FILES) throw new Error('Maksimal ' + CHAT_MAX_FILES + ' file per pesan.');
  // cek ukuran dulu sebelum menyimpan apa pun
  var total = 0, blobs = [];
  files.forEach(function (f, i) {
    var name = cleanName_(f && f.name), data = String((f && f.dataBase64) || '').replace(/^data:[^,]*,/, '');
    if (!data) throw new Error('File "' + name + '" kosong.');
    var bytes;
    try { bytes = Utilities.base64Decode(data); } catch (e) { throw new Error('File "' + name + '" rusak (base64 tidak valid).'); }
    if (bytes.length > CHAT_MAX_FILE_BYTES) throw new Error('File "' + name + '" terlalu besar (maks 10 MB per file). Taruh di Drive lalu kirim link-nya.');
    total += bytes.length;
    if (total > CHAT_MAX_TOTAL_BYTES) throw new Error('Total lampiran lebih dari 20 MB. Kirim sebagian dulu, atau pakai link Drive.');
    blobs.push(Utilities.newBlob(bytes, String((f && f.mime) || 'application/octet-stream').slice(0, 100), name));
  });
  var chatId = 'C-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 9000 + 1000);
  var fileLinks = [];
  if (blobs.length) {
    var folder = uploadFolder_(), pub = String(PropertiesService.getScriptProperties().getProperty('UPLOAD_PUBLIC') || '').toLowerCase() === 'true';
    blobs.forEach(function (bl) {
      var file = folder.createFile(bl);
      try { file.setDescription('AI Office · ' + chatId + ' · Kris → ' + to + (taskId ? ' · ' + taskId : '')); } catch (e) {}
      if (pub) { try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {} }
      fileLinks.push({ name: file.getName(), url: file.getUrl(), id: file.getId(), mime: bl.getContentType(), size: bl.getBytes().length });
    });
  }
  var ringkas = (text || (fileLinks.length ? '📎 ' + fileLinks.length + ' file' : '🔗 link')).replace(/\s+/g, ' ');
  if (ringkas.length > 40) ringkas = ringkas.slice(0, 39) + '…';
  var isi = text;
  if (fileLinks.length) isi += (isi ? '\n\n' : '') + 'Lampiran:\n' + fileLinks.map(function (f) { return '- ' + f.name + ': ' + f.url; }).join('\n');
  if (links.length) isi += (isi ? '\n\n' : '') + 'Link:\n' + links.map(function (u) { return '- ' + u; }).join('\n');
  logObrolanRow_(['Kris', to, taskId, ringkas, isi, chatId]);
  addLog('Kris', 'Kris kirim perintah ke ' + to + (taskId ? ' (' + taskId + ')' : '') + ': ' + ringkas + (fileLinks.length ? ' · ' + fileLinks.length + ' file' : ''));
  var wake = sendWebhook_(to, { event: 'chat', action: 'chat', from: 'Kris', to: to, text: text, task_id: taskId,
    file_links: fileLinks, links: links, chat_id: chatId }, 'chat ' + chatId + ' Kris→' + to);
  return { ok: true, msg: 'Pesan ke ' + to + ' terkirim', chat_id: chatId, wake: wake, files: fileLinks.map(function (f) { return { name: f.name, url: f.url }; }) };
}

/** Tulis satu baris Obrolan [dari, ke, task_id, ringkas, isi, chat_id]; kolom chat_id ditambahkan kalau belum ada. */
function logObrolanRow_(r) {
  var ss = SpreadsheetApp.openById(SHEET_ID), sh = ss.getSheetByName('Obrolan');
  if (!sh) { sh = ss.insertSheet('Obrolan'); sh.getRange(1, 1, 1, 7).setValues([['waktu', 'dari', 'ke', 'task_id', 'ringkas', 'isi', 'chat_id']]); }
  var lastCol = Math.max(6, sh.getLastColumn());
  var h = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (x) { return String(x).trim(); });
  var c = h.indexOf('chat_id');
  if (c < 0) { c = Math.max(6, h.filter(String).length); if (sh.getMaxColumns() < c + 1) sh.insertColumnsAfter(sh.getMaxColumns(), c + 1 - sh.getMaxColumns()); sh.getRange(1, c + 1).setValue('chat_id'); }
  var row = [now_(), r[0], r[1] || 'semua', r[2] || '', r[3] || '', r[4] || r[3] || ''];
  while (row.length < c) row.push('');
  row[c] = r[5] || '';
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
}

/** Riwayat chat Kris <-> bot (7 hari, maks 300 baris). bot opsional = satu bot saja. */
function chatHistory_(bot, limit) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var n = Math.max(1, Math.min(300, Number(limit) || 200));
  var batas = Utilities.formatDate(new Date(Date.now() - 7 * 24 * 3600 * 1000), TZ, 'yyyy-MM-dd HH:mm');
  var rows = readTab_(ss, 'Obrolan').filter(function (o) {
    if (!o.dari || waktuStd_(o.waktu) < batas) return false;
    var withKris = o.dari === 'Kris' || o.ke === 'Kris';
    if (!withKris) return false;
    if (bot) return o.dari === bot || o.ke === bot;
    return true;
  }).map(function (o) { return { waktu: o.waktu, dari: o.dari, ke: o.ke, task_id: o.task_id || '', ringkas: o.ringkas || '', isi: o.isi || '', chat_id: o.chat_id || '' }; });
  return { ok: true, version: 'v13', messages: rows.slice(-n), wake: wakeMap_(), serverTime: now_() };
}

// ---------------- MODE LATIHAN (DEMO) ----------------
var SEED = {
 "agents": [
  {
   "id": "Jon",
   "nama": "Jon · Boss",
   "divisi": "Boss",
   "ruangan_kerja": "BOSS",
   "ruangan_sekarang": "BOSS",
   "status": "Bekerja",
   "tugas_aktif": "DEMO · Pantau T-DEMO-01 & antrean review",
   "update_terakhir": "2026-11-11 16:05"
  },
  {
   "id": "Prop",
   "nama": "Prop · Proposal",
   "divisi": "Arsco",
   "ruangan_kerja": "ENGINEER",
   "ruangan_sekarang": "ENGINEER",
   "status": "Bekerja",
   "tugas_aktif": "T-DEMO-01 · Proposal STP PT Contoh Demo",
   "update_terakhir": "2026-11-11 16:05"
  },
  {
   "id": "Flow",
   "nama": "Flow · Diagram",
   "divisi": "Arsco",
   "ruangan_kerja": "ENGINEER",
   "ruangan_sekarang": "ENGINEER",
   "status": "Serah-terima",
   "tugas_aktif": "T-DEMO-01F · Diagram alur → serahkan ke Prop",
   "update_terakhir": "2026-11-11 15:40"
  },
  {
   "id": "Tridi",
   "nama": "Tridi · 3D Model",
   "divisi": "Arsco",
   "ruangan_kerja": "ENGINEER",
   "ruangan_sekarang": "CAFE",
   "status": "Idle",
   "tugas_aktif": "",
   "update_terakhir": "2026-11-11 09:00"
  },
  {
   "id": "Pensi",
   "nama": "Pensi · Deck",
   "divisi": "Arsco",
   "ruangan_kerja": "ENGINEER",
   "ruangan_sekarang": "CAFE",
   "status": "Idle",
   "tugas_aktif": "",
   "update_terakhir": "2026-11-11 09:00"
  },
  {
   "id": "Surja",
   "nama": "Surja · Surat Jalan",
   "divisi": "Arsco",
   "ruangan_kerja": "ADMIN",
   "ruangan_sekarang": "CAFE",
   "status": "Idle",
   "tugas_aktif": "",
   "update_terakhir": "2026-11-11 11:10"
  },
  {
   "id": "Puro",
   "nama": "Puro · Purchase Order",
   "divisi": "Arsco",
   "ruangan_kerja": "ADMIN",
   "ruangan_sekarang": "CAFE",
   "status": "Idle",
   "tugas_aktif": "",
   "update_terakhir": "2026-11-11 09:00"
  },
  {
   "id": "Invo",
   "nama": "Invo · Invoice",
   "divisi": "Arsco",
   "ruangan_kerja": "ADMIN",
   "ruangan_sekarang": "REVIEW",
   "status": "Menunggu approve",
   "tugas_aktif": "T-DEMO-02 · Invoice INV-DEMO-001",
   "update_terakhir": "2026-11-11 13:32"
  },
  {
   "id": "Arsip",
   "nama": "Arsip · Library",
   "divisi": "Arsco",
   "ruangan_kerja": "LIBRARY",
   "ruangan_sekarang": "CAFE",
   "status": "Idle",
   "tugas_aktif": "",
   "update_terakhir": "2026-11-11 09:00"
  },
  {
   "id": "Anna",
   "nama": "Anna · Market Analyst",
   "divisi": "Investment",
   "ruangan_kerja": "INVESTMENT",
   "ruangan_sekarang": "CAFE",
   "status": "Idle",
   "tugas_aktif": "",
   "update_terakhir": "2026-11-11 11:30"
  },
  {
   "id": "Cio",
   "nama": "Cio · Chief Investment",
   "divisi": "Investment",
   "ruangan_kerja": "INVESTMENT",
   "ruangan_sekarang": "INVESTMENT",
   "status": "Selesai",
   "tugas_aktif": "T-DEMO-03 · Report BTC (CONTOH)",
   "update_terakhir": "2026-11-11 10:48"
  }
 ],
 "tasks": [
  {
   "task_id": "T-DEMO-01",
   "judul": "Proposal STP PT Contoh Demo (DEMO)",
   "agent": "Prop",
   "alur": "A Proposal",
   "status": "Bekerja",
   "tahap": "Prop susun BOQ & harga (60%)",
   "link_file": "",
   "tipe_hasil": "doc",
   "data_chart": "",
   "isi_preview": "# PROPOSAL STP — PT CONTOH DEMO\n_DEMO / CONTOH untuk latihan, bukan proposal asli._\n\n## Progres\n- Cover & surat pengantar ✅\n- Diagram alur dari Flow ✅ (serah-terima)\n- BOQ & tabel harga ⏳ 60%\n- Syarat & ketentuan ⏳\n\n## Ringkasan\n**Klien:** PT Contoh Demo\n**Kapasitas:** 50 m³/hari (CONTOH)\n**Lingkup:** Desain, supply, instalasi, commissioning\n\n| No | Pekerjaan | Status |\n|---|---|---|\n| 1 | Preliminary | Selesai |\n| 2 | Mekanikal & elektrikal | Dikerjakan |\n| 3 | Pekerjaan sipil | By Others |\n",
   "dibuat": "2026-11-11 09:02",
   "diperbarui": "2026-11-11 16:05"
  },
  {
   "task_id": "T-DEMO-01F",
   "judul": "Diagram alur STP (DEMO)",
   "agent": "Flow",
   "alur": "A Proposal",
   "status": "Serah-terima",
   "tahap": "Diagram diserahkan ke Prop",
   "link_file": "",
   "tipe_hasil": "text",
   "data_chart": "",
   "isi_preview": "# DIAGRAM ALUR STP — DEMO\n_Contoh untuk latihan._\n\nInlet → Bar Screen → Equalisasi → Aerasi (bakteri) → Clarifier → Filter → Outlet\n\n**Status:** diserahkan ke Prop untuk dimasukkan ke proposal T-DEMO-01.\n",
   "dibuat": "2026-11-11 09:20",
   "diperbarui": "2026-11-11 15:40"
  },
  {
   "task_id": "T-DEMO-02",
   "judul": "Invoice INV-DEMO-001 (DEMO)",
   "agent": "Invo",
   "alur": "C Pengiriman&Tagihan",
   "status": "Menunggu approve",
   "tahap": "Di Ruang Review, menunggu approve Kris",
   "link_file": "",
   "tipe_hasil": "pdf",
   "data_chart": "",
   "isi_preview": "# INVOICE — DEMO / CONTOH\n_Data ini CONTOH untuk latihan, bukan tagihan asli._\n\n**No:** INV-DEMO-001\n**Tanggal:** 11 November 2026\n**Kepada:** PT Contoh Pelanggan (DEMO)\n**PO No:** PO-DEMO-123 · **SJ No:** SJ-DEMO-045\n\n| No | Uraian | Qty | Harga | Jumlah |\n|---|---|---|---|---|\n| 1 | Bakteri pengurai (DEMO) | 10 kg | Rp 150.000 | Rp 1.500.000 |\n| 2 | Jasa commissioning (DEMO) | 1 ls | Rp 3.500.000 | Rp 3.500.000 |\n\n**Subtotal:** Rp 5.000.000\n**PPN 11%:** Rp 550.000\n**TOTAL:** Rp 5.550.000\n\nApprove lewat chat ke Jon atau ke Invo.\n",
   "dibuat": "2026-11-11 13:00",
   "diperbarui": "2026-11-11 13:32"
  },
  {
   "task_id": "T-DEMO-03",
   "judul": "Report BTC (CONTOH data)",
   "agent": "Cio",
   "alur": "Investment",
   "status": "Selesai",
   "tahap": "Report siap dibuka",
   "link_file": "",
   "tipe_hasil": "chart",
   "data_chart": "{\"judul\": \"BTC — Indeks harga CONTOH (bukan harga asli)\", \"labels\": [\"29 Okt\", \"30 Okt\", \"31 Okt\", \"1 Nov\", \"2 Nov\", \"3 Nov\", \"4 Nov\", \"5 Nov\", \"6 Nov\", \"7 Nov\", \"8 Nov\", \"9 Nov\", \"10 Nov\", \"11 Nov\"], \"values\": [100, 102.4, 101.1, 104.8, 107.2, 105.9, 103.3, 106.5, 110.2, 112.8, 109.7, 113.5, 116.1, 114.9]}",
   "isi_preview": "# REPORT BTC — CONTOH DATA\n_Semua angka di sini CONTOH untuk latihan, bukan harga pasar asli._\n\n## Ringkasan\n- Tren 2 minggu: naik (+14,9% di indeks contoh)\n- Support contoh: 103 · Resistance contoh: 116\n- Catatan Anna (makro): suku bunga stabil, sentimen risk-on (CONTOH)\n\n## Kesimpulan\n**Netral-positif (CONTOH).** Bukan saran investasi.\n",
   "dibuat": "2026-11-11 10:15",
   "diperbarui": "2026-11-11 10:48"
  },
  {
   "task_id": "T-DEMO-04",
   "judul": "Ringkasan makro (CONTOH)",
   "agent": "Anna",
   "alur": "Investment",
   "status": "Selesai",
   "tahap": "Dipakai sebagai konteks T-DEMO-03",
   "link_file": "",
   "tipe_hasil": "text",
   "data_chart": "",
   "isi_preview": "# RINGKASAN MAKRO — CONTOH\n_Demo untuk latihan._\n\n- Inflasi bulanan: stabil (CONTOH)\n- Suku bunga acuan: tetap (CONTOH)\n- Rupiah: bergerak sempit (CONTOH)\n\nDipakai Cio sebagai konteks report T-DEMO-03.\n",
   "dibuat": "2026-11-11 10:20",
   "diperbarui": "2026-11-11 11:30"
  }
 ],
 "activity": [
  {
   "waktu": "2026-11-11 09:02",
   "agent": "Jon",
   "aksi": "DEMO · Terima tugas dari Kris: Proposal STP PT Contoh Demo → Prop"
  },
  {
   "waktu": "2026-11-11 09:05",
   "agent": "Prop",
   "aksi": "DEMO · Mulai susun proposal T-DEMO-01"
  },
  {
   "waktu": "2026-11-11 09:20",
   "agent": "Jon",
   "aksi": "DEMO · Minta Flow bikin diagram alur untuk T-DEMO-01"
  },
  {
   "waktu": "2026-11-11 10:15",
   "agent": "Cio",
   "aksi": "DEMO · Mulai report BTC (data CONTOH) T-DEMO-03"
  },
  {
   "waktu": "2026-11-11 10:48",
   "agent": "Cio",
   "aksi": "DEMO · Report T-DEMO-03 selesai, siap dibuka"
  },
  {
   "waktu": "2026-11-11 11:30",
   "agent": "Anna",
   "aksi": "DEMO · Tambah konteks makro ke report Cio"
  },
  {
   "waktu": "2026-11-11 13:30",
   "agent": "Invo",
   "aksi": "DEMO · Draft invoice T-DEMO-02 selesai"
  },
  {
   "waktu": "2026-11-11 13:32",
   "agent": "Invo",
   "aksi": "DEMO · Masuk Ruang Review, menunggu approve Kris"
  },
  {
   "waktu": "2026-11-11 15:40",
   "agent": "Flow",
   "aksi": "DEMO · Diagram alur selesai, serah-terima ke Prop"
  },
  {
   "waktu": "2026-11-11 16:05",
   "agent": "Prop",
   "aksi": "DEMO · Lanjut susun BOQ & harga, progres 60%"
  }
 ]
};
var SCENARIO = [
 {
  "judul": "Flow selesai serah-terima, balik ke cafe",
  "agents": {
   "Flow": {
    "ruangan_sekarang": "CAFE",
    "status": "Idle",
    "tugas_aktif": ""
   }
  },
  "tasks": {
   "T-DEMO-01F": {
    "status": "Selesai",
    "tahap": "Sudah dipakai Prop di proposal"
   }
  },
  "log": [
   [
    "Flow",
    "DEMO · Serah-terima beres, balik ke cafe"
   ]
  ]
 },
 {
  "judul": "Prop selesai, proposal masuk Ruang Review",
  "agents": {
   "Prop": {
    "ruangan_sekarang": "REVIEW",
    "status": "Menunggu approve",
    "tugas_aktif": "T-DEMO-01 · Proposal STP PT Contoh Demo"
   }
  },
  "tasks": {
   "T-DEMO-01": {
    "status": "Menunggu approve",
    "tahap": "Di Ruang Review, menunggu approve Kris"
   }
  },
  "log": [
   [
    "Prop",
    "DEMO · Proposal T-DEMO-01 selesai, masuk Ruang Review"
   ],
   [
    "Jon",
    "DEMO · Cek proposal Prop: rapi, siap di-approve"
   ]
  ]
 },
 {
  "judul": "Kris approve invoice (simulasi), Invo antar ke Arsip",
  "agents": {
   "Invo": {
    "ruangan_sekarang": "LIBRARY",
    "status": "Serah-terima",
    "tugas_aktif": "T-DEMO-02 → serahkan ke Arsip"
   },
   "Arsip": {
    "ruangan_sekarang": "LIBRARY",
    "status": "Bekerja",
    "tugas_aktif": "Catat T-DEMO-02 ke folder Grok Arsco"
   }
  },
  "tasks": {
   "T-DEMO-02": {
    "status": "Serah-terima",
    "tahap": "Di-approve (simulasi), dikirim ke Arsip"
   }
  },
  "log": [
   [
    "Jon",
    "DEMO · Kris approve INV-DEMO-001 (simulasi)"
   ],
   [
    "Invo",
    "DEMO · Antar invoice ke Library"
   ]
  ]
 },
 {
  "judul": "Arsip selesai mencatat, semua balik ke cafe",
  "agents": {
   "Invo": {
    "ruangan_sekarang": "CAFE",
    "status": "Idle",
    "tugas_aktif": ""
   },
   "Arsip": {
    "ruangan_sekarang": "CAFE",
    "status": "Idle",
    "tugas_aktif": ""
   }
  },
  "tasks": {
   "T-DEMO-02": {
    "status": "Selesai",
    "tahap": "Tersimpan di Grok Arsco (simulasi)"
   }
  },
  "log": [
   [
    "Arsip",
    "DEMO · INV-DEMO-001 tercatat di Library"
   ]
  ]
 },
 {
  "judul": "Kris panggil Anna & Cio ke Meeting Room",
  "agents": {
   "Anna": {
    "ruangan_sekarang": "MEETING",
    "status": "Bekerja",
    "tugas_aktif": "Diskusi makro × BTC (DEMO)"
   },
   "Cio": {
    "ruangan_sekarang": "MEETING",
    "status": "Bekerja",
    "tugas_aktif": "Diskusi makro × BTC (DEMO)"
   }
  },
  "tasks": {},
  "log": [
   [
    "Jon",
    "DEMO · Kris panggil Anna & Cio ke Meeting Room"
   ]
  ]
 },
 {
  "judul": "Surja bikin surat jalan, Puro cetak PO",
  "agents": {
   "Surja": {
    "ruangan_sekarang": "ADMIN",
    "status": "Bekerja",
    "tugas_aktif": "SJ-DEMO-046 (DEMO)"
   },
   "Puro": {
    "ruangan_sekarang": "PRINT",
    "status": "Bekerja",
    "tugas_aktif": "Cetak PO-DEMO-124 (DEMO)"
   }
  },
  "tasks": {},
  "log": [
   [
    "Surja",
    "DEMO · Mulai surat jalan SJ-DEMO-046"
   ],
   [
    "Puro",
    "DEMO · Cetak PO-DEMO-124 di Print Room"
   ]
  ]
 },
 {
  "judul": "Tridi & Pensi istirahat ke Taman",
  "agents": {
   "Tridi": {
    "ruangan_sekarang": "ROOFTOP",
    "status": "Idle",
    "tugas_aktif": "Istirahat di taman"
   },
   "Pensi": {
    "ruangan_sekarang": "ROOFTOP",
    "status": "Idle",
    "tugas_aktif": "Cari angin di taman"
   }
  },
  "tasks": {},
  "log": [
   [
    "Tridi",
    "DEMO · Istirahat ke taman"
   ],
   [
    "Pensi",
    "DEMO · Cari angin di rooftop"
   ]
  ]
 }
];

/** Jalankan satu langkah latihan. Dipanggil tombol "▶ Latihan" atau manual dari editor. */
function latihanLangkah() {
  if (!DEMO_MODE) throw new Error('Mode asli aktif (DEMO_MODE = false): Latihan dimatikan, Sheet tidak diubah.');
  var p = PropertiesService.getScriptProperties();
  var i = Number(p.getProperty('LATIHAN_STEP') || 0);
  if (i >= SCENARIO.length) { resetDemo(); return 'Semua langkah selesai — demo di-reset ke awal'; }
  var s = SCENARIO[i];
  Object.keys(s.agents).forEach(function (id) { setAgent(id, s.agents[id]); });
  Object.keys(s.tasks).forEach(function (id) { setTask(id, s.tasks[id]); });
  s.log.forEach(function (l) { addLog(l[0], l[1]); });
  p.setProperty('LATIHAN_STEP', String(i + 1));
  return 'Langkah ' + (i + 1) + '/' + SCENARIO.length + ': ' + s.judul;
}

/** Kembalikan Sheet ke kondisi DEMO awal. */
function resetDemo() {
  if (!DEMO_MODE) throw new Error('Mode asli aktif (DEMO_MODE = false): Reset demo dimatikan, Sheet tidak dihapus.');
  var ss = SpreadsheetApp.openById(SHEET_ID);
  ['Agents', 'Tasks', 'Activity'].forEach(function (tab) {
    var key = tab.toLowerCase(), rows = SEED[key];
    var sh = ss.getSheetByName(tab) || ss.insertSheet(tab);
    var h = Object.keys(rows[0]);
    sh.clearContents();
    var data = [h].concat(rows.map(function (o) { return h.map(function (k) { return o[k]; }); }));
    sh.getRange(1, 1, data.length, h.length).setNumberFormat('@').setValues(data);
  });
  PropertiesService.getScriptProperties().setProperty('LATIHAN_STEP', '0');
  return 'reset';
}
