# AntiShort

**Block YouTube Shorts in your desktop browser, on Android and on iPhone.**

AntiShort comes in three parts that share one blocker:

| Part | What it is | Where it blocks Shorts |
|---|---|---|
| **Browser extension** ([`chrome-extension/`](chrome-extension)) | Manifest V3 extension, loaded unpacked | YouTube in desktop **Brave** and **Google Chrome** (other Chromium browsers should work but are untested) |
| **Android app** ([`mobile-app/`](mobile-app)) | Expo / React Native app with its own built-in YouTube browser. **[Download the APK](https://github.com/sideswipeishacking/AntiShort/releases/latest)** | YouTube opened **inside the AntiShort app** |
| **iPhone app** ([`mobile-app/`](mobile-app)) | The same app, built for iOS. Build it yourself (Apple requires a developer account) | YouTube opened **inside the AntiShort app** |

All parts:

- hide Shorts shelves, Shorts tiles, the Shorts tab on channels, the "Shorts" filter chip and the Shorts entries in the sidebar and bottom bar;
- open Shorts links in the normal video player: `/shorts/<id>` becomes `/watch?v=<id>`;
- send bare `/shorts` to the homepage and a channel's `/shorts` tab to its `/videos` tab;
- leave regular videos alone.

> [!IMPORTANT]
> **The phone apps only filter YouTube inside the app itself.** They cannot change the official YouTube app, Safari, Chrome or other browsers, or YouTube links you tap in other apps (messages, mail and so on); those still show Shorts. Neither iOS nor Android lets an app change other apps. AntiShort is not a Safari extension.

---

## Quick start

### Browser extension (Brave, Chrome)

1. Get the files: `git clone https://github.com/sideswipeishacking/AntiShort.git`, or use **Code → Download ZIP** on GitHub and unzip it somewhere permanent.
2. Open `brave://extensions` (Brave) or `chrome://extensions` (Chrome).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the **`chrome-extension`** folder (the one that contains `manifest.json`).
5. Reload any YouTube tabs you already had open.

That's it: there is no button or popup, it simply works on YouTube. The full guide covers other browsers, updating, removing and troubleshooting: **[docs/browser-extension.md](docs/browser-extension.md)**.

### Android app

1. On your Android phone (Android 7.0 or newer), download **[AntiShort-android.apk](https://github.com/sideswipeishacking/AntiShort/releases/latest/download/AntiShort-android.apk)** from the latest [release](https://github.com/sideswipeishacking/AntiShort/releases/latest).
2. Open it and allow your browser or Files app to install it when Android asks.
3. Open **AntiShort**.

It isn't on the Play Store, so Android treats it as an "unknown app"; Play Protect may ask you to confirm. The full guide covers checking the download, updating, building your own APK with Expo's cloud, trying it in the Android Studio emulator, and troubleshooting: **[docs/build-android.md](docs/build-android.md)**.

### iPhone app

Apple only lets you install apps outside the App Store on devices registered to a paid developer account, so there's no download: you build it yourself in Expo's cloud (EAS Build) and install it on your own iPhone. **No Mac is needed.**

You need a **paid Apple Developer Program membership**, a free **Expo account**, **Node.js 20+** and an **iPhone on iOS 16.4 or later**.

```bash
npm install -g eas-cli
```

```bash
git clone https://github.com/sideswipeishacking/AntiShort.git
cd AntiShort/mobile-app
npm install
npx eas login
```

Then point the project at your own Expo account and bundle ID, register your iPhone, build and install. Every step is in **[docs/build-ios.md](docs/build-ios.md)**.

---

## Documentation

| Guide | What's in it |
|---|---|
| **[Browser extension](docs/browser-extension.md)** | Install in Brave, Chrome and other Chromium browsers, check it works, permissions, update, remove, troubleshooting |
| **[Android app](docs/build-android.md)** | Install the APK, build your own with EAS (or locally), test in the Android Studio emulator, use the app, permissions, troubleshooting |
| **[iPhone app](docs/build-ios.md)** | Compile it yourself with EAS, install it with Developer Mode, use the app, rebuild, troubleshooting |
| **[Development](docs/development.md)** | How the blocker works, app internals on iPhone and Android, project layout, tests, live smoke test, emulator testing, manual checklist, fixing it after YouTube changes |

---

## What AntiShort does not do

- It does not use YouTube APIs, does not get around sign-in, age checks or other access controls, and does not change the browser's user agent. It works on YouTube's ordinary web pages.
- If YouTube or Google restrict something inside the apps' embedded browser (for example Google sign-in, or some playback features), the app shows that limitation instead of working around it.
- It does not block Shorts embedded on other websites.

## Privacy

None of the parts collects, stores or sends any data, and none contains analytics.

- **Extension:** one permission, *Read and change your data on youtube.com, www.youtube.com and m.youtube.com*. No background worker, no storage, no network requests of its own. It does nothing on any other website.
- **Phone apps:** no runtime permissions (no camera, microphone, location, photos, storage, contacts or tracking); on Android the only permission that matters is network access, and app backups are off. The only thing the apps store is whether you have dismissed the first-run notice. The blocker script is bundled in the app and never downloaded.

YouTube itself sees your browsing as it would in any browser.

## Limitations

- **Only where it is installed.** The extension works only in the browser profile where you loaded it. The apps filter only their own built-in browser (see the note at the top).
- **Embedded-browser restrictions.** Google may refuse sign-in inside the apps ("This browser or app may not be secure"). Without sign-in, Subscriptions and other personal pages are unavailable. Playback quality, background audio, Picture in Picture or casting may behave differently than in the official YouTube app.
- **YouTube changes its pages.** Hiding relies on YouTube's current page structure and on `/shorts/` links. A redesign can let some Shorts through until the blocker is updated. Redirects of `/shorts/` links do not depend on the page structure.
- **Label matching.** Chips, tabs and menu entries without a link are recognized by the label "Shorts". A topic chip that literally reads "Shorts" (for example about clothing) is hidden too, and UI languages that translate the word may leave such entries visible. Shorts videos themselves are still hidden by their links.

## What has been tested

- **Extension:** unit tests, plus a live smoke test against real YouTube in a throwaway headless browser profile. It passes in Brave 1.99 and Chrome 157: no Shorts left visible and no regular videos hidden on Home, search, watch, channel and mobile-layout pages; all redirects work.
- **Android app:** unit and configuration tests, TypeScript, `expo-doctor`, and the app itself on an Android Studio emulator (Android 17, API 37). Tested there: the development build, inspected inside its WebView (search results: 220 Shorts links and 44 Shorts tiles on the page, none visible; all regular videos visible), and the released APK from EAS (search, Shorts links, link prompts, Back button, fullscreen video, offline error panel). Not yet tried on a physical Android phone.
- **iPhone app:** the same unit tests. The iOS preview build 1.0.0 (1) was built on EAS and installed on an iPhone, where Shorts are blocked. The Android work since then leaves the iOS code paths unchanged but hasn't been rebuilt for iPhone yet, and the full manual checklist has not been run on an iPhone.

Details and commands: [docs/development.md](docs/development.md#tests).

## License

[MIT](LICENSE).

AntiShort is not affiliated with, endorsed by or sponsored by YouTube or Google. YouTube and YouTube Shorts are trademarks of Google LLC.
