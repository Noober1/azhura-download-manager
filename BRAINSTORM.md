# Brainstorm

Ide fitur & UX dari sesi brainstorming — dicatat, belum diimplementasi. Bug/fix
backlog yang sempat diusulkan sengaja di-skip dulu (belum diverifikasi apa
beneran masalah).

## Fitur baru

- [x] Search/filter bar di tabel unduhan (nama file, status, kategori)
- [x] Grouping tabel unduhan by kategori/tanggal (collapsible)
- [ ] Auto-rule: regex site/filetype → kategori+folder otomatis (skip dialog
      konfirmasi kategori)
- [ ] Dashboard statistik (total data terunduh, grafik kecepatan
      harian/bulanan)
- [x] Export/import pengaturan + daftar unduhan (backup/restore, pindah ke PC
      lain)
- [x] Export riwayat unduhan ke CSV
- [ ] PIN/password lock buat buka aplikasi
- [x] Global hotkey (system-wide) buat buka window "Tambah Unduhan" dari luar
      app
- [x] Cek disk space sebelum mulai unduhan besar, warning kalau gak cukup
- [ ] Video/stream sniffer (deteksi HLS/m3u8 + mux) — scope besar, prioritas
      belakangan
- [x] **Menubar klasik, muncul saat main window focus + tombol Alt ditekan.**
      Perilaku standar aplikasi Windows (Notepad, Explorer, dll): menubar
      tersembunyi secara default, toggle muncul saat tap Alt sendirian (bukan
      kombinasi) selagi window lagi focus. Gak bentrok sama shortcut Alt+Enter
      yang udah dipakai buka Detail window (`useAppShortcuts.ts`), karena itu
      kombinasi Alt+key, bukan tap Alt sendiri — tetap perlu dicek pas
      implementasi. Isi menu, dipetakan ke aksi & shortcut yang udah ada di
      kode:
      - **File** — Add Download… (Ctrl+N), Open Downloads Folder, Exit
      - **Downloads** — Pause/Resume (Space), Cancel, Delete…, Copy Link
        (Ctrl+C), Select All (Ctrl+A), Refresh, Clear History…
      - **View** — Toggle Sidebar (Ctrl+B), Show/Hide Columns, Theme
        (System/Light/Dark)
      - **Tools** — Settings… (Ctrl+,), Extensions… (Ctrl+Shift+X), Check for
        Updates
      - **Help** — Keyboard Shortcuts (Ctrl+/), About Azhura Download Manager
- [ ] **Changelog viewer / "What's New" window.** Muncul otomatis sekali
      setelah app selesai update dan restart (setelah [Fitur baru] silent
      auto-update install di atas kepasang), nampilin ringkasan perubahan
      versi baru. Catatan: `releaseBody` di `.github/workflows/release.yml`
      sekarang masih placeholder statis ("See the assets below…"), belum
      berupa changelog asli per rilis — jadi fitur ini butuh sumber changelog
      nyata per versi dulu (lihat follow-up di bawah) sebelum window ini ada
      isinya.

  **Follow-up sesudah fitur ini diimplementasi:** tambahin behavior ke
  `CLAUDE.md` project (belum ada — perlu dibuat) yang mewajibkan nulis entry
  changelog tiap ada perubahan user-facing selama pengembangan, supaya
  window "What's New" selalu punya konten yang akurat dan gak nyusul manual
  pas mau rilis.

## Fixes

- [x] **Silent auto-update install — jangan pernah maksa nutup app sendiri.**
      Sekarang: kalau `autoInstall` on dan gak ada unduhan aktif/antre, app
      langsung manggil `install()` begitu file update kelar didownload —
      nutup diri sendiri dan buka installer di tengah sesi, cuma toast
      sekilas tanpa dialog konfirmasi (`src/hooks/useUpdateCheck.ts`).
      Maunya: update yang udah didownload gak pernah bikin app nutup diri
      sendiri secara sepihak. Tandai sebagai "pending install", baru
      dieksekusi diam-diam di dua titik — (1) pas user beneran nutup app
      sendiri (tray Quit / window close, reuse jalur
      `prepareForUpdate`/`begin_shutdown` yang udah ada), dan (2) pas app
      dibuka lagi dari cold start kalau ternyata masih ada update pending
      yang belum sempat kepasang (mis. proses dimatiin paksa / reboot).
      Restart berikutnya otomatis udah versi baru, tanpa installer window
      nongol di tengah kerja.
      Update `critical` TIDAK ikut berubah — tetap paksa restart lewat
      `UpdateRestartDialog.tsx` (popup + countdown 30 detik, gak bisa
      di-cancel), karena critical fix emang harus segera, bukan nunggu
      restart natural yang bisa gak kejadian berhari-hari.
- [x] **Scrollbar kelebaran, kurangi 50%.** `src/styles/polish.css:6-7` —
      `::-webkit-scrollbar { width: 14px; height: 14px; }` → jadi `7px`.

## UX/UI polish

- [ ] Drag-reorder prioritas antrian langsung dari tabel
- [x] Grafik kecepatan gabungan (semua unduhan aktif) di status bar
- [x] Compact/comfortable row height toggle
- [x] Badge jumlah unduhan aktif per kategori di sidebar
- [x] Indikator visual lebih jelas untuk unduhan yang sedang "held" oleh
      scheduler
