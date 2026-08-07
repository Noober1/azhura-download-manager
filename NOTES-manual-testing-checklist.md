# Checklist Manual Testing — v0.2.1 Follow-up

Jalankan `bun run tauri dev` lalu centang satu per satu.

## 0. Persiapan

- [ ] `bun run tauri dev` berhasil start, window utama muncul tanpa error di console
- [ ] Cek `src/bindings.ts` ter-regenerate otomatis (diff-nya harus cocok dengan yang sudah di-mirror manual — `getRunAtStartup`, `setRunAtStartup`, `launchedAtStartup`)

---

## 1. Sortir kolom Status

- [ ] Siapkan minimal 4 baris download dengan status berbeda: **Complete**, **Error**, **Paused**, dan satu **Moved/deleted** (selesaikan satu download, lalu rename/hapus filenya di File Explorer, tekan **F5** di app untuk refresh status)
- [ ] Klik header **Status** sekali → urutan ascending: Downloading → Verifying → Queued → Waiting for browser → Paused → Error → Moved/deleted → Canceled → Complete
- [ ] Baris "Moved / deleted" mengelompok di antara Error dan Canceled, **tidak** ikut ke posisi Complete
- [ ] Klik header **Status** lagi → urutan kebalikannya (descending)
- [ ] Klik ketiga kalinya → sortir kembali ke default (Date Added, terbaru dulu)
- [ ] (Opsional) Trigger status **Waiting for browser**: download yang butuh cookie/auth, biarkan tertahan → cek dia sortir terpisah dari Paused biasa

## 2. Redownload vs Resume

- [ ] Buka detail popup pada baris **Moved/deleted** (double-click atau context menu → Show detail)
  - [ ] Tombol bertuliskan **Redownload**, bukan "Resume"
  - [ ] Teks catatan: "No longer at ... — click Redownload to fetch it again."
  - [ ] Klik Redownload → progress mulai dari 0%, bukan lanjut dari sisa lama
- [ ] Buka detail popup pada baris **Paused** biasa (bukan missing/history)
  - [ ] Tombol tetap bertuliskan **Resume**
  - [ ] Klik Resume → lanjut dari byte yang sudah ada, bukan mulai ulang
- [ ] Klik kanan pada baris Moved/deleted → context menu item pertama bertuliskan **Redownload**
- [ ] Klik kanan pada baris Paused biasa → context menu bertuliskan **Resume**
- [ ] Seleksi campuran (1 Paused + 1 Moved/deleted) di context menu → cek label yang muncul (harus "Resume" karena tidak semua item redownload)
- [ ] Hover toolbar tombol Resume/Redownload → tooltip title-nya ikut berubah sesuai seleksi

## 3. Derivasi nama file

Tambahkan masing-masing URL berikut lewat Add Download, biarkan selesai, lalu cek nama file akhir & folder kategori-nya:

- [ ] `https://.../download?filename=sample.mp4` → tersimpan sebagai `sample.mp4` (bukan `download`), masuk folder **Video**, icon file benar
- [ ] URL yang server-nya kirim header `Content-Disposition: attachment; filename*=UTF-8''na%C3%AFve%20file.zip` (bisa pakai httpbin/test server sendiri) → nama file ter-decode UTF-8 dengan benar (`naïve file.zip`), masuk folder **Archive**
- [ ] URL bare tanpa ekstensi di path (mis. `https://.../stream`) yang server-nya balas `Content-Type: video/mp4` → tersimpan dengan ekstensi `.mp4` ditambahkan otomatis
- [ ] URL biasa (`https://.../file.zip`) → masih bekerja seperti sebelumnya (regresi check)
- [ ] Cek preview nama file di Add window (sebelum download dimulai) sudah menampilkan nama yang masuk akal juga, bukan `download`

## 4. Run at startup

- [ ] Buka Settings → centang **Run at startup** → cek muncul di Task Manager → tab **Startup** (Windows) dengan status Enabled
- [ ] Restart app (tutup dari tray, buka lagi manual) → window tetap tampil normal (bukan mode autostart)
- [ ] Simulasikan autostart: jalankan exe dengan flag `--autostart` langsung dari terminal (`./azhura-download-manager.exe --autostart` di folder target/debug) → app **tidak** menampilkan window, langsung ke tray
- [ ] Klik icon tray → window muncul normal
- [ ] Balik ke Settings → uncheck **Run at startup** → cek entry hilang dari Task Manager → Startup
- [ ] (Opsional) Reboot beneran untuk full end-to-end test kalau ada waktu

## 5. Animasi (Motion)

- [ ] Buka Settings dialog → overlay fade-in + panel muncul dengan scale+slide (bukan langsung snap)
- [ ] Tutup Settings dialog → animasi exit (fade+scale out) sebelum hilang
- [ ] Ulangi untuk **semua** dialog lain: Extensions, Delete confirmation, Speed cap custom, Connection restart confirmation
- [ ] Klik kanan baris download → context menu muncul dengan scale+fade cepat, posisinya tetap ter-clamp dalam window (coba klik kanan dekat tepi kanan/bawah window)
- [ ] Klik tombol toolbar (Add, Resume, Pause, dst) → ada efek "tekan" (scale down) sekilas saat diklik
- [ ] Klik pindah kategori di sidebar (All → Active → Finished → tipe file) → indikator aksen (garis kiri) **slide** ke posisi baru, tidak loncat
- [ ] Buka detail popup → body muncul dengan fade+slide halus setelah snapshot pertama datang
- [ ] Di detail popup, ubah status download (mis. pause lalu resume) → label status (mode-tag) cross-fade, tidak snap langsung
- [ ] Buka Add Download window → klik pindah tab (Link/Proxy/More Options/Advanced) → garis aksen di atas tab **slide** ke tab yang aktif
- [ ] Isi form di salah satu tab, pindah ke tab lain lalu balik lagi → data form **tidak hilang** (tab panel tidak ter-unmount)
- [ ] Aktifkan **Windows Settings → Aksesibilitas → Efek visual → Animation effects: OFF**, restart app → semua animasi di atas jadi instan (tidak ada transisi sama sekali)

---

## Regresi umum

- [ ] Search box, marquee-select drag, resize kolom tabel masih normal (area ini sengaja tidak disentuh)
- [ ] Download paralel/multi-connection tetap jalan normal, tidak ada lag terasa di tabel saat banyak download aktif sekaligus
- [ ] Tray menu (klik kanan icon tray) masih menampilkan daftar download aktif dengan benar
