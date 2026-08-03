// Performs the actual `adm://` navigation. This has to happen from a real
// page rather than from the background script, because Gecko won't load a
// non-standard scheme handed to `tabs.create`.

const target = decodeURIComponent(location.hash.slice(1));

// The hash is written by our own background script, but treat it as untrusted
// anyway — this page must never be turned into a redirector for other schemes.
const isAdmLink = target.startsWith("adm://");

function handOff() {
  if (!isAdmLink) return;
  location.href = target;
}

if (isAdmLink) {
  handOff();
  // The external-protocol prompt leaves this page in place, so offer a manual
  // retry once it's clear the hand-off didn't take.
  setTimeout(() => {
    document.getElementById("fallback").hidden = false;
  }, 1200);
  document.getElementById("retry").addEventListener("click", (e) => {
    e.preventDefault();
    handOff();
  });
}
