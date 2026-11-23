# AI Office · Arsco × Investment (GitHub Pages)

Frontend statis (`index.html`, three.js r147 dari CDN) untuk AI Office. Data tetap di Google Sheet **AI Office - Status**
dan dibaca lewat Apps Script `/exec` sebagai API JSON (polling ±5 detik). Approve / Revisi dikirim lewat `POST` ke `/exec` yang sama.

## Isi
- `index.html` — web 3D (satu file, tanpa build).
- `Code.gs` — backend Apps Script **v12** (tempel ke project Apps Script; bukan bagian dari web).
- `.nojekyll` — supaya GitHub Pages menyajikan file apa adanya.

## Pasang (langkah Kris)
1. **Apps Script** (script.google.com → project `AI Office`):
   1. Tempel isi `Code.gs` (v12) ke `Code.gs` → 💾 Save.
   2. **Project Settings (⚙) → Script Properties → Add script property**: nama `WEB_KEY`, nilai = kunci rahasia buatan sendiri (mis. 16+ karakter acak) → Save.
   3. **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy** (URL `/exec` tetap sama).
   4. Cek `…/exec?api=ping` → `{"ok":true,"version":"v12",…}`.
2. **GitHub Pages**: Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)` → Save. Alamat: `https://<username>.github.io/<repo>/`.
3. Buka alamat web. Saat pertama kali **Approve/Revisi**, masukkan *Kunci rahasia* (= `WEB_KEY`); bisa diingat di perangkat. Tombol **🔑 Kunci** di atas = lupakan kunci di perangkat ini.
4. Kalau URL deployment berubah, ganti `API_URL_DEFAULT` di `index.html` (uji sementara: `?api_url=<URL /exec>`).

## API (Code.gs v12; v13 lihat DEPLOY-v13.md)
| Metode | Panggilan | Hasil |
|---|---|---|
| GET | `/exec` | halaman HtmlService lama (tetap jalan) |
| GET | `/exec?api=state` | JSON `{agents,tasks,activity,obrolan,demoMode,serverTime}` (`&callback=fn` untuk JSONP) |
| GET | `/exec?api=ping` | `{"ok":true,"version":"v12"}` |
| POST | `/exec`, body teks JSON `{"action":"approve","task_id":"T-0003","key":"…"}` | `{"ok":true,"msg":"…"}` |
| POST | `{"action":"revise","task_id":"T-0003","note":"…"}` | idem |
| POST | `{"action":"obrolan","dari":"Cio","ke":"Anna","task_id":"T-0002","ringkas":"…","isi":"…"}` | idem |

POST memakai `Content-Type: text/plain` (tanpa preflight CORS) dan **wajib** field `"key"` = Script Property `WEB_KEY`. Kalau `WEB_KEY` belum di-set, approve/revise ditolak. `GET ?api=state` terbuka (hanya baca). Jangan menaruh kunci di repo.

## Catatan
- Perubahan data di Sheet muncul ≤5 detik. Deploy GitHub Pages (~1 menit) hanya perlu saat UI diubah.
- Preferensi tampilan (toggle nama ruangan / obrolan santai) tersimpan di `localStorage` browser.

## v12: Revisi/Approve langsung membangunkan bot
Isi Script Properties `WEBHOOK_<ID>_URL` + `WEBHOOK_<ID>_KEY` (dari routine "AI Office webhook" tiap bot), lalu deploy
versi baru di deployment yang sama. Langkah lengkap: `DEPLOY-v12.md`. Balasan POST kini berisi `wake`
(`{status:"ok|fail|none",agent,via}`) dan `?api=state` / `?api=ping` berisi `wake` (bot mana yang sudah tersambung).

## v13 / web v17: Perintah, lampiran, Arsip
- **✉️ Perintah** (tombol di header): chat langsung ke bot mana pun (default **Jon**). Bisa lampirkan file dengan
  drag & drop ke mana saja di halaman, paste, atau 📎 (PDF, gambar, Excel, Word…; maks 5 file / 20 MB), dan link
  Google Docs/Sheets/Drive otomatis terdeteksi. Bisa ditautkan ke tugas bot itu (T-####).
  Status pesan: Terkirim → ⚡ Bot dibangunkan / ↪ Diteruskan lewat Jon / ⚠ Belum tersambung → ✓✓ Dibalas.
- **Panel kanan** bisa di-minimize (tombol ⟩, buka lagi lewat tab "◀ Panel" di tepi kanan), tiap kartu bisa diciutkan.
  Semuanya diingat di perangkat.
- **🗄 Arsip** di panel: tugas Arsco yang sudah di-approve, terbaru di atas, filter per AI dan pencarian.
  Investment (Anna, Cio) tidak ikut.
- Approve → Arsip dikabari otomatis (event `archive`) untuk menyimpan file final ke Grok Bot Library.
- Pasang: lihat **DEPLOY-v13.md** dan **BOT-SETUP-v13.md**. Web tetap jalan dengan server lama (Perintah menampilkan "Server belum v13").
