# Azhura Download Manager

Azhura Download Manager (ADM) adalah aplikasi untuk mengunduh file dari internet
lebih cepat, lebih rapi, dan lebih terkontrol dibanding mengunduh langsung lewat
browser.

## Fitur Utama

### Unduhan lebih cepat
- File besar otomatis dipecah dan diunduh lewat beberapa koneksi sekaligus,
  sehingga bisa jauh lebih cepat dibanding unduhan biasa.
- Jumlah koneksi bisa diatur sendiri (1 sampai 16), tergantung kebutuhan.

### Bisa dijeda dan dilanjutkan kapan saja
- Unduhan bisa dijeda (pause) dan dilanjutkan (resume) tanpa mengulang dari
  awal, bahkan setelah aplikasi ditutup dan komputer dimatikan.
- Kalau file di server ternyata sudah berubah selagi unduhan dijeda, aplikasi
  akan memberi tahu daripada diam-diam menyimpan file yang rusak/campur aduk.

### Rapi dan otomatis terorganisir
- File hasil unduhan otomatis dikelompokkan ke folder berdasarkan jenisnya:
  Videos, Audios, Programs, Documents, Archives, dan Others.
- Folder tujuan tiap kategori bisa diganti sesuai keinginan, dan akan diingat
  untuk unduhan berikutnya.
- Nama file yang bentrok otomatis diberi penomoran, tidak akan menimpa file
  yang sudah ada.

### Kontrol penuh atas kecepatan
- Bisa membatasi kecepatan unduhan, baik untuk semua unduhan sekaligus maupun
  satu per satu, dan perubahannya langsung terasa tanpa perlu memulai ulang.

### Verifikasi keaslian file
- Mendukung pengecekan checksum (MD5/SHA-1/SHA-256/SHA-512) untuk memastikan
  file yang diunduh benar-benar utuh dan tidak rusak/dipalsukan.

### Tampilan dan pengelolaan daftar unduhan
- Daftar unduhan bisa diurutkan berdasarkan nama, tanggal, status, ukuran,
  progres, atau kecepatan.
- Bisa memilih banyak unduhan sekaligus (dengan klik, Shift/Ctrl, atau tarik
  area seleksi) untuk dijeda, dilanjutkan, dibatalkan, atau dihapus bersamaan.
- Klik kanan pada unduhan untuk akses cepat ke berbagai aksi: buka file, buka
  folder, salin tautan, atur batas kecepatan, ubah jumlah koneksi, dan lainnya.
- Setiap unduhan bisa dibuka di jendela detail terpisah, menampilkan progres,
  kecepatan, perkiraan waktu selesai, dan informasi lengkap lainnya — jendela
  detail ini bisa dibuka untuk beberapa unduhan sekaligus secara bersamaan.

### Menambahkan unduhan dengan mudah
- Jendela "Tambah Unduhan" dengan pengecekan otomatis ukuran file sebelum
  benar-benar mulai mengunduh.
- Bisa mengatur nama file kustom, lokasi penyimpanan, jumlah koneksi, batas
  kecepatan, checksum, penggunaan proxy, hingga informasi tambahan seperti
  User Agent, Referer, dan Cookie untuk tautan yang membutuhkannya.
- Jika alamat unduhan sudah tersalin di clipboard, otomatis terisi begitu
  jendela "Tambah Unduhan" dibuka.
- Ada peringatan khusus jika tautan yang dimasukkan tidak terenkripsi
  (http:// biasa), supaya pengguna sadar risikonya sebelum melanjutkan.

### Riwayat unduhan
- Unduhan yang sudah selesai, gagal, atau dibatalkan tetap tersimpan riwayatnya
  meski aplikasi ditutup dan dibuka kembali.
- Jika file hasil unduhan ternyata sudah dipindah/dihapus dari luar aplikasi,
  statusnya otomatis ditandai "tidak ditemukan".

### Berjalan di latar belakang (system tray)
- Aplikasi bisa disembunyikan ke ikon system tray dan tetap mengunduh di latar
  belakang.
- Ikon tray menampilkan daftar unduhan yang sedang berjalan beserta progresnya,
  dan bisa diklik untuk langsung membuka detail unduhan tersebut.
- Ada notifikasi desktop saat unduhan selesai atau gagal (bisa dimatikan lewat
  pengaturan).

### Ekstensi browser (Chrome dan Firefox)
- Tersedia ekstensi untuk Chrome/Edge/Brave dan Firefox/Zen/LibreWolf yang
  menambahkan menu klik-kanan "Download with ADM" pada tautan di halaman web,
  sehingga unduhan langsung ditangani oleh Azhura Download Manager, bukan oleh
  browser.
- Ada juga mode "tangkap unduhan" untuk tombol-tombol download di situs yang
  tidak berupa tautan biasa (misalnya tombol yang dijalankan lewat kode
  program di halaman), sehingga tetap bisa dialihkan ke aplikasi ini.
- Untuk beberapa situs tertentu yang mengharuskan sesi login aktif di browser,
  ekstensi bisa ikut meneruskan informasi sesi tersebut supaya unduhan tidak
  gagal karena dianggap tidak login.
- Informasi sensitif dari browser (seperti sesi login) dikirim langsung dan
  aman ke aplikasi di komputer yang sama, bukan lewat cara yang bisa terekam
  oleh aplikasi lain di komputer.

### Pengaturan yang bisa disesuaikan
- Jumlah unduhan aktif maksimal yang berjalan bersamaan.
- Batas kecepatan unduhan secara keseluruhan.
- Tampilan aplikasi: mengikuti sistem, gelap, atau terang.
- Minimize ke tray, dan aktif/nonaktifkan notifikasi desktop.

### Keamanan dan privasi
- Kata sandi proxy yang disimpan di komputer akan dienkripsi, tidak tersimpan
  dalam bentuk teks biasa yang mudah dibaca.
- Aplikasi menandai file hasil unduhan sebagai "berasal dari internet" (sama
  seperti yang dilakukan browser pada umumnya), sehingga Windows tetap bisa
  memberi peringatan keamanan yang semestinya untuk file semacam itu.
- Unduhan lewat tautan http:// yang tidak terenkripsi tidak akan langsung
  diproses tanpa persetujuan pengguna terlebih dahulu.
