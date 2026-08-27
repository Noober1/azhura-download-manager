# Checklist Manual Testing — Phase 1 · 2 · 3 · 4

Jalankan `bun run tauri dev`, lalu centang satu per satu. Checklist ini menutup
semua fitur yang sudah selesai di TODO.md (`## Done (Phase 1/2/3/4)`).

Kalau waktunya terbatas, kerjakan **§0 Prasyarat** dan bagian bertanda ⚠️ dulu —
itu yang paling mungkin menyembunyikan bug yang mahal.

---

## 0. Prasyarat

- [ ] `bun run tauri dev` start tanpa error di console
- [ ] `src/bindings.ts` ter-regenerate otomatis saat app start (bukan hasil edit
      tangan). Cek ada `runPowerAction`, `clipboardWatch`, `scheduledStartEnabled`,
      `scheduledStartTime`, `historyMaxEntries`, `historyRetentionDays`
- [ ] Untuk Phase 4: signing key sudah di-setup (lihat prasyarat di §15) —
      tanpa itu semua tes update pasti gagal
- [ ] Siapkan beberapa URL uji: file besar (>100 MB, biar sempat pause/resume),
      file kecil, dan satu URL yang pasti gagal (mis. host ngaco) buat tes retry

---

## ⚠️ 1. Settings round-trip — kerjakan PALING AWAL

Ini nangkep kelas bug paling mahal di Phase 3: `save_settings` di Rust menimpa
**seluruh** struct `AppSettings`, jadi satu field yang kelupaan di `persistSettings`
(`src/hooks/useSettings.ts`) bikin setting lain diam-diam balik ke default.

- [ ] Buka Settings, ubah **semua** field ke nilai non-default sekaligus:
      Max active downloads, Global speed limit, Max retry attempts, Watch clipboard,
      Hold the queue + jam, Color theme, Reduce motion, Minimize to tray,
      Run at startup, Show desktop notifications, Keep at most, Drop entries after
- [ ] Tutup app sepenuhnya (tray → Quit), buka lagi
- [ ] **Semua** nilai tadi masih sama persis — tidak ada satu pun yang balik ke default
- [ ] Ubah **satu** setting saja (mis. cuma theme), restart → setting lain tetap utuh
- [ ] Cek isi `settings.json` (folder config app) memuat semua field tsb

---

# PHASE 1 — kolom, scroll, visualisasi detail

## 2. Drag & drop reorder kolom

- [ ] Drag header kolom (mis. **Size**) ke posisi lain → muncul drag ghost yang
      mengikuti kursor, dan indikator posisi drop
- [ ] Lepas → kolom pindah ke posisi baru
- [ ] Restart app → urutan kolom **tetap** seperti terakhir diatur
- [ ] ⚠️ Drag header lalu lepas → **tidak** ikut men-trigger sort pada kolom itu
      (ini bug click-suppression yang diperbaiki; klik dan drag harus terpisah)
- [ ] Klik header (tanpa drag) → sort tetap jalan normal

## 3. Resize kolom

- [ ] Drag garis pemisah antar header → lebar kolom berubah
- [ ] Restart → lebar kolom tetap tersimpan
- [ ] ⚠️ Selesai men-drag resize → **tidak** ikut men-trigger sort
      (bug yang sama, diperbaiki di Phase 2 — lihat §8)
- [ ] Double-click garis pemisah → auto-fit lebar kolom

## 4. Infinite scroll

Butuh daftar panjang: >60 baris (`INITIAL_ROWS = 60`, tambah 60 per batch).

- [ ] Dengan >60 download di daftar, awalnya hanya ~60 baris ter-render
- [ ] Scroll ke bawah → baris berikutnya nambah otomatis per batch, mulus tanpa
      lompatan posisi scroll
- [ ] Ganti kategori di sidebar / ubah sort → daftar reset ke atas dan hitungan
      baris balik ke 60 (bukan menyisakan posisi scroll lama)
- [ ] Tekan **End** / **Ctrl+A** / panah bawah terus-menerus → navigasi keyboard
      tetap bisa mencapai baris yang belum ter-render (baris dipaksa render dulu)
- [ ] Search box tetap normal saat daftar panjang

## 5. Detail window — grafik kecepatan & peta piece

- [ ] Buka detail popup (double-click baris aktif, atau context menu → Show detail)
- [ ] **Speed graph**: sparkline terisi seiring waktu (sample tiap 500ms,
      menampilkan ~30 detik terakhir), ada label peak dan timeline
- [ ] Peak speed naik saat ada lonjakan sesaat, dan **tidak** turun lagi setelahnya
- [ ] **Piece map**: untuk download multi-connection, muncul peta 160 slice yang
      terisi bertahap dari beberapa titik sekaligus (bukan kiri-ke-kanan saja)
