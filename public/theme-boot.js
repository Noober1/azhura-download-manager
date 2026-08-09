// Stamps the color theme (and the reduced-motion opt-in) before the first
// paint, so a light-theme user never sees a dark frame while React boots,
// and a reduced-motion user never sees the sweep keyframe spin for even one
// frame. settings.json stays the source of truth; this reads the mirrors
// src/theme.ts and src/reducedMotion.ts keep in sync.
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
  try {
    var reduceMotion = localStorage.getItem("adm-reduce-motion") === "1";
    document.documentElement.dataset.reducedMotion = reduceMotion ? "on" : "off";
  } catch (e) {
    document.documentElement.dataset.reducedMotion = "off";
  }
})();
