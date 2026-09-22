# Checklist Manual Testing — Phase 1 · 2 · 3 · 4 · 5 · 6

Jalankan `bun run tauri dev`, lalu centang satu per satu. Checklist ini menutup
semua fitur yang sudah selesai di TODO.md (`## Done (Phase 1/2/3/4/5/6)`).

Simpan file ini — ini daftar regresi yang dipakai ulang tiap perubahan besar,
bukan checklist sekali buang.

## Status per 2026-08-29 (v0.2.4, terpublish)

- ✅ **Lolos (carry-over dari v0.2.3):** Phase 1, 2, 3, dan §15 (pengecekan update)
- ✅ **§17 (workflow rilis) — terverifikasi untuk v0.2.4:** tag `v0.2.4` di-push,
  workflow **Release** sukses (~11 menit), draft berisi installer `.exe`/`.msi`
  + `.sig` + `latest.json`, draft sudah di-publish, dan
  `releases/latest/download/latest.json` sudah dicek bisa diakses dan
  melaporkan versi `0.2.4` yang benar. Satu-satunya item §17 yang masih belum
  diuji: build sengaja dengan private key yang salah.
- ⛔ **Baru sekarang bisa diuji, tapi belum dijalankan:** §16, §16b, §16c.
  `v0.2.3` **dan** `v0.2.4` sama-sama sudah published — ini pertama kalinya ada
  dua rilis nyata sekaligus, jadi alur update beneran (pasang installer
  `v0.2.3`, biarkan menemukan `v0.2.4`) akhirnya bisa dieksekusi. Belum ada
  yang menjalankannya.

  Konsekuensinya: **perilaku client saat menerima update (Phase 4 + 5) masih
  belum terbukti** — termasuk apakah pasangan signing key benar. §17 yang
  hijau cuma membuktikan pipeline rilisnya jalan, bukan bahwa app yang sudah
  terpasang bisa memverifikasi dan memasang update itu.
- 🆕 **Belum diuji manual sama sekali:** §19 (tooltip kustom, shortcut
  keyboard, animasi ikon — baru di v0.2.4). Lolos build + test otomatis, dan
  delay tooltip 500ms sudah dikonfirmasi manual sekilas, tapi checklist
  lengkapnya di §19 belum dijalankan satu per satu.
- 🆕 **Belum diuji manual sama sekali:** §20 (header sticky, show/hide kolom,
  kolom ETA/Connections/Pieces — Phase 6). Lolos `tsc` + `vitest` (124 test),
  tapi belum ada satu pun langkah §20 yang dijalankan di app beneran.
- 🆕 **Belum diuji manual sama sekali:** §21 (filter status, cek disk space,
  export CSV, backup/restore, global hotkey — Batch 2). Lolos `tsc --noEmit`,
  `vitest` (157 test), `cargo check --all-targets`, dan `cargo test --lib`
  (135 test), tapi belum ada satu pun langkah §21 yang dijalankan di app
  beneran.

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
      Run at startup, Show desktop notifications, Install updates at startup,
      Keep at most, Drop entries after
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

Signing sudah di-setup (keypair `74AFA223D85BD707`, private key di luar repo,
dua secret sudah ada di GitHub Actions). Yang masih perlu dipastikan sekali:

