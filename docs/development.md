# Development

How AntiShort is put together, how to test it, and how to fix it when YouTube changes its pages.

**Contents:** [Project layout](#project-layout) · [How the blocker works](#how-the-blocker-works) · [iPhone app internals](#iphone-app-internals) · [Changing the blocker](#changing-the-blocker) · [Tests](#tests) · [Manual test checklist](#manual-test-checklist) · [Icons](#icons)

---

## Project layout

```
chrome-extension/
  manifest.json      MV3 manifest: one permission (declarativeNetRequestWithHostAccess) + YouTube hosts
  rules.json         declarativeNetRequest redirects for full page loads of Shorts URLs
  page-hook.js       runs in the page ("MAIN" world): reports history.pushState/replaceState
  content.js         the blocker: redirects + hiding (shared with the iOS app; single source of truth)
  content.css        hides Shorts surfaces before they paint (shared with the iOS app)
  icons/             16/32/48/128 px
ios-app/                         the Expo project (run all npx eas / npx expo commands here)
  App.tsx, index.ts              entry points
  src/BrowserScreen.tsx          WebView, toolbar, loading/error states, link prompts
  src/navigationPolicy.ts        which URLs may load (pure functions, unit-tested)
  src/blocker/blockerScript.generated.ts   page-hook.js + content.js + content.css bundled for the WebView
  src/components/                toolbar, first-run notice, error panel
  src/firstRun.ts, src/theme.ts  first-run flag (AsyncStorage), colors
  app.json, eas.json             Expo and EAS configuration
  assets/                        app icon, splash image
scripts/
  build-ios-blocker.js   regenerates the iOS bundle from chrome-extension/
  chrome-smoke-test.js   live test against real YouTube in a throwaway headless Chrome or Brave
  generate-icons.py      regenerates all icons (needs Pillow)
docs/                    the guides
test.js                  unit and configuration tests (Node's built-in test runner)
LICENSE                  MIT
```

---

## How the blocker works

| Situation | Handled by |
|---|---|
| Full page load of `/shorts/<id>`, `/shorts` or `/@channel/shorts` (typed URL, external link, reload) | `rules.json` redirects before the page loads (Chrome DevTools shows it as *307 Internal Redirect*) |
| In-page (SPA) navigation into a Short | `page-hook.js` sees `history.pushState`/`replaceState` before it happens; `content.js` cancels it and opens `/watch?v=<id>` |
| YouTube's own navigation events | `content.js` listens to `yt-navigate-start`, `yt-navigate-finish`, `yt-page-data-updated`, `popstate`, `pageshow` |
| Plain click on a Shorts link | `content.js` intercepts it and opens the watch page. Ctrl/Cmd/middle clicks are left alone; the new tab is redirected by `rules.json` |
| Shorts shelves, tiles, chips, tabs, sidebar and mobile-nav entries | `content.css` (instant) + `content.js` (throttled `MutationObserver`, at most one scan every 250 ms, no polling) |

**What counts as a Short.** A card is hidden only when it is confirmed to be a Short, by one of these:

- a `/shorts/` link on the card's thumbnail or title;
- a Shorts-only element (`ytd-reel-shelf-renderer`, `ytm-shorts-lockup-view-model`, `[is-shorts]`);
- the `SHORTS` thumbnail badge.

Mixed shelves are hidden only when they contain Shorts and no regular videos. Shorts links inside descriptions, comments and posts are not hidden; their link target is rewritten to the watch page. When YouTube reuses a hidden card for a regular video, the card is shown again. Redirects have a short guard window, so they can't loop.

The blocker is local and self-contained. It makes no network requests, and uses no `eval` and no `innerHTML`. `test.js` enforces this.

---

## iPhone app internals

### Navigation policy (`ios-app/src/navigationPolicy.ts`)

Every main-frame navigation in the WebView goes through this policy:

| Main-frame URL | Result |
|---|---|
| `youtube.com` and any `*.youtube.com` (www, m, music, consent, accounts), `youtu.be` | allowed |
| `…/shorts/<id>`, `…/shorts`, `…/@channel/shorts` on youtube.com / www / m | cancelled, replaced by the watch page / homepage / Videos tab |
| `http://` YouTube URL | upgraded to `https://` (App Transport Security stays on) |
| `accounts.google.com` | allowed so you can sign in. The blocker never runs there, and Google may refuse sign-in in embedded browsers |
| any other website | blocked; prompt with *Stay here* / *Open in Safari* |
| other schemes (`vnd.youtube:`, `mailto:`, `data:` …) | blocked |
| sub-frames (embedded players, ads, sign-in helpers) | web content allowed, app-launching schemes blocked; nothing is injected into sub-frames |

The WebView's `originWhitelist` is `['*']` on purpose. With anything narrower, react-native-webview hands non-matching URLs straight to `Linking.openURL`, which would open other apps on its own. With `['*']`, every URL goes through the policy above.

### How the blocker gets into the page

The blocker (`page-hook.js` + `content.js` + `content.css`, bundled into `src/blocker/blockerScript.generated.ts`) is passed as `injectedJavaScriptBeforeContentLoaded` with `injectedJavaScriptBeforeContentLoadedForMainFrameOnly`. In react-native-webview 14 on iOS, that is a `WKUserScript` injected **at document start**, before YouTube's own scripts, in the main frame only.

WebKit has no per-site matching for these scripts, so the script is attached to every main-frame document. **Its first statement checks the hostname and returns immediately unless the page is `youtube.com`, `www.youtube.com` or `m.youtube.com`.** With the navigation policy, the only other main-frame pages possible are other YouTube subdomains and Google sign-in, and the script does nothing there. No JavaScript bridge (`onMessage`) is exposed to web pages.

### WebView and app settings

- **JavaScript** is enabled because YouTube needs it.
- **TLS** checks are untouched. **App Transport Security** is strict: `app.json` sets `NSAppTransportSecurity` to `{ NSAllowsArbitraryLoads: false }` with no exceptions.
- **Camera and microphone** requests from pages are denied (`mediaCapturePermissionGrantType="deny"`). The app declares no device permissions (no `…UsageDescription` keys) and no entitlements.
- **Link previews** are off, so long-press previews can't load pages outside the policy.
- **Inline playback** is on, the **user agent** is not changed, and **web inspection** is enabled only in development builds.

---

## Changing the blocker

`chrome-extension/content.js`, `content.css` and `page-hook.js` are the **only sources** of the blocker. The iOS app gets a generated copy. After changing any of them:

1. Regenerate the iOS bundle (from the repository root):

   ```bash
   node scripts/build-ios-blocker.js
   ```

   `node scripts/build-ios-blocker.js --check` only reports whether the bundle is current. `test.js` fails if it isn't.
2. Run the unit tests and the live smoke test (below).
3. Reload the extension on the extensions page. For the app, build it again ([build-ios.md](build-ios.md#7-rebuild-and-update)).

**When YouTube changes its pages:** the element selectors are the constants `CARDS`, `SHORTS_SHELVES`, `SHORTS_TILES`, `SHORTS_BADGES`, `MIXED_SHELVES`, `NAV_ENTRIES` and `TEXT_CONTAINERS` in `content.js`. `content.css` holds the selectors that hide things before they paint. Run the smoke test to see which pages leak Shorts. Inspect the page in DevTools, adjust the selectors, then follow the steps above. Redirects in `rules.json` and the URL checks don't depend on the page structure.

---

## Tests

### Unit and configuration tests

From the repository root (needs `npm install` in `ios-app/` first, for the TypeScript compiler and Expo's URL polyfill):

```bash
node test.js
```

It covers:

- **Redirect logic:** one table of Shorts and non-Shorts URLs is checked against all three implementations: `rules.json` (DNR regexes), `content.js`, and the app's `navigationPolicy.ts`. The app policy runs twice, with Node's `URL` and with `whatwg-url-minimum`, the `URL` implementation Expo installs on the device. The table includes `/shorts/<id>` with and without query parameters on www and m, bare `/shorts`, `/watch?v=<id>` (must stay unchanged), channel Shorts tabs, and look-alike hosts.
- **App navigation policy:** allowed YouTube hosts, rejected non-YouTube sites, blocked app schemes, sub-frame handling, pasted links.
- **Blocker runtime** in a simulated window: redirects on load, `pushState`/`replaceState`, `yt-navigate-start`, `popstate`, link clicks, the host check on non-YouTube pages, and document start before `<html>` exists.
- **Configuration:**
  - `manifest.json`: MV3, minimal permissions, files exist, MAIN-world hook.
  - `rules.json`: ids, regex/RE2 compatibility, group references.
  - `app.json`: identity, EAS project link format, no permission strings, strict ATS, 1024 px opaque icon.
  - No stray EAS config at the repository root.
  - `eas.json`: internal-distribution preview profile.
  - Dependency versions against Expo's `bundledNativeModules.json`.
  - The WebView's security props.
  - The generated iOS bundle matches the extension sources.

More checks for the app, run from `ios-app/`:

```bash
npx tsc --noEmit
```

```bash
npx expo install --check
```

```bash
npx expo-doctor
```

```bash
npx expo export --platform ios --output-dir ../dist-check
```

The last one bundles the app with Metro into Hermes bytecode, which catches bundling errors without a cloud build. `dist-check/` is git-ignored; delete it afterwards.

### Live smoke test (real YouTube)

```bash
node scripts/chrome-smoke-test.js --brave
```

Drop `--brave` to use Google Chrome. For another Chromium build, set `CHROME_PATH` to its executable.

The test:

- starts a throwaway headless browser (your own profile is never touched), loads `chrome-extension/` unpacked, and checks real pages: home, search, a watch page, a channel's Shorts tab, direct and bare `/shorts` URLs (including that the DNR rule fired), an SPA `pushState` into a Short, a click on a Shorts link, and the mobile layout;
- then runs the **iOS bundle** without the extension, injected at document start with iPhone emulation, to approximate the app's WebView;
- counts Shorts that are still visible and regular videos the blocker hid; both should be 0;
- clicks *Reject all* if YouTube shows its cookie page.

Results depend on what YouTube serves at the moment, and a page without Shorts is reported as "not exercised". This runs Chromium, not WebKit and not an iPhone.

---

## Manual test checklist

Use a search that reliably returns Shorts, for example **funny cats**. *Expected* applies to both unless noted.

| # | Test | Extension (Chrome or Brave) | iOS app | Expected |
|---|---|---|---|---|
| 1 | **YouTube homepage** | Open youtube.com | Launch app / Home | No Shorts shelf or tiles; the sidebar/mini-sidebar (desktop) and bottom bar (app) have no Shorts entry. Regular videos show |
| 2 | **Search results with Shorts** | Search "funny cats" | Same in the app | No Shorts shelf, grid or Shorts results; no "Shorts" filter chip; regular results show |
| 3 | **Subscriptions page** | Sign in, open Subscriptions | Sign in (if Google allows it in the WebView), open Subscriptions | No Shorts section or Shorts tiles; regular uploads show |
| 4 | **Channel Shorts tab** | Open a channel, e.g. youtube.com/@YouTube | Same | No "Shorts" tab. Opening `/@YouTube/shorts` directly lands on `/@YouTube/videos` |
| 5 | **Watch-page recommendations** | Open any video | Same | No Shorts shelf or Shorts items next to/below the video |
| 6 | **Direct `/shorts/<id>` URL** | Paste `https://www.youtube.com/shorts/<id>` into the address bar | *More → Open YouTube link…*, paste a Shorts link | Lands on `/watch?v=<id>` with the regular player. Bare `/shorts` lands on the homepage |
| 7 | **In-page (SPA) navigation into a Short** | Click a Shorts link in a description or comment. Or, in the DevTools console on youtube.com: `history.pushState({}, '', '/shorts/<id>')` | Tap a Shorts link in a video description or comment | Goes to `/watch?v=<id>`; the Shorts player never opens; Back returns to the previous page |
| 8 | **Mobile layout** | DevTools → device toolbar (iPhone), open m.youtube.com, repeat 1, 2, 6 | The app always uses the mobile site | Bottom bar has no Shorts; no Shorts shelves |
| 9 | **Back / Forward / Reload** | Browser buttons after 2 to 3 navigations | Toolbar buttons and edge swipes | Back/Forward move through history (disabled at the ends in the app); Reload reloads with the spinner; Home opens m.youtube.com |
| 10 | **Non-YouTube links** | Click an external link in a description | Same | Browser: YouTube's own "leaving YouTube" page, then the site opens normally (the extension only acts on YouTube). App: prompt naming the site, with *Stay here* / *Open in Safari*; nothing opens on its own |
| 11 | **App only: first-run notice** | n/a | First launch; later via *More → About Shorts filtering* | Explains that filtering works only inside this app |
| 12 | **App only: errors** | n/a | Airplane mode, then Reload | Error panel with the reason and *Try again*; the page is not shown as loaded |

---

## Icons

The icons are original artwork (a portrait video frame under a "no" sign), drawn by a script:

```bash
python scripts/generate-icons.py
```

This needs Pillow (`pip install pillow`) and writes `chrome-extension/icons/icon{16,32,48,128}.png`, `ios-app/assets/icon.png` (1024 px, no alpha) and `ios-app/assets/splash-icon.png`. The PNGs are committed, so you only need it if you change the artwork.
