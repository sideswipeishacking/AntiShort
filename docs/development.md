# Development

How AntiShort is put together, how to test it, and how to fix it when YouTube changes its pages.

**Contents:** [Project layout](#project-layout) · [How the blocker works](#how-the-blocker-works) · [App internals](#app-internals-iphone-and-android) · [Changing the blocker](#changing-the-blocker) · [Tests](#tests) · [Manual test checklist](#manual-test-checklist) · [Icons](#icons)

---

## Project layout

```
chrome-extension/
  manifest.json      MV3 manifest: one permission (declarativeNetRequestWithHostAccess) + YouTube hosts
  rules.json         declarativeNetRequest redirects for full page loads of Shorts URLs
  page-hook.js       runs in the page ("MAIN" world): reports history.pushState/replaceState
  content.js         the blocker: redirects + hiding (shared with the phone app; single source of truth)
  content.css        hides Shorts surfaces before they paint (shared with the phone app)
  icons/             16/32/48/128 px
mobile-app/                      the Expo project for iPhone and Android (run all npx eas / npx expo commands here)
  App.tsx, index.ts              entry points
  src/BrowserScreen.tsx          WebView, toolbar, loading/error states, link prompts
  src/navigationPolicy.ts        which URLs may load (pure functions, unit-tested)
  src/blocker/blockerScript.generated.ts   page-hook.js + content.js + content.css bundled for the WebView
  src/components/                toolbar, first-run notice, error panel, link dialog (Android)
  src/firstRun.ts, src/theme.ts  first-run flag (AsyncStorage), colors
  app.json, eas.json             Expo and EAS configuration
  assets/                        app icon, Android adaptive icon layers, splash image
scripts/
  build-app-blocker.js   regenerates the app bundle from chrome-extension/
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

## App internals (iPhone and Android)

`mobile-app/` is one Expo project for both platforms. The code is shared; the few platform differences are marked with `IS_ANDROID` in `src/BrowserScreen.tsx`.

### Navigation policy (`mobile-app/src/navigationPolicy.ts`)

Every main-frame navigation in the WebView goes through this policy:

| Main-frame URL | Result |
|---|---|
| `youtube.com` and any `*.youtube.com` (www, m, music, consent, accounts), `youtu.be` | allowed |
| `…/shorts/<id>`, `…/shorts`, `…/@channel/shorts` on youtube.com / www / m | cancelled, replaced by the watch page / homepage / Videos tab |
| `http://` YouTube URL | upgraded to `https://` (App Transport Security / Android's cleartext block stay on) |
| `accounts.google.com` | allowed so you can sign in. The blocker never runs there, and Google may refuse sign-in in embedded browsers |
| any other website | blocked; prompt with *Stay here* / *Open in Safari* (iPhone) or *Open in browser* (Android) |
| other schemes (`vnd.youtube:`, `intent:`, `mailto:`, `data:` …) | blocked |
| sub-frames (embedded players, ads, sign-in helpers) | web content allowed, app-launching schemes blocked; nothing is injected into sub-frames |

The WebView's `originWhitelist` is `['*']` on purpose. With anything narrower, react-native-webview hands non-matching URLs straight to `Linking.openURL`, which would open other apps on its own. With `['*']`, every URL goes through the policy above.

**Android differences** (both found while testing in the emulator):

- react-native-webview on Android does not say which frame a navigation belongs to: `isTopFrame` is missing at runtime, although its TypeScript type is `boolean`. Android only asks about main-frame loads and about sub-frame loads with non-http(s) schemes, so the policy treats an unknown frame as the top frame. Content the page made itself (`about:`, `blob:`, `data:`) passes without a prompt. Without this, any website could load in the app, because a missing `isTopFrame` would read as "sub-frame".
- If the app's JavaScript takes longer than 250 ms to answer `onShouldStartLoadWithRequest`, react-native-webview lets the navigation through. As a safety net, `onLoadStart` re-checks every main-frame load on Android, stops a load the policy does not allow, and goes back.

### How the blocker gets into the page

The blocker (`page-hook.js` + `content.js` + `content.css`, bundled into `src/blocker/blockerScript.generated.ts`) is passed as `injectedJavaScriptBeforeContentLoaded` with `injectedJavaScriptBeforeContentLoadedForMainFrameOnly`.

- **iPhone:** react-native-webview 14 makes it a `WKUserScript` injected **at document start**, before YouTube's own scripts, in the main frame only.
- **Android:** the library evaluates it in the main frame when the page starts loading (`onPageStarted`). In the emulator the blocker was active while the document was still `loading`, about half a second after the navigation started and before YouTube rendered its results. To be safe, Android also passes the same script as `injectedJavaScript`, which runs again when the page has loaded; the script returns immediately if it is already running in that document.

Neither platform matches these scripts per site, so the script is attached to every main-frame document. **Its first statement checks the hostname and returns immediately unless the page is `youtube.com`, `www.youtube.com` or `m.youtube.com`.** With the navigation policy, the only other main-frame pages possible are other YouTube subdomains and Google sign-in, and the script does nothing there. No JavaScript bridge (`onMessage`) is exposed to web pages.

### WebView and app settings

- **JavaScript** is enabled because YouTube needs it. The **user agent** is not changed.
- **TLS** checks are untouched. **iPhone:** App Transport Security is strict (`NSAppTransportSecurity: { NSAllowsArbitraryLoads: false }`, no exceptions). **Android:** cleartext traffic stays off (Android's default) and `mixedContentMode="never"`.
- **Permissions:** pages' camera and microphone requests are denied. The iPhone app declares no `…UsageDescription` keys and no entitlements. The Android app sets `android.permissions: []` and lists camera, microphone, location, storage, overlay and vibration in `android.blockedPermissions`, which removes them from the merged manifest.
- **Android backups** are off (`allowBackup: false`), so cookies aren't copied into device backups.
- **Android Back button:** goes back in the page history (`BackHandler`); at the start of the history it leaves the app.
- **Android menus:** `ActionSheetIOS` and `Alert.prompt` are iOS-only, so Android uses an alert with three buttons and its own link dialog (`src/components/LinkPrompt.tsx`).
- **Android errors:** after a failed load, Android shows its own error page and reports it as a new load. The app ignores that report so its error panel stays, and *Try again* loads the URL afresh. If the page's process dies (`onRenderProcessGone`), the WebView is replaced.
- **iPhone only:** link previews are off, so long-press previews can't load pages outside the policy; edge swipes go back and forward.
- **Inline playback** is on, **fullscreen video** is allowed on Android (`allowsFullscreenVideo`), and **web inspection** is enabled only in development builds.

---

## Changing the blocker

`chrome-extension/content.js`, `content.css` and `page-hook.js` are the **only sources** of the blocker. The iPhone/Android app gets a generated copy. After changing any of them:

1. Regenerate the app bundle (from the repository root):

   ```bash
   node scripts/build-app-blocker.js
   ```

   `node scripts/build-app-blocker.js --check` only reports whether the bundle is current. `test.js` fails if it isn't.
2. Run the unit tests and the live smoke test (below).
3. Reload the extension on the extensions page. For the app, build it again ([iPhone](build-ios.md#7-rebuild-and-update), [Android](build-android.md#option-2-build-it-yourself-with-eas)).

**When YouTube changes its pages:** the element selectors are the constants `CARDS`, `SHORTS_SHELVES`, `SHORTS_TILES`, `SHORTS_BADGES`, `MIXED_SHELVES`, `NAV_ENTRIES` and `TEXT_CONTAINERS` in `content.js`. `content.css` holds the selectors that hide things before they paint. Run the smoke test to see which pages leak Shorts. Inspect the page in DevTools, adjust the selectors, then follow the steps above. Redirects in `rules.json` and the URL checks don't depend on the page structure.

---

## Tests

### Unit and configuration tests

From the repository root (needs `npm install` in `mobile-app/` first, for the TypeScript compiler and Expo's URL polyfill):

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
  - The generated app bundle matches the extension sources.
  - Android: app identity, no runtime permissions, no backups, no cleartext, adaptive icons, APK build type, back button, re-injection and renderer-loss handling, and that iOS-only APIs sit behind an Android branch.

More checks for the app, run from `mobile-app/`:

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
- then runs the **app bundle** without the extension, injected at document start with iPhone emulation, to approximate the app's WebView;
- counts Shorts that are still visible and regular videos the blocker hid; both should be 0;
- clicks *Reject all* if YouTube shows its cookie page.

Results depend on what YouTube serves at the moment, and a page without Shorts is reported as "not exercised". This runs Chromium, not WebKit and not an iPhone.

### Android emulator testing

The Android app was tested on an Android Studio emulator (Pixel 9 Pro profile, Android 17 / API 37, Android System WebView 145), first as a development build in Expo Go, then as the release APK from EAS.

Run the development build on a running emulator (from `mobile-app/`):

```bash
npx expo start --android
```

This installs Expo Go on the emulator (about 230 MB, so the emulator needs free storage) and opens the app. In development builds the WebView can be inspected: open `chrome://inspect` (or `brave://inspect`) on the computer, and the app's YouTube page appears under the emulator. In the DevTools console, `window.__antishortActive` is `true` when the blocker runs, and `document.querySelectorAll('[data-antishort-hidden]').length` counts what it hid. Release builds can't be inspected.

Checked in the emulator, all passing:

- search results ("funny cats"): 220 Shorts links and 44 Shorts tiles on the page, none visible; all 87 regular videos visible;
- home, watch and channel pages: no visible Shorts; the bottom-bar and channel Shorts tabs hidden;
- `/shorts/<id>`, `/shorts`, `/@channel/shorts` and an in-page `pushState` to a Short end on the watch page, the homepage and the Videos tab;
- a link to another website (also with `target="_blank"`) shows the prompt and stays on YouTube; an `intent://` link shows "Link not opened";
- Back button, *More* menu, *Open YouTube link…* with a Shorts link, About notice (closes with Back);
- airplane mode: the app's error panel, then *Try again* reloads; a crashed page process: the app's panel, then *Try again* replaces the WebView.

---

## Manual test checklist

Use a search that reliably returns Shorts, for example **funny cats**. *Expected* applies to both unless noted.

| # | Test | Extension (Chrome or Brave) | App (iPhone / Android) | Expected |
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
| 10 | **Non-YouTube links** | Click an external link in a description | Same | Browser: YouTube's own "leaving YouTube" page, then the site opens normally (the extension only acts on YouTube). App: prompt naming the site, with *Stay here* / *Open in Safari* (Android: *Open in browser*); nothing opens on its own |
| 11 | **App only: first-run notice** | n/a | First launch; later via *More → About Shorts filtering* (Android: *More → About*) | Explains that filtering works only inside this app |
| 12 | **App only: errors** | n/a | Airplane mode, then Reload | Error panel with the reason and *Try again*; the page is not shown as loaded |
| 13 | **Android only: Back button** | n/a | Open 2 to 3 pages, press Back (button or gesture) | Goes back one page each time; on the first page the app closes |
| 14 | **App only: links to other apps** | n/a | Tap an "Open app" / `intent://` link, if YouTube shows one | "Link not opened" message; no other app opens |

---

## Icons

The icons are original artwork (a portrait video frame under a "no" sign), drawn by a script:

```bash
python scripts/generate-icons.py
```

This needs Pillow (`pip install pillow`) and writes `chrome-extension/icons/icon{16,32,48,128}.png`, `mobile-app/assets/icon.png` (1024 px, no alpha), `mobile-app/assets/splash-icon.png`, and the Android adaptive icon layers `adaptive-icon.png` (symbol inside the safe zone) and `adaptive-icon-monochrome.png` (themed icon). The PNGs are committed, so you only need it if you change the artwork.
