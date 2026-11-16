# Build the iPhone app yourself

AntiShort for iPhone is not on the App Store. You compile it in Expo's cloud with **EAS Build** and install it on your own iPhone through **internal distribution** (Apple's "ad hoc" signing for registered devices). This guide goes from a fresh clone to the app running on your phone. **No Mac is needed:** everything below works from Windows, macOS or Linux.

> [!IMPORTANT]
> The app filters YouTube **only inside its own built-in browser**. The official YouTube app, Safari, other browsers and YouTube links tapped in other apps keep showing Shorts; iOS gives apps no way to change them.

**Contents:** [What you need](#what-you-need) · [1. Get the code](#1-get-the-code) · [2. Install dependencies](#2-install-dependencies) · [3. Make the project yours](#3-make-the-project-yours) · [4. Register your iPhone](#4-register-your-iphone) · [5. Build](#5-build) · [6. Install on the iPhone](#6-install-on-the-iphone) · [7. Rebuild and update](#7-rebuild-and-update) · [Using the app](#using-the-app) · [Troubleshooting](#troubleshooting) · [Without a paid Apple membership](#without-a-paid-apple-membership-mac-only-not-tested)

---

## What you need

| | Notes |
|---|---|
| **Apple Developer Program membership** | The paid membership (individual or organization): <https://developer.apple.com/programs/>. A free Apple ID cannot create the ad hoc provisioning profile this guide uses. |
| **Expo account** | Free: <https://expo.dev/signup>. The free plan includes a limited number of cloud builds per month, which is plenty for this. |
| **iPhone** | iOS **16.4 or later** (the minimum for Expo SDK 58). |
| **Computer** | Windows, macOS or Linux with **Node.js 20 or newer** (current LTS recommended) and npm, plus **git**. Tested on Windows 11 with Node 22.19 and npm 11.6. |
| **EAS CLI** | Expo's build tool, installed once (tested with 27.10.0):<br>`npm install -g eas-cli` |

Plan on 30 to 60 minutes the first time. Most of it is waiting for the cloud build.

### The one rule: run `npx eas` inside `ios-app/`

`ios-app/` is the Expo project. EAS treats the folder you run it from (or the nearest folder above it that has a `package.json`) as the project. Run from the repository root, it finds the root `package.json`, which has no Expo in it. It then writes stray `app.json`/`eas.json` files at the root and fails with *Cannot find 'expo-modules-autolinking'* or *The module 'expo' is not installed*. So:

```bash
cd AntiShort/ios-app
```

and run every `npx eas …` command from there.

---

## 1. Get the code

```bash
git clone https://github.com/sideswipeishacking/AntiShort.git
cd AntiShort/ios-app
```

**Why git matters:** EAS uploads the **git repository that contains the project**: its working tree, minus everything in `.gitignore` (`node_modules`, generated `ios/`/`android/` folders). Uncommitted changes are included, so you don't have to commit before building. With a clone, that repository is exactly this project (about 1 MB).

If you downloaded the ZIP instead, turn the unzipped `AntiShort` folder into its own repository before building, so EAS doesn't pick up a repository around it (or ask to create one):

```bash
cd AntiShort
git init
git add -A
git commit -m "AntiShort"
cd ios-app
```

---

## 2. Install dependencies

Inside `ios-app/`:

```bash
npm install
```

Optional checks (they should all pass):

```bash
npx tsc --noEmit
```

```bash
npx expo-doctor
```

The app uses Expo SDK 58, React Native 0.88.1, React 19.3.0 and `react-native-webview` 14.0.1. All versions are the ones Expo SDK 58 pins.

---

## 3. Make the project yours

`ios-app/app.json` in this repository points at the maintainer's Expo project and Apple bundle ID. You can't build into someone else's Expo project, and a bundle ID belongs to one Apple team, so change three things in **`ios-app/app.json`**:

| Field | Change |
|---|---|
| `expo.owner` | **Delete** this line. `eas init` adds your own account. |
| `expo.extra.eas.projectId` | **Delete** the whole `"extra": { … }` block. `eas init` creates a new project and adds its ID. |
| `expo.ios.bundleIdentifier` | Set your own reverse-domain ID, for example **`com.yourname.antishort`**. Use letters, digits, hyphens and dots only. It must be unique across all of Apple. |

After editing, the top of the file looks like this (with your bundle ID), and the file ends right after the `plugins` list:

```json
{
  "expo": {
    "name": "AntiShort",
    "slug": "antishort",
    "version": "1.0.0",
    ...
    "ios": {
      "bundleIdentifier": "com.yourname.antishort",
      ...
```

Then log in and create your EAS project:

```bash
npx eas login
```

```bash
npx eas init
```

`eas init` asks which account to use and whether to create the project `antishort`. Answer yes, and it writes the new project ID (and owner) back into `app.json`.

Leave the rest of `app.json` as it is. In particular, keep:

- `ios.config.usesNonExemptEncryption: false`: the app uses only standard HTTPS, so EAS doesn't ask about export compliance;
- `ios.infoPlist.NSAppTransportSecurity: { NSAllowsArbitraryLoads: false }`: strict App Transport Security, so plain-HTTP loads stay blocked.

---

## 4. Register your iPhone

Ad hoc builds only install on iPhones registered with your Apple team. Register each device once:

```bash
npx eas device:create
```

1. Log in to your Apple account if asked, and pick your team.
2. Choose **Website**. The CLI shows a link and a QR code.
3. On the **iPhone**, open the link (or scan the QR code with the Camera app) in **Safari**, and allow the configuration profile to download.
4. On the iPhone, open **Settings → General → VPN & Device Management**, tap the downloaded profile and install it. It only sends the device's identifier (UDID) to register it; it changes nothing else.

Check that it worked:

```bash
npx eas device:list
```

---

## 5. Build

```bash
npx eas build --platform ios --profile preview
```

The `preview` profile in `eas.json` makes an **internal-distribution build for real devices** (not the simulator).

The first build asks for signing credentials. Expect these prompts, in this order:

1. **"Do you want to log in to your Apple account?"** → `Y`. Enter your Apple ID, password and the two-factor code. The password goes to Apple and is not stored on Expo's servers. Later builds can reuse the saved session.
2. **Team:** pick your team if you belong to several.
3. **Bundle identifier:** registered with Apple automatically.
4. **Distribution certificate:** let EAS **generate a new Apple Distribution Certificate** (or reuse one you already have).
5. **Devices for the ad hoc provisioning profile:** select your iPhone with <kbd>Space</kbd>, then press <kbd>Enter</kbd>.

EAS then uploads the project (about 1 MB) and builds it on Expo's servers. That usually takes 10 to 30 minutes, depending on the queue; the build itself takes only a few minutes. You can follow it on <https://expo.dev> → your project → **Builds**. When it finishes, the CLI prints an **install link and a QR code**.

Later builds reuse the stored certificate and profile and don't need the Apple login, unless you add a device.

---

## 6. Install on the iPhone

1. On the **registered iPhone**, open the install link from the build (or scan its QR code with the Camera app), and tap **Install**. The same link is on the build's page at expo.dev.
2. **Turn on Developer Mode.** iOS 16 and later only open internally distributed apps with Developer Mode on: **Settings → Privacy & Security → Developer Mode → On**. The iPhone restarts; confirm **Turn On** afterwards. The Developer Mode option only appears after the first internal build has been installed (or an install was attempted).
3. Open **AntiShort**. The first launch shows a short notice explaining that filtering applies only inside the app.

---

## 7. Rebuild and update

- **New version of AntiShort:** run `git pull` in the repository and `npm install` in `ios-app/`, then run the build command from step 5 again. Install it from the new link; it replaces the installed app. Optionally raise `expo.ios.buildNumber` (or `expo.version`) in `app.json` first so you can tell builds apart. `eas.json` uses `appVersionSource: "local"`, so these values come from `app.json`.
- **Another iPhone:** run `npx eas device:create` for it, then build again. EAS asks whether to add the new device to the provisioning profile. Every device change needs a new build.
- **Expired signing:** Apple distribution certificates and ad hoc profiles expire after about a year, and the installed app stops opening when they do. Build again; EAS offers to create new credentials.

---

## Using the app

- **Toolbar:** Back, Forward, Reload (shows a spinner while a page loads), Home, and **More**, which has *Open YouTube link…* and *About Shorts filtering*. A thin progress line at the top shows page loading. Swiping from the screen edge also goes back and forward.
- **Open YouTube link…:** paste a link someone sent you. A Shorts link opens in the regular player. A non-YouTube link gets the external-link prompt instead of opening.
- **Links to other websites** never open automatically. You get a prompt naming the site, with **Stay here** or **Open in Safari** (Safari does not filter Shorts). Links that would launch other apps, for example `vnd.youtube://`, which opens the official YouTube app, are blocked with a short message.
- **Errors:** if a page fails to load, a panel says so, with the reason, **Try again** and **YouTube home**. An HTTP error from YouTube shows a banner. If iOS ends the web process, a panel offers to reload. A page is never shown as loaded unless it loaded.
- **Sign-in:** you can try signing in to your Google account, but Google may refuse sign-in inside embedded browsers. The app does not work around that. Without sign-in, Subscriptions and other personal pages are unavailable.

The app asks for no device permissions. It denies camera and microphone requests from web pages, keeps App Transport Security strict, and runs its bundled blocker only on YouTube pages. More detail: [development.md](development.md#iphone-app-internals).

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| *Cannot find 'expo-modules-autolinking'* or *The module 'expo' is not installed*, and new `app.json`/`eas.json` files appear at the repository root | You ran `npx eas` from the repository root. Delete those two root files, `cd ios-app`, and run the command again. |
| *Failed to register bundle identifier*, together with **"Apple Developer Program License Agreement Updated"** | Apple has a new agreement waiting. The team's **Account Holder** must sign in at <https://developer.apple.com/account> and accept it (also check App Store Connect → **Business** for pending agreements), then run the build again. EAS cannot accept it for you. |
| *Failed to register bundle identifier* without an agreement message, or the ID is reported as unavailable | Another Apple team already uses that bundle ID. Choose a different `expo.ios.bundleIdentifier` in `app.json` and build again. |
| A permissions error, or an error about an unknown project, right at the start | `app.json` still points at another account's EAS project. Do [step 3](#3-make-the-project-yours). |
| *Credentials are not set up* / `MissingCredentialsNonInteractiveError` | The first build can't run with `--non-interactive`; EAS needs your Apple login once. Run the build command without that flag. |
| *Unable to install "AntiShort"* / *integrity could not be verified* | This iPhone is not in the build's provisioning profile. Register it ([step 4](#4-register-your-iphone)) and build again. |
| The app is installed but won't open | Turn on Developer Mode ([step 6](#6-install-on-the-iphone)). If it opened before and stopped after about a year, the signing expired: build again. |
| No Developer Mode option in Settings | It appears only after the first internal build has been installed or an install was attempted. Install the build first, then look again. |
| Google says *This browser or app may not be secure* | Google restricts sign-in in embedded browsers. This is expected, and the app does not bypass it. |
| The project doesn't open in the Expo Go app | Expo Go has not been tried with this project and is not the supported path. Use the preview build from this guide. |

---

## Without a paid Apple membership (Mac only, not tested)

If you have a Mac with Xcode, you can sign with a free Apple ID's personal team instead of using EAS:

```bash
cd ios-app
npx expo run:ios --device
```

This generates the native `ios/` project and builds it with Xcode on your Mac. You still need your own bundle ID ([step 3](#3-make-the-project-yours); you can skip `eas init`). Apps signed by a free personal team expire after 7 days and must be reinstalled from the Mac. This path has **not been tested** for AntiShort.
