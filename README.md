# AntiShort

**Block YouTube Shorts in your desktop browser and on your iPhone.**

AntiShort comes in two parts that share one blocker:

| Part | What it is | Where it blocks Shorts |
|---|---|---|
| **Browser extension** ([`chrome-extension/`](chrome-extension)) | Manifest V3 extension, loaded unpacked | YouTube in desktop **Brave** and **Google Chrome** (other Chromium browsers should work but are untested) |
| **iPhone app** ([`ios-app/`](ios-app)) | Expo / React Native app with its own built-in YouTube browser | YouTube opened **inside the AntiShort app** |

Both parts:

- hide Shorts shelves, Shorts tiles, the Shorts tab on channels, the "Shorts" filter chip and the Shorts entries in the sidebar and bottom bar;
- open Shorts links in the normal video player: `/shorts/<id>` becomes `/watch?v=<id>`;
- send bare `/shorts` to the homepage and a channel's `/shorts` tab to its `/videos` tab;
- leave regular videos alone.

> [!IMPORTANT]
> **The iPhone app only filters YouTube inside the app itself.** It cannot change the official YouTube app, Safari, other browsers, or YouTube links you tap in other apps (Messages, Mail and so on); those still show Shorts. iOS gives apps no way to change other apps. AntiShort is not a Safari extension.

---

## Quick start

### Browser extension (Brave, Chrome)

1. Get the files: `git clone https://github.com/sideswipeishacking/AntiShort.git`, or use **Code → Download ZIP** on GitHub and unzip it somewhere permanent.
2. Open `brave://extensions` (Brave) or `chrome://extensions` (Chrome).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the **`chrome-extension`** folder (the one that contains `manifest.json`).
5. Reload any YouTube tabs you already had open.

That's it: there is no button or popup, it simply works on YouTube. The full guide covers other browsers, updating, removing and troubleshooting: **[docs/browser-extension.md](docs/browser-extension.md)**.

### iPhone app

The app is not on the App Store. You build it yourself in Expo's cloud (EAS Build) and install it on your own iPhone. **No Mac is needed.**

You need a **paid Apple Developer Program membership**, a free **Expo account**, **Node.js 20+** and an **iPhone on iOS 16.4 or later**.

```bash
npm install -g eas-cli
```

```bash
git clone https://github.com/sideswipeishacking/AntiShort.git
cd AntiShort/ios-app
npm install
npx eas login
```

Then point the project at your own Expo account and bundle ID, register your iPhone, build and install. Every step is in **[docs/build-ios.md](docs/build-ios.md)**.

---

## Documentation

| Guide | What's in it |
|---|---|
| **[Browser extension](docs/browser-extension.md)** | Install in Brave, Chrome and other Chromium browsers, check it works, permissions, update, remove, troubleshooting |
| **[Build the iPhone app](docs/build-ios.md)** | Compile it yourself with EAS, install it with Developer Mode, use the app, rebuild, troubleshooting |
| **[Development](docs/development.md)** | How the blocker works, project layout, tests, live smoke test, manual test checklist, fixing it after YouTube changes |

---

## What AntiShort does not do

- It does not use YouTube APIs, does not get around sign-in, age checks or other access controls, and does not change the browser's user agent. It works on YouTube's ordinary web pages.
- If YouTube or Google restrict something inside the app's embedded browser (for example Google sign-in, or some playback features), the app shows that limitation instead of working around it.
- It does not block Shorts embedded on other websites.

## Privacy

Neither part collects, stores or sends any data, and neither contains analytics.

- **Extension:** one permission, *Read and change your data on youtube.com, www.youtube.com and m.youtube.com*. No background worker, no storage, no network requests of its own. It does nothing on any other website.
- **iPhone app:** asks for no device permissions (no camera, microphone, location, photos or tracking). The only thing it stores is whether you have dismissed the first-run notice. The blocker script is bundled in the app and is never downloaded.

YouTube itself sees your browsing as it would in any browser.

## Limitations

- **Only where it is installed.** The extension works only in the browser profile where you loaded it. The app filters only its own built-in browser (see the note at the top).
- **Embedded-browser restrictions.** Google may refuse sign-in inside the app ("This browser or app may not be secure"). Without sign-in, Subscriptions and other personal pages are unavailable. Playback quality, background audio, Picture in Picture or casting may behave differently than in Safari or the YouTube app.
- **YouTube changes its pages.** Hiding relies on YouTube's current page structure and on `/shorts/` links. A redesign can let some Shorts through until the blocker is updated. Redirects of `/shorts/` links do not depend on the page structure.
- **Label matching.** Chips, tabs and menu entries without a link are recognized by the label "Shorts". A topic chip that literally reads "Shorts" (for example about clothing) is hidden too, and UI languages that translate the word may leave such entries visible. Shorts videos themselves are still hidden by their links.

## What has been tested

- **Extension:** unit tests, plus a live smoke test against real YouTube in a throwaway headless browser profile. It passes in Brave 1.99 and Chrome 157: no Shorts left visible and no regular videos hidden on Home, search, watch, channel and mobile-layout pages; all redirects work.
- **iPhone app:** unit and configuration tests, TypeScript, `expo-doctor` and a Metro bundle. The preview build was built on EAS (Expo SDK 58) and installed on an iPhone, where Shorts are blocked. The full manual checklist has not yet been run on a device.

Details and commands: [docs/development.md](docs/development.md#tests).

## License

[MIT](LICENSE).

AntiShort is not affiliated with, endorsed by or sponsored by YouTube or Google. YouTube and YouTube Shorts are trademarks of Google LLC.
