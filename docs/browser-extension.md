# Browser extension: install and use

The extension in [`chrome-extension/`](../chrome-extension) hides YouTube Shorts on `www.youtube.com` and `m.youtube.com` and opens Shorts links in the regular video player. It is a standard Manifest V3 extension that you load "unpacked" from a folder on your computer. It is not in the Chrome Web Store.

**Contents:** [Supported browsers](#supported-browsers) · [1. Get the files](#1-get-the-files) · [2. Load the extension](#2-load-the-extension) · [3. Check that it works](#3-check-that-it-works) · [Permissions and privacy](#permissions-and-privacy) · [Update](#update) · [Turn off or remove](#turn-off-or-remove) · [Troubleshooting](#troubleshooting) · [How it works](#how-it-works)

---

## Supported browsers

| Browser | Status |
|---|---|
| **Brave** (desktop) | Tested. The live smoke test passes in Brave 1.99 |
| **Google Chrome** (desktop) | Tested. The live smoke test passes in Chrome 157 |
| Microsoft Edge, Vivaldi, Opera and other Chromium browsers | Should work: same extension engine, Chromium 111 or newer. **Not tested** |
| Firefox, Safari | Not supported |
| Any browser on a phone or tablet | Not supported. On iPhone, use the [AntiShort app](build-ios.md) |

---

## 1. Get the files

Choose one:

- **With git** (makes updating easy):

  ```bash
  git clone https://github.com/sideswipeishacking/AntiShort.git
  ```

- **Without git:** on the repository page, click the green **Code** button → **Download ZIP**, then unzip it.

Put the folder somewhere permanent, for example `Documents\AntiShort`. **Do not delete or move it after installing:** the browser loads the extension from this folder every time it starts. If the folder disappears, the extension stops working and the extensions page shows an error.

The folder you will select in the next step is `AntiShort/chrome-extension`, the one that contains `manifest.json`.

---

## 2. Load the extension

### Brave

1. Type `brave://extensions` into the address bar and press Enter.
2. Turn on **Developer mode** with the switch in the top-right corner.
3. Click **Load unpacked**.
4. Select the **`chrome-extension`** folder inside `AntiShort` and confirm.
5. The card **AntiShort - Shorts blocker for YouTube** appears. Make sure its switch is on.
6. Reload any YouTube tabs that were already open.

Brave Shields can stay on; nothing Brave-specific is needed. **Each Brave profile has its own extensions:** if you use several profiles, load it in each one.

### Google Chrome

The same steps on `chrome://extensions`: **Developer mode** (top right) → **Load unpacked** → select `chrome-extension` → reload YouTube tabs. Chrome profiles also each need their own install.

### Other Chromium browsers (not tested)

| Browser | Extensions page | Developer mode switch |
|---|---|---|
| Microsoft Edge | `edge://extensions` | left sidebar |
| Vivaldi | `vivaldi://extensions` | top right |
| Opera | `opera://extensions` | top right |

Then **Load unpacked** → `chrome-extension`, as above. If it works for you in one of these, feel free to open an issue saying so.

### No toolbar button needed

AntiShort has no popup, settings page or toolbar button. It runs automatically on YouTube pages. You don't need to pin it.

### Private / incognito windows

Browsers turn extensions off in private windows by default. To use AntiShort there too: open the extensions page → **Details** on the AntiShort card → turn on **Allow in Private** (Brave) or **Allow in Incognito** (Chrome).

---

## 3. Check that it works

1. Open <https://www.youtube.com>. The Home feed has no Shorts shelf, and the left sidebar has no **Shorts** entry.
2. Search for something that usually returns Shorts, for example **funny cats**. You should see no Shorts shelf, no Shorts results and no **Shorts** filter chip.
3. Open any video. The recommendations next to it contain no Shorts.
4. Open a Shorts link directly, for example one a friend sent you (`https://www.youtube.com/shorts/…`). It opens in the normal player at `https://www.youtube.com/watch?v=…`.

If Shorts still show, reload the tab first, then see [Troubleshooting](#troubleshooting).

---

## Permissions and privacy

When you load it, the browser lists a single permission:

> Read and change your data on youtube.com, www.youtube.com and m.youtube.com

That is what lets the extension hide Shorts on YouTube pages and redirect Shorts links. It does not run on any other website.

The extension has no background worker, no storage and no network access of its own. It sends nothing anywhere, collects nothing and contains no analytics. Everything it runs is in `chrome-extension/`: `manifest.json`, `rules.json`, `page-hook.js`, `content.js` and `content.css` (plus the icons). You can read all of it before loading it.

---

## Update

1. Get the new version:
   - with git, run `git pull` inside the `AntiShort` folder;
   - with a ZIP, download it again and replace the old folder's contents, **keeping the same location**.
2. On the extensions page, click the **reload** icon (↻) on the AntiShort card.
3. Reload your YouTube tabs.

---

## Turn off or remove

- **Pause:** flip the switch on the AntiShort card off. Flip it on again to resume.
- **Remove:** click **Remove** on the card. After that you can delete the `AntiShort` folder.

---

## Troubleshooting

| Problem | What to do |
|---|---|
| *Manifest file is missing or unreadable* when loading | You selected the wrong folder. Select `AntiShort/chrome-extension`, the folder that contains `manifest.json`, not `AntiShort` itself. |
| Shorts still show in a tab that was open before you installed | Reload the tab. |
| The extension shows an error or disappeared after you moved the folder | Remove it and **Load unpacked** again from the new location. |
| It works in one profile or window but not another | Extensions are per profile, and off in private windows by default. See [Load the extension](#2-load-the-extension) and [Private / incognito windows](#private--incognito-windows). |
| Some Shorts appear again after YouTube changed its design | [Update](#update) the extension. If it is still happening, open an issue with the page URL and a screenshot. |
| A topic chip that says "Shorts" (for example about clothing) is hidden | Known limitation: link-less chips and tabs are recognized by the word "Shorts". |
| "Shorts" entries remain in a non-English YouTube interface | Link-less entries are matched by the label "Shorts". If your language translates it, the entry may stay visible, but the Shorts videos themselves are still hidden. |

---

## How it works

| Situation | Handled by |
|---|---|
| Full page load of `/shorts/<id>`, `/shorts` or `/@channel/shorts` (typed URL, link from another site, reload) | `rules.json`: `declarativeNetRequest` redirects before the page loads |
| YouTube switching to a Short without reloading the page | `page-hook.js` sees `history.pushState`/`replaceState`; `content.js` cancels it and opens `/watch?v=<id>` |
| YouTube's own navigation events | `content.js` listens to `yt-navigate-start`, `yt-navigate-finish`, `yt-page-data-updated`, `popstate` and `pageshow` |
| A normal click on a Shorts link | `content.js` opens the watch page instead. Ctrl/Cmd/middle clicks are left alone; the new tab is redirected by `rules.json` |
| Shorts shelves, tiles, chips, tabs, sidebar and bottom-bar entries | `content.css` hides them before they paint; `content.js` keeps hiding new ones as YouTube adds them (throttled, at most one scan every 250 ms, no polling) |

A video card is hidden only when it is confirmed to be a Short. More detail is in [development.md](development.md#how-the-blocker-works).
