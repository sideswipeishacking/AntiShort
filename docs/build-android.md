# Android app: install it, or build it yourself

The Android app is the same Expo project as the iPhone app ([`mobile-app/`](../mobile-app)): a YouTube browser that hides Shorts and opens Shorts links in the regular player. You can install the ready-made APK from this repository's Releases page, or build your own copy in Expo's cloud.

> [!IMPORTANT]
> The app filters YouTube **only inside its own built-in browser**. The official YouTube app, Chrome and other browsers, and YouTube links opened from other apps keep showing Shorts; Android gives apps no way to change them.

**Contents:** [Option 1: Download the APK](#option-1-download-the-apk) · [Option 2: Build it yourself with EAS](#option-2-build-it-yourself-with-eas) · [Option 3: Build locally with Android Studio](#option-3-build-locally-with-android-studio-not-tested) · [Try it in the Android Studio emulator](#try-it-in-the-android-studio-emulator) · [Using the app](#using-the-app) · [Picture-in-picture](#picture-in-picture) · [Permissions and privacy](#permissions-and-privacy) · [Troubleshooting](#troubleshooting)

---

## Option 1: Download the APK

**Direct download:** <https://github.com/sideswipeishacking/AntiShort/releases/latest/download/AntiShort-android.apk>
(all versions: [Releases](https://github.com/sideswipeishacking/AntiShort/releases))

The APK is built by EAS Build from this repository and signed with the project's own key. It runs on **Android 7.0 or newer**, is about **68 MB** (one APK for all phone processors), and each release lists its SHA-256 checksum and signing-certificate fingerprint.

1. **On your Android phone**, open the direct download link above (or the Releases page) and download **`AntiShort-android.apk`**.
2. Open the downloaded file, from the browser's download notification or from **Files → Downloads**.
3. Android asks whether that app (your browser or Files) may install unknown apps. Tap **Settings**, turn on **Allow from this source**, go back and tap **Install**.
4. Google Play Protect may warn about an app it hasn't seen before, because AntiShort is not from the Play Store. The wording varies by phone (for example *More details → Install anyway*). Only continue for an APK you downloaded from this repository's Releases page.
5. Open **AntiShort**. The first launch shows a short notice explaining that filtering applies only inside the app.

**Check the download (optional).** Each release lists the APK's SHA-256 checksum. Compare it with yours:

- Windows: `certutil -hashfile AntiShort-android.apk SHA256`
- macOS / Linux: `shasum -a 256 AntiShort-android.apk`

**Update:** download the newer APK from Releases and install it over the old one. Your app data (for example a YouTube sign-in) is kept, because every release is signed with the same key.

**Uninstall:** long-press the AntiShort icon → **Uninstall** (or *Settings → Apps → AntiShort → Uninstall*).

---

## Option 2: Build it yourself with EAS

Builds a signed APK in Expo's cloud. **No Android Studio, no Mac and no Google Play account needed.**

### What you need

| | Notes |
|---|---|
| **Expo account** | Free: <https://expo.dev/signup>. The free plan includes a limited number of cloud builds per month. |
| **Computer** | Windows, macOS or Linux with **Node.js 20 or newer** (current LTS recommended), npm and **git**. |
| **EAS CLI** | `npm install -g eas-cli` (tested with 27.10.0). All commands below are `npx eas …`. |

### Steps

**Run every `npx eas` command inside `mobile-app/`.** From the repository root, EAS finds the wrong `package.json`, writes stray `app.json`/`eas.json` files there and fails with *Cannot find 'expo-modules-autolinking'*.

1. **Get the code and install dependencies:**

   ```bash
   git clone https://github.com/sideswipeishacking/AntiShort.git
   cd AntiShort/mobile-app
   npm install
   ```

2. **Make the project yours.** `mobile-app/app.json` points at the maintainer's Expo project. You can't build into someone else's project, so edit `mobile-app/app.json`:

   | Field | Change |
   |---|---|
   | `expo.owner` | **Delete** this line. |
   | `expo.extra` | **Delete** the whole `"extra": { … }` block. `eas init` adds your own project ID. |
   | `expo.android.package` | Your own ID, for example **`com.yourname.antishort`**. Letters, digits and underscores; every part starts with a letter. |
   | `expo.ios.bundleIdentifier` | The same ID, if you also build for iPhone ([build-ios.md](build-ios.md)). |

3. **Log in and create your EAS project:**

   ```bash
   npx eas login
   ```

   ```bash
   npx eas init
   ```

4. **Build:**

   ```bash
   npx eas build --platform android --profile preview
   ```

   The `preview` profile in `eas.json` makes an **APK** (`"buildType": "apk"`) that installs directly on any phone. The first build asks **"Generate a new Android Keystore?"**: answer **Y**. EAS creates the signing key and stores it with your project; every later build reuses it, which lets new versions install over old ones. (With `--non-interactive`, EAS generates the key without asking.)

   The upload is under 1 MB. The build runs on Expo's servers and usually takes 10 to 20 minutes, depending on the queue. When it finishes, the CLI prints a **link and a QR code** for the APK; the build is also listed at <https://expo.dev> → your project → **Builds**.

5. **Install:** open the link (or scan the QR code) on your phone, download the APK and install it as in [Option 1](#option-1-download-the-apk), steps 2 to 5. From a computer you can also use `adb install` ([below](#try-it-in-the-android-studio-emulator)).

**Keep your key.** If you publish your own builds, keep a backup of the keystore: `npx eas credentials -p android` (inside `mobile-app/`) shows it and offers to download it. Without that key, future versions can't be installed over existing ones.

**New version:** run `git pull` and `npm install`, raise `expo.android.versionCode` (and optionally `expo.version`) in `app.json`, and build again. `eas.json` uses `appVersionSource: "local"`, so these numbers come from `app.json`.

---

## Option 3: Build locally with Android Studio (not tested)

If you'd rather not use Expo's cloud, Expo can build on your own computer with the Android SDK that Android Studio installs:

```bash
cd mobile-app
npm install
npx expo run:android --variant release
```

This generates the native `android/` folder (git-ignored), builds with Gradle and installs the app on a connected phone or a running emulator. It needs Android Studio's SDK and JDK, several GB of disk space for Gradle's downloads, and a set `ANDROID_HOME`. Expo's template signs such local release builds with a debug key, which is fine for your own phone but not for sharing. This path has **not been tested** for AntiShort; the tested path is Option 2.

---

## Try it in the Android Studio emulator

1. In Android Studio, open **Device Manager** and start a virtual device. A recent system image (API 35 or newer, *Google APIs* or *Google Play*) works. Give it at least **2 GB of free internal storage**: an emulator whose storage is full refuses installs with `INSTALL_FAILED_INSUFFICIENT_STORAGE`.
2. Install the APK, either by **dragging the APK file onto the emulator window**, or with adb:

   ```bash
   adb install AntiShort-android.apk
   ```

   `adb` is in `platform-tools` of the Android SDK (on Windows: `%LOCALAPPDATA%\Android\Sdk\platform-tools`).
3. Open **AntiShort** from the emulator's app drawer.

The app was tested this way on an emulated Pixel 9 Pro with Android 17 (API 37). Details are in [development.md](development.md#android-emulator-testing).

---

## Using the app

- **Toolbar:** Back, Forward, Reload (shows a spinner while a page loads), Home, **PiP** (picture-in-picture, see below) and **More**, which has *About* and *Open YouTube link…*. A thin progress line at the top shows page loading.
- **Android Back button or gesture:** goes back in the page history. On the first page it leaves the app as usual.
- **Open YouTube link…:** paste a link someone sent you. A Shorts link opens in the regular player. A non-YouTube link gets the external-link prompt instead of opening.
- **Links to other websites** never open automatically. You get a prompt naming the site, with **Stay here** or **Open in browser** (your default browser, where Shorts are not filtered).
- **Links that would open other apps** (for example the YouTube app's `intent://` and `vnd.youtube://` links) are blocked with a short message.
- **Errors:** if a page fails to load (for example offline), a panel says so, with the reason, **Try again** and **YouTube home**. If Android ends the page's process, a panel offers to reload it. A page is never shown as loaded unless it loaded.
- **Fullscreen video:** YouTube's fullscreen button works.
- **Sign-in:** Google may refuse sign-in inside embedded browsers ("This browser or app may not be secure"). The app doesn't work around that. Without sign-in, Subscriptions and other personal pages are unavailable.

---

## Picture-in-picture

Keep a video playing in a small floating window while you use other apps.

- **Automatically:** while a video is playing, go to the home screen (Home button or swipe up). AntiShort shrinks into a small window and the video keeps playing. A paused video, or a page that isn't a video, doesn't open the window.
- **By hand:** on a video page, tap **PiP** in the toolbar.
- **From YouTube's fullscreen:** Home works the same way. AntiShort leaves YouTube's fullscreen as the window opens, and the video carries on.
- **In the window:** drag it anywhere, or off the edge of the screen to tuck it away. Tap it once for its controls: **expand** (back to the full app), **close** (the video stops) and Android's picture-in-picture settings. There is no play/pause button in the window; expand the app to pause.
- While the window is open, the app shows only the video player; the rest comes back when you expand it.
- **Turn it off:** *Settings → Apps → Special app access → Picture-in-picture → AntiShort* (the path varies by phone). With it off, the PiP button tells you so, and Home leaves the app as usual.

Picture-in-picture needs Android 8.0 or newer, and phones without the feature (some low-memory ones) don't show the PiP button. It doesn't change what YouTube allows: the app doesn't force background playback, and if YouTube pauses a video, it stays paused.

---

## Permissions and privacy

- Picture-in-picture needs **no permission**; it's a per-app setting you control (above).
- The app requests **no runtime permissions**: no camera, microphone, location, storage, contacts or notifications. Its manifest asks only for **full network access** (`INTERNET`), plus an internal permission the Android libraries declare for the app itself. (On Android 17, the system also lists *local network access* for apps built for earlier Android versions; AntiShort's manifest doesn't request it.)
- Camera, microphone, location, storage, overlay and vibration permissions are explicitly removed from the app's manifest (`android.blockedPermissions` in `app.json`). If a web page asks for camera or microphone, the request is refused.
- **Cleartext HTTP is off**, and HTTPS pages may not load HTTP content (`mixedContentMode="never"`).
- **Backups are off** (`allowBackup: false`), so the app's data, including YouTube cookies, isn't copied into device backups.
- The app collects and sends nothing itself. The only thing it stores is whether you have dismissed the first-run notice. The blocker script is bundled in the app and never downloaded.

---

## Troubleshooting

| Problem | What to do |
|---|---|
| *App not installed*, or *package conflicts with an existing package* | An AntiShort signed with a different key is already installed (for example your own build and the release APK). Uninstall the existing one first. |
| *For your security, your phone is not allowed to install unknown apps from this source* | Allow installing unknown apps for the app you're installing from (step 3 of [Option 1](#option-1-download-the-apk)). |
| *There was a problem parsing the package* | The download is incomplete (download it again), or the phone's Android version is older than the app supports. |
| `INSTALL_FAILED_INSUFFICIENT_STORAGE` on an emulator | The emulator's internal storage is full. Free space on it, or edit the device in Device Manager and give it more internal storage. |
| Errors about `expo-modules-autolinking`, or `app.json`/`eas.json` appear at the repository root | You ran `npx eas` from the repository root. Delete those two files, `cd mobile-app`, and run it again. |
| A permissions error, or an unknown project, right at the start of `eas build` | `app.json` still points at another account's EAS project. Do step 2 of [Option 2](#option-2-build-it-yourself-with-eas). |
| Google says *This browser or app may not be secure* | Google restricts sign-in in embedded browsers. Expected; the app does not bypass it. |
| The video doesn't go into a small window when I leave the app | It only does so while a video is **playing** on a video page, and only if picture-in-picture is allowed for AntiShort in Android settings. Try the **PiP** button; if Android refuses, the app says so. |
| Some Shorts appear after a YouTube redesign | Update to the latest release. If it persists, open an issue with the page and a screenshot. |