- [ ] Download single-connection → piece map kosong/tidak tampil (memang begitu)
- [ ] Saat download selesai → piece map bersih, tidak nyangkut di ~99%

## 6. Warna tombol toolbar

- [ ] Tombol **Add** dan ikon **Delete** warnanya menyatu dengan tombol toolbar
      lain (tidak ada lagi background/warna override yang mencolok sendiri)

## 7. Bug kecepatan saat resume (backend)

- [ ] Download file besar sampai ~50%, **Pause**
- [ ] **Resume** → tick progress pertama menampilkan kecepatan wajar
- [ ] ⚠️ **Bukan** angka absurd (dulu: seluruh byte yang sudah di disk dibagi satu
      tick 150ms, jadi kelihatan ratusan GB/s sesaat)

---

# PHASE 2 — settings, bug klik header, auto-retry

## 8. Settings dialog bersection

- [ ] Settings terbagi jadi grup berlabel. Setelah Phase 3 urutannya:
      **Downloads → Scheduling → Appearance → System → History**
- [ ] Tiap grup punya judul (`<legend>`) dan field-nya masuk akal di grup itu
- [ ] Hint kecil muncul di kanan field: `1–10` (max active),
      `MB/s · 0 = unlimited (live)`, `0–10 · 0 = off` (retry)
- [ ] Isi angka di luar rentang (mis. max active = 20) lalu klik keluar field →
      nilai ter-clamp ke batas (10)

## 9. Bug click-suppression saat resize

- [ ] ⚠️ Drag resize kolom **Status** lalu lepas → urutan sort **tidak** berubah
- [ ] Ulangi di beberapa kolom berbeda
- [ ] Klik biasa (tanpa drag) di header yang sama → sort tetap berubah normal
      (perbaikannya menekan klik, bukan mematikan sort)

## 10. Auto-retry download gagal

Backoff: attempt 1 → 2s, 2 → 4s, 3 → 8s, 4 → 16s, 5+ → 30s (cap 30s).

- [ ] Settings → **Max retry attempts** = 3
- [ ] Mulai download dari URL yang pasti gagal → setelah gagal, baris masuk status
      **retry pending**, bukan langsung Error final
- [ ] Jeda antar percobaan makin lama sesuai backoff di atas
- [ ] Setelah 3 percobaan habis → baris jadi **Error** dan berhenti mencoba
- [ ] Set **Max retry attempts** = 0 → download gagal langsung Error, tanpa retry
- [ ] ⚠️ **Checksum mismatch dikecualikan**: isi expected checksum yang salah pada
      satu download, biarkan selesai → gagal checksum → **tidak** di-retry sama
      sekali (byte yang salah tidak akan jadi benar dengan diunduh ulang)
- [ ] Selama retry pending, baris tetap terhitung sebagai antrian aktif
      (indikator "queued" di toolbar tidak nol)
- [ ] Resume manual pada baris yang sedang retry-pending → hitungan retry reset

---

# PHASE 3 — clipboard, penjadwalan, retensi history

## 11. Clipboard monitoring

- [ ] Settings → **Watch clipboard for links** OFF: copy sebuah URL → tidak ada
      reaksi apa pun
- [ ] Nyalakan ON **saat sudah ada URL di clipboard** → ⚠️ tidak langsung muncul
      toast (seeding: hanya link yang di-copy *setelah* ini yang ditawarkan)
- [ ] Copy URL `https://...` baru → muncul toast "Download this link? …" dengan
      tombol **Download**
- [ ] Klik **Download** → window Add terbuka dengan URL **persis** yang tadi
      di-copy sudah terisi
- [ ] ⚠️ Copy URL, lalu **ganti** isi clipboard dengan URL lain sebelum mengklik
      toast → yang terbuka tetap URL dari toast itu, bukan isi clipboard terbaru
- [ ] Copy teks biasa (bukan URL) → tidak ada toast
- [ ] Copy `mailto:...` atau `ftp://...` → tidak ada toast (hanya http/https)
- [ ] Klik kanan satu baris → **Copy link** → tidak ada toast (URL-nya sudah ada
      di daftar)
- [ ] ⚠️ Pilih **beberapa** baris → **Copy link** (URL tergabung newline) →
      tidak ada toast (kalau muncul menawarkan URL gabungan yang ngaco, itu bug)
- [ ] Copy URL yang sama dua kali berturut-turut → toast hanya sekali
- [ ] Toast aksi bertahan ~12 detik (lebih lama dari toast biasa yang ~5 detik)
- [ ] ⚠️ Sembunyikan app ke tray, lalu copy URL → muncul **notifikasi desktop**
      ("Open Azhura to download …"), bukan toast yang tak terlihat
- [ ] Dari kondisi itu, buka app → klik **+** → URL tadi sudah terisi dari clipboard

## 12. Penjadwalan antrian

