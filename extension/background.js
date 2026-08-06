importScripts("common.js");
const { MENU_ID, ARM_MENU_ID, ARMED_KEY, COOKIE_FORWARD_DOMAINS, matchForwardDomain, buildAdmUrl } =
  ADM;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Download with ADM",
    contexts: ["link"],
  });
  // A page-wide fallback for "download" buttons/links that aren't real
  // hrefs (JS-driven, or a form submit button like Google Drive's large-file
  // warning page) — right-click the page itself instead of hunting for the
  // toolbar icon, which a freshly installed unpacked extension won't have
  // pinned/visible by default.
  chrome.contextMenus.create({
    id: ARM_MENU_ID,
    title: "Arm ADM capture (next download)",
    contexts: ["page"],
  });
});

// Look the forwarding cookie up via chrome.cookies. Needs a matching entry in
// manifest.json's host_permissions to be readable.
async function getForwardCookie(targetUrl) {
  const domain = matchForwardDomain(targetUrl);
  if (!domain) return undefined;

  const pairs = [];
  for (const name of COOKIE_FORWARD_DOMAINS[domain]) {
    const cookie = await chrome.cookies.get({ url: `https://${domain}/`, name }).catch(() => null);
    if (cookie) pairs.push(`${cookie.name}=${cookie.value}`);
  }
  return pairs.length ? pairs.join("; ") : undefined;
}

function sendToAdm(url, referrer, cookie) {
  const admUrl = buildAdmUrl(url, referrer, cookie);

  // Custom-protocol navigation always leaves the tab that triggered it on a
  // failed/blank page — close it shortly after so nothing sticks around.
  // The tab must be foregrounded (not active: false): Chrome's "Open Azhura
  // Download Manager?" confirmation only renders on the active tab, so a
  // background tab would just get silently closed with no prompt ever
  // shown. Checking "Always allow" on that first prompt suppresses it for
  // later hand-offs (inherent to custom URL protocols, not something this
  // code can skip).
  chrome.tabs.create({ url: admUrl }, (created) => {
    if (!created?.id) return;
    setTimeout(() => chrome.tabs.remove(created.id).catch(() => {}), 2500);
  });
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
  });
}

// --- "Arm capture": for download triggers with no real href — JS-driven
// buttons, or a form submit button like Google Drive's "can't scan this
// file, download anyway?" warning page. Arm it (toolbar icon or page
// right-click), then click the page's download trigger normally — the next
// browser download is canceled and its URL redirected to ADM instead of
// saving locally. One-shot: it disarms itself as soon as it catches a
// download, so it never keeps silently redirecting later ones.
//
// This only works for downloads the browser actually starts a network
// request for (including a plain form GET submit, which is what Google
// Drive's warning page uses). A button that generates a file purely
// in-page (a `blob:` URL with no server-side original) has no URL to hand
// off — that's a hard limit, not something this can work around.

async function setArmed(armed) {
  await chrome.storage.session.set({ [ARMED_KEY]: armed });
  chrome.action.setBadgeBackgroundColor({ color: "#d64545" });
  chrome.action.setBadgeText({ text: armed ? "ON" : "" });
  if (armed) {
    notify("ADM capture armed", "Click the page's download button/link now — the next download will be redirected to ADM.");
  }
}

async function isArmed() {
  const stored = await chrome.storage.session.get(ARMED_KEY);
  return !!stored[ARMED_KEY];
}

chrome.action.onClicked.addListener(async () => {
  setArmed(!(await isArmed()));
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === ARM_MENU_ID) {
    setArmed(!(await isArmed()));
    return;
  }

  if (info.menuItemId !== MENU_ID || !info.linkUrl) return;

  // Some "download" links aren't real hrefs at all — e.g. `javascript:void(0)`
  // or a form submit button. There's no URL to hand off in that case; the
  // "arm capture" flow above handles those instead.
  if (!ADM.DOWNLOAD_LINK_RE.test(info.linkUrl)) {
    notify(ADM.CANT_GRAB_TITLE, ADM.CANT_GRAB_MESSAGE);
    return;
  }

  sendToAdm(info.linkUrl, tab?.url, await getForwardCookie(info.linkUrl));
});

chrome.downloads.onCreated.addListener(async (item) => {
  if (!(await isArmed())) return;
  await setArmed(false);
  await chrome.downloads.cancel(item.id).catch(() => {});
  await chrome.downloads.erase({ id: item.id }).catch(() => {});
  const finalUrl = item.finalUrl || item.url;
  sendToAdm(finalUrl, item.referrer || undefined, await getForwardCookie(finalUrl));
});
