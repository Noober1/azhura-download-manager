// Firefox/Gecko build of the ADM capture add-on (Firefox, Zen, LibreWolf, …).
//
// Differences from the Chrome build in ../extension, all forced by Gecko:
//   * MV3 background is an event *page* (`background.scripts`), not a service
//     worker, so this file runs in a document context.
//   * `adm://` hand-off goes through launcher.html instead of `tabs.create`
//     with the custom scheme directly — see `sendToAdm`.
//   * Host permissions are optional at runtime under MV3, so the cookie
//     forwarding path has to ask for them instead of assuming them.

const api = globalThis.browser ?? globalThis.chrome;

const MENU_ID = "adm-download";
const ARM_MENU_ID = "adm-arm-capture";
const ARMED_KEY = "captureArmed";

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: MENU_ID,
    title: "Download with ADM",
    contexts: ["link"],
  });
  // A page-wide fallback for "download" buttons/links that aren't real
  // hrefs (JS-driven, or a form submit button like Google Drive's large-file
  // warning page) — right-click the page itself instead of hunting for the
  // toolbar icon, which a freshly installed temporary add-on won't have
  // pinned/visible by default.
  api.contextMenus.create({
    id: ARM_MENU_ID,
    title: "Arm ADM capture (next download)",
    contexts: ["page"],
  });
});

// Some hosts gate their direct download URLs behind a cookie the browser
// sends automatically (ambient auth on <img>/<a> requests) but a plain HTTP
// client has no way to obtain — ADM's Rust downloader is exactly that kind
// of plain client. For a short allow-list of known hosts, look that cookie
// up via the cookies API and forward it as a real `Cookie` header.
const COOKIE_FORWARD_DOMAINS = {
  "gofile.io": ["accountToken"],
};

function matchForwardDomain(targetUrl) {
  let host;
  try {
    host = new URL(targetUrl).hostname;
  } catch {
    return undefined;
  }
  return Object.keys(COOKIE_FORWARD_DOMAINS).find(
    (d) => host === d || host.endsWith(`.${d}`),
  );
}

// Under Firefox MV3 a `host_permissions` entry is only a *request* — the user
// grants it separately, and until then `cookies.get` returns nothing. Ask for
// it on demand; this runs from a context-menu click, which counts as the user
// gesture `permissions.request` requires.
async function ensureHostPermission(domain) {
  const origins = [`*://*.${domain}/*`];
  try {
    if (await api.permissions.contains({ origins })) return true;
    return await api.permissions.request({ origins });
  } catch {
    return false;
  }
}

async function getForwardCookie(targetUrl) {
  const domain = matchForwardDomain(targetUrl);
  if (!domain) return undefined;
  if (!(await ensureHostPermission(domain))) return undefined;

  const pairs = [];
  for (const name of COOKIE_FORWARD_DOMAINS[domain]) {
    const cookie = await api.cookies
      .get({ url: `https://${domain}/`, name })
      .catch(() => null);
    if (cookie) pairs.push(`${cookie.name}=${cookie.value}`);
  }
  return pairs.length ? pairs.join("; ") : undefined;
}

async function sendToAdm(url, referrer, cookie) {
  const params = new URLSearchParams({ url });
  if (referrer) params.set("referrer", referrer);
  if (cookie) params.set("cookie", cookie);
  const admUrl = `adm://add?${params.toString()}`;

  // Gecko refuses to load a non-standard scheme passed straight to
  // `tabs.create`, so bounce through a packaged page that performs the
  // navigation itself — that path does reach the OS protocol handler and
  // shows Firefox's "Open Azhura Download Manager?" prompt. Ticking
  // "Always allow" there suppresses it for later hand-offs (inherent to
  // custom URL protocols, not something this code can skip).
  //
  // The tab must be foregrounded: the prompt only renders on the active tab,
  // so a background tab would be silently closed with nothing ever shown.
  const launcher = `${api.runtime.getURL("launcher.html")}#${encodeURIComponent(admUrl)}`;
  const created = await api.tabs.create({ url: launcher }).catch(() => null);
  if (!created?.id) return;
  setTimeout(() => api.tabs.remove(created.id).catch(() => {}), 2500);
}

function notify(title, message) {
  api.notifications.create({
    type: "basic",
    iconUrl: api.runtime.getURL("icons/icon128.png"),
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
  await api.storage.session.set({ [ARMED_KEY]: armed });
  api.action.setBadgeBackgroundColor({ color: "#d64545" });
  api.action.setBadgeText({ text: armed ? "ON" : "" });
  if (armed) {
    notify(
      "ADM capture armed",
      "Click the page's download button/link now — the next download will be redirected to ADM.",
    );
  }
}

async function isArmed() {
  const stored = await api.storage.session.get(ARMED_KEY);
  return !!stored[ARMED_KEY];
}

api.action.onClicked.addListener(async () => {
  setArmed(!(await isArmed()));
});

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === ARM_MENU_ID) {
    setArmed(!(await isArmed()));
    return;
  }

  if (info.menuItemId !== MENU_ID || !info.linkUrl) return;

  // Some "download" links aren't real hrefs at all — e.g. `javascript:void(0)`
  // or a form submit button. There's no URL to hand off in that case; the
  // "arm capture" flow above handles those instead.
  if (!/^https?:\/\//i.test(info.linkUrl)) {
    notify(
      "Can't grab this link",
      'This link has no real download URL (it\'s a JavaScript- or form-driven button, not a plain link). Right-click the page and choose "Arm ADM capture", then click the download button instead.',
    );
    return;
  }

  sendToAdm(info.linkUrl, tab?.url, await getForwardCookie(info.linkUrl));
});

api.downloads.onCreated.addListener(async (item) => {
  if (!(await isArmed())) return;
  await setArmed(false);
  await api.downloads.cancel(item.id).catch(() => {});
  await api.downloads.erase({ id: item.id }).catch(() => {});
  const finalUrl = item.finalUrl || item.url;
  sendToAdm(finalUrl, item.referrer || undefined, await getForwardCookie(finalUrl));
});