- [ ] Settings → **Hold the queue until a set time** ON, set jam ~2 menit ke depan
- [ ] Field jam ter-disable saat checkbox OFF, aktif saat ON
- [ ] Tambah download baru → statusnya **queued** dan **tidak** mulai jalan
- [ ] Status bar menampilkan **"Queue starts at HH:MM"**
- [ ] Tunggu sampai jam target → antrian mulai jalan sendiri (maks. ~1 menit
      setelah jam target; pengecekan tiap menit)
- [ ] ⚠️ Ulangi dengan hold aktif, lalu klik **Resume** manual → download langsung
      jalan **dan** muncul toast "Scheduled start overridden…"
      (tombol Resume tidak boleh jadi tombol mati)
- [ ] Matikan checkbox saat sedang hold → antrian langsung lepas, chip status
      bar hilang
- [ ] Set jam yang **sudah lewat** hari ini (mis. sekarang 14:00, set 02:00) →
      antrian **tidak** di-hold
- [ ] Isi jam ngaco / kosongkan field → antrian tidak nyangkut ter-hold selamanya

## 13. Aksi setelah antrian selesai (sleep / shutdown)

⚠️ Bagian ini benar-benar mematikan/menidurkan komputer. **Simpan semua kerjaan
dulu.** Kerjakan tes negatif (yang seharusnya *tidak* terjadi apa-apa) lebih dulu.

Tes negatif — semua ini harus **tidak** memunculkan countdown:

- [ ] Baru buka app (antrian kosong, hanya ada history) → tidak ada apa-apa
- [ ] Set dropdown status bar ke **When done: sleep**, jalankan beberapa download,
      lalu **Pause semua** → ⚠️ tidak ada countdown, komputer tidak tidur
- [ ] Ulangi, lalu **Cancel semua** → ⚠️ tidak ada countdown
- [ ] Ulangi, lalu **Delete semua** → ⚠️ tidak ada countdown
- [ ] Ulangi dengan URL yang gagal sampai retry habis (semua jadi Error) →
      tidak ada countdown

Tes positif:

- [ ] Arm **sleep**, jalankan 1 download sampai **selesai** → countdown 60 detik muncul
- [ ] Klik **Cancel** → countdown berhenti, dropdown balik ke "When done: nothing"
- [ ] ⚠️ Jalankan 2 download; biarkan satu **selesai**, lalu **cancel** yang kedua →
      countdown tetap muncul (karena ada yang benar-benar selesai). Ini kasus yang
      dulu keliru dilewati
- [ ] ⚠️ Arm sleep, sembunyikan app ke tray, biarkan antrian selesai → window
      **muncul sendiri** ke depan + ada notifikasi desktop, bukan tidur diam-diam
- [ ] Escape / klik backdrop saat countdown → sama dengan Cancel (batal, bukan lanjut)
- [ ] Restart app → dropdown selalu kembali ke **"When done: nothing"**
      (setting ini sengaja tidak pernah disimpan)
- [ ] Terakhir: benar-benar biarkan countdown habis → komputer tidur/shutdown
- [ ] Catatan: kalau hibernation aktif di Windows, "sleep" bisa jadi hibernate —
      itu keterbatasan powrprof, bukan bug

## 14. Retensi history

- [ ] Settings → **Keep at most** = 50; buat >50 download selesai; restart →
      `history.json` terpotong di 50 baris terbaru
- [ ] Isi nilai di luar rentang (mis. 10 atau 99999) → ter-clamp ke 50–5000
- [ ] Edit manual `settings.json` jadi `"historyMaxEntries": 0`, restart, simpan
      history → ⚠️ history **tidak** terhapus semua (Rust ikut clamp ke minimal 50)
- [ ] **Drop entries after** = 1 hari. Tutup app, edit `history.json`: ubah
      `finishedAt` satu baris ke timestamp >1 hari lalu. Buka app → baris itu hilang
- [ ] ⚠️ Di file yang sama, set `finishedAt: 0` pada baris lain → baris itu
      **tetap ada** (baris lama sebelum field ini ada tidak boleh ikut terhapus)
- [ ] Set **Drop entries after** = 0 → tidak ada yang dihapus, berapa pun umurnya
- [ ] Ubah nilai retensi saat app jalan → baris kedaluwarsa langsung hilang dari
      tabel (tidak perlu restart)
- [ ] **Clear history** → dialog delete yang biasa muncul, lengkap dengan pilihan
      "hapus file juga"
- [ ] Konfirmasi → semua baris selesai/error/canceled hilang; download yang sedang
      jalan **tidak** ikut terhapus
- [ ] Tombol Clear history disabled dan tanpa angka saat history kosong

---

# PHASE 4 — auto-updater