- [ ] Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` isinya cocok dengan password
      yang mengenkripsi private key sekarang. Kalau tidak, workflow gagal di
      tahap signing
- [ ] Private key sudah di-backup offline — hilang berarti semua install yang
      sudah tersebar tidak bisa lagi memverifikasi update, dan satu-satunya
      jalan keluar buat user adalah reinstall manual

⚠️ Kalau suatu saat pubkey diganti: build dan signing **tetap hijau** walau
pubkey-nya salah pasangan. Kegagalannya muncul di sisi *client* saat update,
jadi perubahan key wajib diuji lewat rilis beneran, bukan lewat build yang
lolos.

## 15. Pengecekan update

- [ ] Buka app dengan koneksi normal, tanpa ada versi baru → tidak ada dialog
      atau toast apa pun (pengecekan startup sifatnya diam)
- [ ] ⚠️ Nyalakan **Run at startup**, lalu jalankan
      `azhura-download-manager.exe --autostart` → app diam di tray, dan
      **tidak** ada pengecekan update selama window masih tersembunyi. Klik
      ikon tray → baru pengecekan jalan setelah window tampil
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

`v0.2.3` dan `v0.2.4` sudah sama-sama published — tinggal pasang installer
`v0.2.3` lama, lalu jalankan langkah-langkah di bawah dan lihat apakah
ia menemukan `v0.2.4` sebagai update. Alurnya sengaja **tanpa dialog modal**
— download jalan diam-diam, baru memberi tahu setelah ada yang bisa
dilakukan.

- [ ] Buka app versi lama → **tidak ada dialog apa pun** yang muncul
- [ ] Diamkan sebentar (update ter-download di latar) → muncul toast
      **"Version 0.2.4 is ready to install."** dengan tombol **Restart now**
- [ ] ⚠️ Selama download berlangsung, app tetap bisa dipakai normal — tidak ada
      overlay, tidak ada yang ter-blokir
- [ ] Muncul juga link **Restart to update** di status bar kiri bawah, di
      sebelah nama aplikasi
- [ ] Hover link tsb → tooltip menyebut versinya
- [ ] Biarkan toast-nya lewat (jangan diklik) → link di status bar **tetap
      ada**, jadi update tidak hilang begitu toast menghilang
- [ ] Settings → Check for updates saat update sudah ter-download → toast
      "An update is already downloaded and ready." (⚠️ bukan mengulang
      download dari nol)
- [ ] Klik **Restart to update** → muncul dialog konfirmasi
      **"Restart to install version 0.2.4?"**, bukan langsung restart
- [ ] Klik tombol **Restart now** di toast → dialog konfirmasi yang sama
      muncul (dua jalur masuk, satu konfirmasi)
- [ ] Klik **Cancel** / Escape / klik backdrop → tidak jadi restart, link di
      status bar tetap ada
- [ ] ⚠️ Buka dialog saat ada **download aktif atau queued** → dialog
      menyebutkan jumlahnya, mis. "2 downloads will be paused first and can be
      resumed afterwards"
- [ ] Buka dialog saat tidak ada download sama sekali → baris jumlah itu
      **tidak** muncul
- [ ] Konfirmasi **Restart now** → status bar jadi "Updating…", app restart di
      versi baru
- [ ] ⚠️ **Uji dengan download aktif:** mulai satu download besar, tunggu
      update siap, konfirmasi restart → setelah app hidup lagi, download itu
      berstatus **paused** dan bisa di-**Resume** melanjutkan dari posisi
      terakhir, bukan mengulang dari 0
- [ ] ⚠️ Setelah update, history masih lengkap — termasuk download yang baru
      saja selesai beberapa detik sebelum restart (ini yang dilindungi
      `prepare_for_update`; tanpa itu, entry di dalam debounce 400ms hilang)
- [ ] Matikan internet di tengah download update → **tidak ada toast error**
      (download ini tidak diminta user, jadi gagalnya diam). Cek lagi lewat
      Settings → Check for updates masih bisa memulai ulang
- [ ] Cek manual saat ada update → toast "Downloading version 0.2.4 in the
      background…" lalu menyusul toast siap-install

# PHASE 5 — auto-install & update critical

## 16b. Install otomatis saat startup

Default `Install updates at startup` = ON (Settings → System).

- [ ] Dengan setting ON dan **tidak ada download sama sekali**, buka app versi
      lama → update ter-download diam-diam, lalu muncul toast
      **"Installing version 0.2.4…"** dan app restart sendiri **tanpa** dialog
      konfirmasi
- [ ] ⚠️ Ulangi tapi **mulai satu download besar** dulu sebelum update selesai
      ter-download → app **tidak** auto-install. Yang muncul toast biasa
      "ready to install" + link status bar (jalur sabar)
- [ ] ⚠️ Kasus paling penting: biarkan update mulai ter-download saat idle,
      lalu **tambahkan download baru di tengah-tengah** sebelum selesai → tetap
      **tidak** auto-install (jumlah download dibaca saat download update
      selesai, bukan saat mulai)
- [ ] Matikan setting-nya → buka app dengan update tersedia → tidak pernah
      auto-install, selalu lewat toast + link
- [ ] Setting-nya bertahan setelah restart (ikut §1 round-trip)

## 16c. Update critical

Uji dengan menyunting `latest.json` di draft release: tambahkan
`"critical": true` di level teratas sebelum publish.

- [ ] Dengan flag critical, buka app versi lama → setelah ter-download muncul
      dialog **"Critical update 0.2.4 — restarting"** dengan hitung mundur 30 detik
- [ ] ⚠️ Dialog itu **tidak punya tombol Cancel**
- [ ] ⚠️ Tekan **Escape** dan klik **backdrop** → dialog **tidak** tertutup
- [ ] Biarkan hitung mundur habis → app restart sendiri
- [ ] Klik **Restart now** sebelum waktunya habis → langsung restart
- [ ] ⚠️ Critical mengabaikan setting: matikan `Install updates at startup`,
      ulangi → dialog critical **tetap** muncul
- [ ] ⚠️ Critical tetap muncul walau ada download aktif — dan setelah restart,
      download itu berstatus paused dan bisa di-Resume (tidak mengulang)
- [ ] Dialog menyebutkan jumlah download yang akan ter-pause, sama seperti
      dialog restart biasa
- [ ] **Regresi:** publish rilis **tanpa** flag critical → alur normal
      (toast/link atau auto-install), **bukan** dialog paksa
- [ ] ⚠️ Isi `"critical": "true"` (string, bukan boolean) atau
      `"critical": 1` → diperlakukan **tidak** critical. Hanya boolean `true`
      yang dihitung — feed rusak tidak boleh memaksa restart semua orang

## 17. Workflow rilis

- [ ] Push tag `v0.2.4` → workflow **Release** jalan di GitHub Actions
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

---

## 19. Tooltip kustom, shortcut keyboard, dan animasi ikon (baru di v0.2.4)

Belum pernah diuji manual satu per satu — cuma delay tooltip yang sudah
dicek sekilas selama development.

**Tooltip:**

- [ ] Hover tiap tombol toolbar (sidebar toggle, Add, Resume, Pause, Cancel,
      Delete, Settings, Refresh, Extensions) → bubble kustom muncul setelah
      ~500ms, bukan tooltip bawaan OS
- [ ] ⚠️ Delay 500ms **konsisten** walau pindah hover cepat antar beberapa
      tombol berurutan (tidak ada tombol yang muncul instan)
- [ ] Hover nama file/path panjang di tabel unduhan → teks wrap rapi di
      dalam bubble, **tidak** meluber keluar lebar maksimum
- [ ] Collapse sidebar, hover salah satu ikon kategori → tooltip muncul di
      sisi **kanan** ikon, berisi label + jumlah
- [ ] Hover lalu scroll tabel / klik / tekan Escape / pindah window (alt-tab)
      → tooltip langsung hilang, tidak ada yang nyangkut di layar
- [ ] Buka window Add / Details / Archive / About → tooltip kustom juga
      jalan di sana (bukan cuma window utama)
- [ ] Tidak ada satupun tooltip bawaan OS (kotak kuning bergaris) yang
      nongol berbarengan di elemen manapun

**Shortcut keyboard:**

- [ ] `Ctrl+B` toggle sidebar, `Ctrl+N` buka window Add
- [ ] `Ctrl+,` buka Settings, `Ctrl+Shift+X` buka dialog Extensions
- [ ] `Ctrl+/` buka dialog **Keyboard shortcuts**, bisa ditutup lewat
      Escape/backdrop/tombol Close
- [ ] Pilih satu baris aktif, tekan `Space` → pause; tekan lagi → resume
- [ ] ⚠️ Pilih campuran (ada yang aktif, ada yang paused), tekan `Space` →
      yang **pause** duluan yang jalan (bukan resume), supaya aksi ambigu
      selalu ke arah yang gampang dibalik
- [ ] Pilih satu/banyak baris, `Ctrl+C` → link ter-copy ke clipboard (coba
      paste ke Notepad)
- [ ] Pilih satu baris, `Alt+Enter` → buka detail popup
- [ ] ⚠️ Klik ke dalam search box lalu ketik huruf `b`, `n`, koma, atau `/`
      → karakter itu **muncul di search box**, tidak ada shortcut yang
      ke-trigger
- [ ] ⚠️ Buka Settings/Extensions/dialog lain lalu tekan shortcut manapun di
      atas → **tidak ada efek** (dialog yang lagi terbuka pegang kendali
      keyboard penuh)
- [ ] Shortcut lama masih normal: `Ctrl+F` fokus search, `F5` refresh status
      file, `Ctrl+A`/panah/Home/End/Delete/Enter di tabel

**Animasi ikon:**

- [ ] Klik toggle sidebar berulang kali → ikon panel di toolbar ikut
      terisi/mengosong dan garis pembatasnya bergeser, sinkron dengan
      lebar sidebar yang sebenarnya
- [ ] Hover ikon kategori di sidebar → sedikit membesar; klik → sedikit
      mengecil sesaat; pindah kategori aktif → ikon yang baru aktif "pop"
      seiring highlight-nya slide ke situ
- [ ] Klik tombol Refresh berkali-kali cepat → ikon terus berputar
      menambah rotasi (bukan reset ke 0 tiap klik, tidak tersendat)
- [ ] Settings → **Reduce motion** ON → semua animasi ikon di atas berhenti
      total (langsung ke state akhir), tapi tooltip tetap muncul/hilang
      (cuma fade, tanpa scale/slide)

---

## 20. Header sticky + show/hide kolom + kolom baru (baru di Phase 6)

Belum pernah diuji manual. Butuh minimal ~30 baris di tabel supaya bisa
di-scroll, dan minimal satu unduhan besar yang lagi jalan multi-koneksi
supaya kolom ETA/Pieces ada isinya.

**Header sticky:**

- [ ] Scroll tabel ke bawah sampai jauh → baris header (Name, Date Added, …)
      **tetap menempel** di atas, tidak ketutupan baris
- [ ] Garis pembatas 1px di bawah header **ikut menempel**, tidak ikut
      ter-scroll ke atas
- [ ] Sambil ter-scroll, klik header untuk sort → tetap jalan (asc → desc →
      off), panah ▲/▼ muncul di tempat yang benar
- [ ] Sambil ter-scroll, drag handle resize di tepi kanan header → resize
      tetap jalan, tidak ikut ke-trigger sort
- [ ] Sambil ter-scroll, drag header untuk reorder → ghost mengikuti kursor,
      garis drop muncul, kolom pindah saat dilepas
- [ ] Baris yang di-select (background accent) **tidak** menimpa header saat
      lewat di belakangnya
- [ ] Cek di tema terang **dan** gelap: background header solid, teks baris
      di belakangnya tidak tembus

**Show/hide kolom:**

- [ ] Klik kanan di baris header → menu daftar kolom muncul (bukan menu
      "Add Download / Paste URL" milik area kosong)
- [ ] Klik kanan di area kosong tabel → tetap menu lama, bukan menu kolom
- [ ] Centang/uncentang satu kolom → kolom langsung hilang/muncul, dan
      **menu tetap terbuka** (bisa matikan beberapa kolom sekaligus)
- [ ] ⚠️ Matikan kolom satu per satu sampai tinggal satu → entry kolom
      terakhir jadi **abu-abu dan tidak bisa diklik** (header tidak boleh
      sampai kosong, karena itu satu-satunya jalan balik ke menu ini)
- [ ] "Show all columns" mengembalikan semua kolom; entry-nya abu-abu kalau
      memang tidak ada yang disembunyikan
- [ ] Sembunyikan satu kolom → lebar tabel menyusut (scrollbar horizontal
      berkurang), kolom Name tetap yang melar mengisi sisa ruang
- [ ] ⚠️ Sembunyikan kolom di tengah (mis. Status), lalu drag-reorder kolom
      lain → kolom yang pindah mendarat di tempat yang benar, tidak meleset
      satu kolom
- [ ] ⚠️ Setelah reorder di atas, munculkan lagi kolom yang disembunyikan →
      dia balik di sebelah kolom yang dulu ada di depannya, bukan di ujung
- [ ] Double-click handle resize (auto-fit) pada kolom **setelah** ada kolom
      yang disembunyikan → yang di-fit kolom yang benar, bukan tetangganya
- [ ] Tutup app, buka lagi → kolom yang disembunyikan tetap tersembunyi,
      urutan dan lebar juga tetap

**Kolom ETA / Connections / Pieces:**

Ketiganya **hidden by default** — nyalakan dulu lewat klik kanan header
sebelum mengerjakan bagian ini.

- [ ] Install bersih (atau hapus key `adm-column-hidden` di localStorage
      lewat devtools) → tabel muncul dengan **tujuh kolom lama saja**; ETA,
      Connections, dan Pieces ada di menu header tapi tidak tercentang
- [ ] Nyalakan ketiganya lewat menu header → muncul di urutan setelah Speed
- [ ] Saat unduhan jalan, **ETA** terisi dan menghitung turun; saat
      pause/selesai/queued berubah jadi `—`
- [ ] ETA di kolom tabel **sama** dengan ETA di window Details untuk baris
      yang sama (dalam satu-dua detik, karena beda tick render)
- [ ] Klik header **ETA** untuk sort naik → yang paling cepat selesai di
      atas, baris yang tidak jalan (`—`) di **paling bawah**
- [ ] **Connections** menampilkan angka koneksi maksimum baris itu; ubah
      lewat klik kanan baris → **Connections** → angkanya ikut berubah
- [ ] Hover cell Connections saat unduhan jalan → tooltip "N of M
      connections in use"; saat tidak jalan tidak ada tooltip
- [ ] **Pieces** menampilkan `X / Y` dan X naik sepanjang unduhan; unduhan
      single-connection (server tanpa range request, atau Connections = 1)
      menampilkan `—`
- [ ] ⚠️ Pause unduhan multi-koneksi, tutup app, buka lagi, resume →
      angka Pieces **lanjut** dari posisi sebelumnya, bukan mulai dari 0
- [ ] Sort by Connections dan by Pieces jalan dua arah
- [ ] Semua tiga kolom bisa di-resize, di-reorder, dan di-hide seperti
      kolom lama

---

## 21. Filter status, cek disk space, export CSV, backup/restore, global hotkey (Batch 2, baru)

Belum pernah diuji manual sama sekali.

**Filter status:**

- [ ] Dropdown baru di toolbar, sebelah kiri search box, isinya "All statuses"
      + 7 status
- [ ] Pilih "Completed" → tabel cuma nampilin baris selesai; gabung dengan
      kategori sidebar (mis. "Video") → cuma baris Video yang selesai
- [ ] Gabung dengan search box → ketiga filter (kategori + status + teks)
      jalan bareng (AND)
- [ ] Dropdown ter-highlight (border/teks warna aksen) saat bukan "All
      statuses", normal lagi saat balik ke "All statuses"
- [ ] Klik kanan area kosong tabel → "Clear history" tetap menghapus semua
      riwayat category-scoped, **mengabaikan** filter status yang aktif

**Cek disk space:**

- [ ] Set save path ke drive/folder yang hampir penuh (atau flashdisk kecil),
      tempel URL file yang lebih besar dari sisa ruang → di Add window,
      setelah "Check size"/probe kelar, muncul teks merah "Not enough disk
      space — X free" di sebelah ukuran file
- [ ] Tetap bisa submit walau ada warning → download dimulai, lalu **gagal**
      dengan pesan error "Not enough disk space — …"
- [ ] Baris yang gagal karena disk space **tidak** di-auto-retry (beda dari
      error jaringan biasa yang di-retry otomatis)
- [ ] Ganti save path ke folder yang cukup ruang → warning merah hilang

**Export CSV:**

- [ ] Settings → History → "Export CSV…" → dialog save native muncul, nama
      default `azhura-history-YYYY-MM-DD.csv`
- [ ] Buka hasilnya di Excel/Sheets → kolom rapi (Name, Status, Size, URL,
      Referer, Saved to, Added, Finished, Error), karakter non-ASCII di nama
      file terbaca benar (bukan ganti jadi tanda tanya)
- [ ] File riwayat dengan nama yang diawali `=`, `+`, `-`, atau `@` **tidak**
      dieksekusi sebagai rumus saat dibuka di Excel
- [ ] Tombol "Export CSV…" disabled kalau riwayat kosong

**Backup export/import:**

- [ ] Settings → Backup → "Export backup…" → dialog save native, nama default
      `azhura-backup-YYYY-MM-DD.json`; buka file JSON-nya, pastikan field
      `proxy.password` kosong meskipun proxy asli ada passwordnya
- [ ] Ubah beberapa setting (mis. max concurrent, theme) dan hapus beberapa
      baris riwayat, lalu "Import backup…" pakai file yang tadi diexport →
      muncul dialog konfirmasi native menyebutkan jumlah entry riwayat yang
      mau ditambahkan
- [ ] Setelah konfirmasi: setting balik ke nilai waktu export, riwayat yang
      tadi dihapus muncul lagi, **tidak ada duplikat** untuk baris yang masih
      ada
- [ ] Buka Add window setelah import → default Connections/Speed
      cap/proxy host ikut isi backup; kalau proxy asli punya password lokal,
      password itu **tetap ada** (bukan kosong, karena backup gak bawa
      password)
- [ ] Import file JSON yang bukan backup (mis. asal-asalan atau backup app
      lain) → muncul toast error, tidak ada yang berubah
- [ ] Batalkan dialog save/open di tengah jalan (klik Cancel) → tidak ada
      efek apa pun, tidak ada toast error

**Global hotkey:**

- [ ] Settings → System → field "Add download shortcut" → klik → berubah
      jadi "Press a shortcut…"; tekan Ctrl+Alt+D → field jadi "Ctrl+Alt+D"
      dan langsung tersimpan
- [ ] Minimize app ke tray, buka app lain, tekan Ctrl+Alt+D dari situ →
      window "Add Download" muncul
- [ ] Coba rekam kombinasi yang sudah dipakai app lain (mis. yang jelas
      bentrok) → toast error muncul, field balik ke shortcut sebelumnya (yang
      lama tetap berfungsi)
- [ ] Fokus field lalu tekan Backspace atau Delete → shortcut jadi "Not set"
      (off), dan hotkey lama tidak lagi merespons
- [ ] Restart app sepenuhnya → shortcut yang tersimpan otomatis aktif lagi
      tanpa perlu di-set ulang
- [ ] Saat field lagi fokus/merekam, tombol Ctrl+N atau shortcut app lain
      **tidak** ikut ter-trigger oleh tombol yang ditekan buat merekam

## 22. Update pending-install senyap, grouping tabel, grafik speed gabungan (Batch 3a, baru)

Belum pernah diuji manual sama sekali. Lolos `tsc --noEmit`, `vitest run` (181
test), `cargo check --all-targets`, dan `cargo test --lib` (138 test).

**Grouping tabel:**

- [ ] Dropdown baru di toolbar, sebelah kiri filter status: "No grouping" /
      "Group by category" / "Group by date"
- [ ] Pilih "Group by category" → muncul header grup per kategori (Videos,
      Audios, Programs, Documents, Archives, Others), cuma yang punya baris;
      tiap header nampilin jumlah baris di dalamnya
- [ ] Pilih "Group by date" → header grup "Today" / "Yesterday" / "Earlier
      this week" / "Earlier this month" / "Older", sesuai tanggal ditambahkan
- [ ] Klik header grup → grup collapse (baris hilang, chevron berputar);
      klik lagi → expand lagi
- [ ] Restart app → grouping mode dan grup yang di-collapse tadi tetap
      kepilih/collapse (persisted di localStorage, bukan settings.json)
- [ ] Collapse **semua** grup → tabel kosong secara visual tapi header-header
      grup tetap kelihatan; pesan "No downloads yet" **tidak** muncul
- [ ] Dengan satu grup di-collapse: Ctrl+A, panah atas/bawah, Home/End,
      shift-click, dan drag marquee semuanya **skip** baris yang
      disembunyikan dan **tidak pernah** mendarat di baris header grup
- [ ] Grouping tetap jalan bareng filter kategori sidebar, filter status
      toolbar, dan search box (kombinasi AND seperti biasa)
- [ ] Scroll tabel yang panjang dengan grouping aktif → infinite-scroll tetap
      nge-load per halaman; header grup collapsed di ujung baru muncul
      setelah scroll sampai ke bawah semua

**Grafik speed gabungan:**

- [ ] Status bar bawah kosong (gak ada grafik) saat idle/tidak ada unduhan
      aktif
- [ ] Mulai unduhan → sparkline kecil + angka speed total muncul di status
      bar, di sebelah kanan tombol "Azhura Download Manager"
- [ ] Hover grafiknya → tooltip nampilin "Last 60s · avg … · peak …" dengan
      angka yang masuk akal
- [ ] Pause semua unduhan → garis grafik landai turun lalu grafik hilang lagi
      setelah ~60 detik semua sample jadi 0

**Update pending-install senyap** (bagian paling berisiko — uji pakai draft
release beneran, atau sementara arahkan `updater.endpoints` di
`tauri.conf.json` ke feed test):

- [ ] Ada update tersedia → app download-nya diam-diam di background dan
      **tetap kebuka** (gak nutup sendiri). Status bar nampilin "Restart to
      update". Gak ada window installer nongol, gak ada app nutup sendiri.
      Cek `%APPDATA%\AzhuraDownloadManager\pending-update.json` dan file
      `-setup.exe` di sebelahnya beneran ada
- [ ] Quit dari tray dengan toggle "Install updates when you quit" ON → app
      nutup dan **tidak nyala lagi sendiri**; buka manual lagi → versi sudah
      baru, dan `pending-update.json` sudah hilang
- [ ] Quit dengan toggle OFF → gak ada yang keinstall; "Restart to update"
      masih ada di launch berikutnya tanpa download ulang
- [ ] Matikan proses paksa lewat Task Manager selagi ada update pending
      (toggle ON), lalu buka app lagi → installer jalan **sebelum** window
      manapun kelihatan, app kebuka langsung di versi baru
- [ ] Klik "Restart to update" manual → dialog konfirmasi → app nutup dan
      kebuka lagi di versi baru
- [ ] Tandai feed test `"critical": true` → dialog countdown 30 detik tetap
      muncul dan tetap maksa restart (gak kepengaruh toggle
      "Install updates when you quit")
- [ ] Offline saat launch → gak ada toast/error; klik "Check for updates"
      selagi offline → toast error muncul

## 23. Menubar klasik tap-Alt (Batch 3b-1, baru)

Belum pernah diuji manual sama sekali. Lolos `tsc --noEmit`, `vitest run` (207 test), `cargo check
--all-targets`, dan `cargo test --lib` (138 test).

**Deteksi tap-Alt:**

- [ ] Tap dan lepas Alt dengan tabel dalam keadaan fokus → menubar muncul di bawah toolbar, "File"
      langsung fokus
- [ ] Tap Alt lagi → menubar hilang; fokus balik ke elemen yang tadi dipegang
- [ ] Tahan Alt lalu tekan Enter pas satu baris ke-select → window Detail kebuka dan menubar **tidak**
      muncul (regresi klasik yang desain ini jaga)
- [ ] Tahan Alt, tekan-lepas tombol lain, baru lepas Alt → menubar tidak muncul
- [ ] Tahan Alt, klik di mana pun, lepas Alt → menubar tidak muncul
- [ ] Alt+Tab keluar dan balik lagi → menubar tidak muncul pas balik
- [ ] Tekan Alt selagi fokus di search box → tidak ada yang terjadi
- [ ] Buka Settings, tap Alt → tidak ada yang terjadi; tutup Settings, tap Alt → menubar muncul
- [ ] Tap Alt biar menubar muncul, lalu klik baris di tabel unduhan (atau tombol toolbar, atau search
      box) → menubar **langsung hilang sendiri** (bukan nyangkut kebuka tapi gak bisa dipencet)
- [ ] Ulangi di atas tapi klik ke tombol trigger menubar lain (mis. dari "File" ke "View") →
      menubar **tetap kebuka**, cuma pindah menu

**Mnemonic huruf (baru):**

- [ ] Tiap judul menu (File/Downloads/View/Tools/Help) nampilin satu huruf digaris bawahi (F/D/V/T/H)
- [ ] Selagi menubar kebuka, tekan huruf mnemonic (mis. "V") **tanpa** Alt → langsung buka dropdown
      menu itu (View), gak perlu navigasi panah dulu
- [ ] Ganti ke huruf mnemonic lain (mis. "T") selagi menu lain lagi kebuka → langsung pindah ke menu
      itu (Tools), yang lama tertutup
- [ ] Tekan huruf yang gak match mnemonic manapun → gak ada yang terjadi, dropdown yang kebuka tetap
      di situ
- [ ] Huruf mnemonic tetap kebaca jelas (underline-nya kontras) pas menu-nya lagi ke-highlight aktif
      (background aksen)

**Submenu View > Group Rows / Filter by Status / Theme (baru):**

- [ ] Di menu View, ketiga item ini nampilin caret "▸" di kanan (bukan lagi list rata dipisah
      separator)
- [ ] Hover salah satu (mis. "Group Rows") → flyout-nya langsung muncul di sebelah kanan, isinya
      pilihan yang sesuai (No grouping/Group by category/Group by date), tanda centang ada di pilihan
      yang aktif
- [ ] Hover ke item submenu lain (mis. "Theme") selagi flyout "Group Rows" kebuka → langsung pindah
      ke flyout "Theme", yang lama nutup
- [ ] Hover item BIASA (bukan submenu, mis. "Toggle Sidebar") selagi ada flyout kebuka → flyout-nya
      nutup
- [ ] Keyboard: navigasi ke salah satu item submenu (panah atas/bawah), tekan panah **kanan** →
      flyout-nya kebuka, cursor pindah ke item pertama di dalamnya
- [ ] Di dalam flyout: panah atas/bawah pindah antar pilihan, Home/End ke awal/akhir, Enter milih
      dan **nutup seluruh menubar** (bukan cuma flyout-nya)
- [ ] Di dalam flyout: panah **kiri** atau Esc → cuma nutup flyout-nya, balik ke menu View dengan
      baris "Group Rows"/dst tetap ke-highlight, menubar-nya sendiri tetap kebuka
- [ ] Klik langsung salah satu pilihan di dalam flyout (mis. "Group by category") → langsung
      keterapkan (grouping tabel berubah) dan seluruh menubar nutup
- [ ] Klik di luar menubar selagi flyout kebuka → semuanya nutup, gak nyangkut setengah-setengah
- [ ] Flyout-nya kelihatan di ATAS panel View (gak ketutupan), posisinya nempel di sebelah kanan
      baris submenu yang dibuka

**Navigasi:**

- [ ] Panah kiri/kanan pindah antar File…Help; panah bawah buka menu di item pertama; panah atas di
      item terakhir; Home/End lompat ke awal/akhir; Enter jalanin item; Esc nutup dropdown, Esc kedua
      nutup menubar-nya
- [ ] Navigasi panah skip separator dan item yang di-grey-out di kedua arah, dan wrap di ujung-ujungnya
- [ ] Selagi satu menu kebuka, hover ke judul menu lain langsung pindah; selagi belum ada yang kebuka,
      hover doang tidak munculin apa-apa
- [ ] Highlight mouse dan cursor keyboard tidak pernah dobel — selalu satu highlight yang sama
- [ ] Selagi menubar kebuka: Space **tidak** pause download, panah **tidak** gerakin seleksi tabel,
      Ctrl+A **tidak** select all

**Item menu:**

- [ ] Semua item File/Downloads/View/Tools/Help ngelakuin hal yang sama kayak tombol toolbar/shortcut
      yang sepadan, dan menubar-nya nutup sendiri sesudahnya
- [ ] Status grey-out ngikutin seleksi persis kayak tombol toolbar (gak ada yang di-select → Resume /
      Pause / Cancel / Delete / Copy Link semua grey)
- [ ] View > Theme nampilin centang di sebelah tema aktif dan ganti tema langsung keterapkan
- [ ] View > Show/Hide Columns… buka menu kolom yang sudah ada, posisinya pas di bawah item itu
- [ ] File > Open Downloads Folder buka `…\Downloads\AzhuraDownloadManager` di Explorer
- [ ] File > Exit beneran nutup app (ikon tray hilang, proses gak ada lagi) dan unduhan yang lagi
      jalan balik jadi resumable pas dibuka lagi
- [ ] Tools > Check for Updates kelakuannya sama kayak tombol di Settings, dan grey selagi lagi ngecek

**Chrome:**

- [ ] Drag window lewat toolbar tetap jalan; drag lewat baris menubar **tidak** ikut mindahin window,
      dan klik "File" gak pernah ke-anggep drag
- [ ] Tabel ngecil persis setinggi menubar pas toggle, gak ada layout yang loncat
- [ ] Kedua tema kelihatan pas; judul menu yang lagi kebuka ke-highlight

## 24. Auto rules — URL pattern → folder otomatis (Batch 3b-2, baru)

Belum pernah diuji manual sama sekali. Lolos `tsc --noEmit`, `vitest run` (219 test), `cargo check
--all-targets`, dan `cargo test --lib` (158 test).

**Editor (Tools > Auto Rules… atau Settings > Downloads > Auto rules "Manage…"):**

- [ ] Kedua entry point buka dialog yang sama; baris "Auto rules" di Settings nampilin "N active"
      sesuai jumlah rule yang enabled
- [ ] Tambah rule baru ("Add rule") → muncul baris kosong, default Wildcard + target Folder
- [ ] Ketik regex yang salah (mis. cuma `(`) di rule yang **enabled** → muncul pesan error di bawah
      pattern-nya dan tombol Save ke-disable; benerin pattern-nya → error hilang, Save aktif lagi
- [ ] Rule dengan target Folder yang kosong atau path relatif → Save tetap disabled; isi lewat
      "Browse…" → Save aktif (asal semua rule enabled lainnya juga valid)
- [ ] Rule yang **disabled** (checkbox off) boleh punya pattern/folder kosong atau salah tanpa
      nge-block Save
- [ ] Tombol ▲/▼ mindahin urutan rule; ✕ ngehapus rule (dengan konfirmasi dari card-nya sendiri,
      gak ada dialog tambahan)
- [ ] "Cancel" nutup dialog tanpa nyimpen perubahan apapun; buka lagi → balik ke rule yang tersimpan
      terakhir
- [ ] "Save" nyimpen dan nutup dialog; restart app sepenuhnya → rule-nya tetap ada
- [ ] "Test a URL": ketik URL yang cocok salah satu rule → muncul "Matches rule N → saves to …"
      dengan nomor dan folder yang bener; ketik URL yang gak cocok → "No match — the Add window will
      open."
- [ ] Ganti "Save to" dari Folder ke salah satu kategori (mis. "Videos folder") → input path+Browse
      hilang, select kategori aja yang kelihatan

**Capture warm start (app lagi jalan):**

- [ ] Bikin rule wildcard `*.iso` → Folder `D:\ISO` (atau folder test lain). Klik link `.iso` di
      browser → window Add **tidak** muncul, baris langsung queued/downloading, dan toast
      `Auto rule "*.iso" → D:\ISO` muncul. File akhirnya ada di folder itu
- [ ] Bikin rule wildcard host/path (mis. `*github.com/*`) → target kategori Programs → file akhirnya
      masuk folder Programs (atau folder override kategori itu kalau ada)
- [ ] Rule yang di-disable diabaikan sepenuhnya — link yang cocok pattern-nya tetap buka window Add
- [ ] Dua rule yang sama-sama cocok satu URL → yang urutannya lebih atas yang menang
- [ ] Link yang gak cocok rule manapun → window Add kebuka seperti biasa, gak ada bedanya
- [ ] Klik link buat baris yang lagi nunggu re-capture kredensial (`awaitingCapture`) — baris itu
      tetap ke-claim dan **tidak** kebuat duplikat, walaupun ada rule yang cocok sama URL-nya

**Capture cold start (app dalam keadaan tertutup):**

- [ ] Tutup app sepenuhnya (proses tray-nya juga gak ada), klik link yang cocok rule → app kebuka
      sendiri, main window kelihatan, unduhannya langsung queued, toast muncul, dan window Add
      **tidak pernah** kelihatan sama sekali
- [ ] Tutup app, klik link yang gak cocok rule manapun → window Add kebuka dengan form terisi
      seperti biasa (perilaku lama, gak berubah)

**Lain-lain:**

- [ ] Clipboard watch dan "Paste & download" (klik kanan tabel) tetap **selalu** buka window Add,
      walaupun URL-nya cocok sama sebuah rule
- [ ] Export backup lalu import lagi → rule-rule auto ikut ke-roundtrip persis
- [ ] Edit manual `settings.json` biar salah satu rule regex-nya rusak (mis. `"pattern": "("`), lalu
      import backup apapun → rule yang rusak itu ilang sendiri dari list (bukan bikin crash atau
      nge-block rule lainnya)
- [ ] Kalau "Hold the queue until a set time" (scheduled start) aktif, unduhan yang lolos auto rule
      tetap ketahan sampai jam yang dijadwalkan — bukan langsung jalan (dia cuma `queued`, sama kayak
      unduhan biasa)
