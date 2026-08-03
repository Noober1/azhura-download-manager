# ADM Capture — Firefox / Gecko build

Same capture add-on as `../extension`, rebuilt for Firefox-based browsers:
**Firefox, Zen Browser, LibreWolf, Waterfox, Floorp**.

Keep the two folders separate — Chrome and Gecko disagree on the MV3 background
key, so a single manifest can't serve both.

## Install

### Zen Browser / Firefox — temporary (works right now, gone on restart)

1. Run Azhura Download Manager at least once, so it registers the `adm://`
   link type with the OS. The add-on can't hand anything off until it does.
2. Open `about:debugging#/runtime/this-firefox`.
3. **Load Temporary Add-on…** → pick `manifest.json` in this folder.

Temporary add-ons are removed when the browser restarts. That's a Gecko rule,
not a limitation of this add-on.

### Permanent

Firefox and Zen only install *signed* add-ons permanently. Two options:

- **Sign it** (free) at [addons.mozilla.org](https://addons.mozilla.org/developers/)
  → Submit a New Add-on → **On your own** (unlisted). You get a signed `.xpi`
  to install permanently in any Firefox-based browser. The extension ID is
  already set in `manifest.json` (`adm-capture@ruhiyatna.id`).
- **Turn signing off**, which only works on Firefox Developer Edition, Nightly,
  or ESR — *not* on Firefox release, and not on Zen's default build. In
  `about:config` set `xpinstall.signatures.required` to `false`, then install
  the zipped folder as an `.xpi`.

To package for either route, zip the *contents* of this folder (not the folder
itself):

```bash
cd extension-firefox && zip -r ../adm-capture-firefox.xpi . -x '*.md'
```

## Usage

Identical to the Chrome build:

- **Right-click a download link → "Download with ADM"** — the normal path.
- **Right-click the page → "Arm ADM capture"** (or click the toolbar icon) for
  download buttons that aren't real links — JavaScript-driven buttons, or form
  submits like Google Drive's "can't scan this file" warning page. The next
  download the browser starts is canceled and redirected to ADM. It disarms
  itself after one catch.

A button that builds the file entirely in the page (a `blob:` URL with no
server-side original) has no URL to hand off. That's a hard limit.

## Gecko-specific notes

**The `adm://` hand-off goes through `launcher.html`.** Gecko refuses to load a
non-standard scheme passed straight to `tabs.create`, so the add-on opens a
packaged page that navigates itself. You'll see Firefox's *"Open Azhura Download
Manager?"* prompt — tick **Always allow** to stop it appearing every time. The
tab closes itself a couple of seconds later.

**Cookie forwarding asks for permission the first time.** Under Firefox MV3,
`host_permissions` are only a request — the browser doesn't grant them at
install. The first time you capture a gofile.io link, Firefox will ask to allow
access to that site; the add-on needs it to read the session cookie those
direct download URLs are gated behind. Decline and the capture still works, it
just may 403 on that particular host.

**Requires Firefox 115+** for `storage.session`, which backs the one-shot arm
state. Zen is well past that.
