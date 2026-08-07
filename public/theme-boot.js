// Stamps the color theme before the first paint, so a light-theme user never
// sees a dark frame while React boots. settings.json stays the source of
// truth; this reads the mirror src/theme.ts keeps in sync.
//
// A separate file (rather than inlined in each HTML entry point) so it can
// be loaded via <script src>, which is what lets tauri.conf.json's CSP drop
// 'unsafe-inline' from script-src — an inline <script> block would otherwise
// need that exception to run at all.
(function () {
  try {
    var t = localStorage.getItem("adm-theme") || "system";
    var dark =
      t === "dark" ||
      (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();