⚠️ **Prasyarat: signing key harus sudah diisi.** Selama `pubkey` di
`src-tauri/tauri.conf.json` masih `REPLACE_WITH_TAURI_SIGNER_PUBLIC_KEY`, app
tetap build dan jalan normal, tapi setiap pengecekan update akan gagal. Build
**tidak** akan mengeluh — kegagalannya baru muncul saat runtime.

Langkah setup (sekali saja, lihat juga catatan Phase 4 di TODO.md):

1. `bunx tauri signer generate -w %USERPROFILE%\.tauri\azhura.key`
2. Salin **public key** ke `pubkey` di `src-tauri/tauri.conf.json`
3. Simpan isi file private key sebagai secret repo `TAURI_SIGNING_PRIVATE_KEY`,
   dan passwordnya sebagai `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
4. Backup private key offline — hilang berarti semua install yang sudah
   tersebar tidak bisa lagi memverifikasi update

## 15. Pengecekan update

- [ ] Buka app dengan koneksi normal, tanpa ada versi baru → tidak ada dialog
      apa pun (pengecekan startup sifatnya diam)
- [ ] Settings → System → tombol **Check for updates** ada, dengan hint
      "Also checked once at startup"
- [ ] Klik tombolnya saat sudah versi terbaru → toast "You're on the latest
      version." (⚠️ bukan diam saja — tombol yang seolah tidak berefek itu bug)
- [ ] Saat sedang mengecek, tombolnya jadi **Checking…** dan disabled
- [ ] Matikan internet, klik Check for updates → toast merah berisi pesan error
- [ ] ⚠️ Matikan internet lalu **restart app** → tidak ada toast error sama
      sekali (pengecekan startup gagal secara diam-diam; offline saat buka app
      itu hal biasa dan tidak layak mengganggu)

## 16. Alur update (butuh dua rilis)

Uji beneran: publish `v0.2.3` lewat tag, lalu pasang installer `v0.2.2` lama.

- [ ] Buka app versi lama → dialog **"Version 0.2.3 is available"** muncul
- [ ] Release notes tampil sebagai teks biasa; catatan yang sangat panjang
      ter-scroll di dalam panel, tidak mendorong tombol keluar dari dialog
- [ ] ⚠️ Isi release notes dengan teks yang mengandung HTML (mis.
      `<b>test</b>`) → tampil sebagai teks mentah, **tidak** ter-render jadi
      tebal (ini konten remote, tidak boleh jadi markup)
- [ ] Klik **Later** → dialog tutup, app tetap jalan di versi lama
- [ ] Buka lagi Settings → Check for updates → dialog yang sama muncul lagi
- [ ] Klik **Install and restart** → progress bar jalan, tombol jadi disabled
- [ ] ⚠️ Saat sedang download, tekan **Escape** dan klik backdrop → dialog
      **tidak** tertutup (menutupnya tidak menghentikan install, cuma
      menyembunyikan operasi yang sedang jalan)
- [ ] Setelah selesai → app restart sendiri dan jalan di versi baru
- [ ] Cek Settings/status bar menampilkan versi baru
- [ ] Download yang tadi ada di daftar masih utuh setelah update (history dan
      resume state tidak hilang)
- [ ] Kalau server tidak mengirim ukuran file → progress bar jadi mode
      indeterminate (bergerak menyapu), bukan nyangkut di 0%
- [ ] Dengan **Reduce motion** ON → bar indeterminate tidak beranimasi

## 17. Workflow rilis

- [ ] Push tag `v0.2.3` → workflow **Release** jalan di GitHub Actions
- [ ] Workflow sukses dan bikin release **draft**
- [ ] Asset release memuat installer (`.exe`/`.msi`), file `.sig`, dan
      **`latest.json`**
- [ ] ⚠️ `latest.json` ada — tanpa file ini, install yang sudah tersebar tidak
      akan pernah menemukan update
- [ ] Publish draft-nya → `https://github.com/Noober1/azhura-download-manager/releases/latest/download/latest.json`
      bisa diakses dan isinya versi terbaru
- [ ] Bikin build dengan private key yang **salah** → app menolak update-nya
      (verifikasi tanda tangan bekerja, bukan sekadar hiasan)

---

## 18. Regresi umum

- [ ] Search box, marquee-select drag, resize kolom masih normal
- [ ] Download paralel multi-connection jalan normal, tabel tidak nge-lag saat
      banyak download aktif
- [ ] Tray menu masih menampilkan daftar download aktif dengan benar
- [ ] Semua dialog masih bisa ditutup via Cancel/Done/backdrop/Escape
- [ ] Animasi masih halus; dengan **Reduce motion** ON semua transisi jadi instan
- [ ] Toast biasa (mis. "Couldn't open the containing folder…") masih muncul dan
      auto-dismiss ~5 detik
- [ ] Deep link dari browser extension masih mengisi window Add seperti biasa
