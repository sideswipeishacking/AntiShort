#!/usr/bin/env node
/**
 * Live smoke test: loads chrome-extension/ into a throwaway headless Chrome or Brave profile and
 * checks real YouTube pages (desktop and mobile layout). Needs Chrome or Brave and network access.
 *
 *   node scripts/chrome-smoke-test.js            (Google Chrome)
 *   node scripts/chrome-smoke-test.js --brave    (Brave)
 *   CHROME_PATH="/path/to/chromium-browser" node scripts/chrome-smoke-test.js
 *
 * Uses the DevTools protocol over a pipe (Extensions.loadUnpacked), so your normal browser profile is
 * never touched. If YouTube shows its cookie consent page, the test clicks "Reject all".
 * YouTube's content changes constantly, so a page without any Shorts is reported as "not exercised".
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXTENSION_DIR = path.resolve(__dirname, '..', 'chrome-extension');
const USE_BRAVE = process.argv.includes('--brave');
const BROWSER_NAME = USE_BRAVE ? 'Brave' : 'Chrome';
const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  ...(USE_BRAVE
    ? [
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'BraveSoftware/Brave-Browser/Application/brave.exe'),
        'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
        'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        '/usr/bin/brave-browser',
      ]
    : [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
      ]),
].filter(Boolean);
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Cdp {
  constructor(input, output) {
    this.input = input;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    let buffer = '';
    output.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let end;
      while ((end = buffer.indexOf('\0')) !== -1) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (message.id && this.pending.has(message.id)) {
          const { resolve, reject } = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) reject(new Error(`${message.error.message} ${message.error.data || ''}`.trim()));
          else resolve(message.result);
        } else if (message.method) {
          for (const listener of this.listeners) listener(message);
        }
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    this.input.write(`${JSON.stringify(message)}\0`);
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

class Page {
  constructor(cdp, sessionId) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.documentRequests = [];
    cdp.listeners.push((message) => {
      if (message.sessionId !== sessionId || message.method !== 'Network.requestWillBeSent') return;
      if (message.params.type !== 'Document') return;
      this.documentRequests.push({
        url: message.params.request.url,
        redirectedFrom: message.params.redirectResponse ? message.params.redirectResponse.url : null,
        redirectStatus: message.params.redirectResponse ? message.params.redirectResponse.status : null,
        redirectText: message.params.redirectResponse ? message.params.redirectResponse.statusText : null,
      });
    });
  }

  send(method, params) {
    return this.cdp.send(method, params, this.sessionId);
  }

  async evaluate(expression) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'evaluation failed');
        return result.result.value;
      } catch (error) {
        if (!/context|navigat|Cannot find/i.test(error.message) || attempt === 19) throw error;
        await sleep(250);
      }
    }
    return undefined;
  }

  // A fresh Brave profile spends its first ~20 s fetching filter lists, so allow a slow first load.
  async waitForLoad(timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    await sleep(500);
    while (Date.now() < deadline) {
      const state = await this.evaluate('document.readyState').catch(() => null);
      if (state === 'complete') return;
      await sleep(250);
    }
    throw new Error('page did not finish loading');
  }

  async goto(url, settleMs = 3500) {
    this.documentRequests = [];
    await this.send('Page.navigate', { url });
    await this.waitForLoad();
    await this.passConsent();
    await sleep(settleMs);
    return this.evaluate('location.href');
  }

  /** On YouTube's EU cookie page, choose the privacy-preserving "Reject all". */
  async passConsent() {
    const host = await this.evaluate('location.hostname');
    if (host !== 'consent.youtube.com') return;
    const clicked = await this.evaluate(`(() => {
      const candidates = [...document.querySelectorAll('button, input[type=submit]')];
      const reject = candidates.find((el) => /reject all|alle ablehnen/i.test(el.innerText || el.value || el.getAttribute('aria-label') || ''));
      if (!reject) return false;
      reject.click();
      return true;
    })()`);
    if (!clicked) throw new Error('consent page without a "Reject all" button');
    console.log('  (consent page: clicked "Reject all")');
    await sleep(2500);
    await this.waitForLoad();
  }

  scroll() {
    return this.evaluate('window.scrollTo(0, document.documentElement.scrollHeight); true');
  }

  /** Counts Shorts surfaces and regular videos, and how many of each are visible. */
  measure() {
    return this.evaluate(`(() => {
      const blockerSelectors = ${JSON.stringify(cssSelectors(fs.readFileSync(path.join(EXTENSION_DIR, 'content.css'), 'utf8')))};
      const hiddenByBlocker = (el) => {
        for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
          if (node.hasAttribute('data-antishort-hidden')) return node;
          if (blockerSelectors.some((s) => { try { return node.matches(s); } catch (e) { return false; } })) return node;
        }
        return null;
      };
      const visible = (el) => el.getClientRects().length > 0;
      const all = (selector) => [...document.querySelectorAll(selector)];
      const describe = (el) => {
        const chain = [];
        for (let node = el; node && chain.length < 6; node = node.parentElement) chain.push(node.tagName.toLowerCase());
        return chain.join(' < ');
      };
      const shortsLinks = all('a[href*="/shorts/"]').filter((a) => !a.closest('[data-antishort-rewritten]') && !a.hasAttribute('data-antishort-rewritten'));
      const shortsSurfaces = all('ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts], ytm-reel-shelf-renderer, ytd-reel-item-renderer');
      const navEntries = all('ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, ytm-pivot-bar-item-renderer, yt-chip-cloud-chip-renderer, ytm-chip-cloud-chip-renderer, yt-tab-shape')
        .filter((el) => /^shorts$/i.test((el.getAttribute('tab-title') || el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim()) || el.querySelector('.pivot-shorts'));
      const watchLinks = all('a[href*="/watch?v="]');
      return {
        url: location.href,
        shortsLinks: shortsLinks.length,
        shortsLinksVisible: shortsLinks.filter(visible).length,
        shortsSurfaces: shortsSurfaces.length,
        shortsSurfacesVisible: shortsSurfaces.filter(visible).length,
        shortsNavEntries: navEntries.length,
        shortsNavEntriesVisible: navEntries.filter(visible).length,
        watchLinks: watchLinks.length,
        watchLinksVisible: watchLinks.filter(visible).length,
        watchLinksHiddenByBlocker: watchLinks.filter(hiddenByBlocker).map((a) => a.getAttribute('href') + ' in ' + describe(hiddenByBlocker(a))),
        hiddenByScript: all('[data-antishort-hidden]').length,
        rewrittenLinks: all('[data-antishort-rewritten]').length,
        visibleShortsExamples: shortsLinks.filter(visible).slice(0, 3).map((a) => a.getAttribute('href') + ' in ' + describe(a)),
        aShortsId: (() => {
          const link = all('a[href^="/shorts/"]')[0];
          const match = link && /^\\/shorts\\/([A-Za-z0-9_-]+)/.exec(link.getAttribute('href'));
          return match ? match[1] : null;
        })(),
      };
    })()`);
  }

  /** Checks that every selector in content.css is valid in this browser. */
  invalidCssSelectors(css) {
    return this.evaluate(`(() => {
      const css = ${JSON.stringify(css)};
      const selectors = css.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').split('{').slice(0, -1)
        .map((chunk) => chunk.slice(chunk.lastIndexOf('}') + 1)).flatMap((list) => list.split(','))
        .map((s) => s.trim()).filter(Boolean);
      const invalid = [];
      for (const selector of selectors) { try { document.querySelector(selector); } catch (e) { invalid.push(selector); } }
      return { checked: selectors.length, invalid };
    })()`);
  }
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok === true ? 'PASS' : ok === false ? 'FAIL' : 'SKIP'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

function reportSurfaces(label, m) {
  const exercised = m.shortsLinks + m.shortsSurfaces + m.shortsNavEntries > 0;
  const detail = `shorts links ${m.shortsLinksVisible}/${m.shortsLinks} visible, shorts shelves/tiles ${m.shortsSurfacesVisible}/${m.shortsSurfaces} visible, shorts nav ${m.shortsNavEntriesVisible}/${m.shortsNavEntries} visible, regular video links visible ${m.watchLinksVisible}/${m.watchLinks}, hidden by script ${m.hiddenByScript}`;
  if (!exercised) check(`${label}: no Shorts on this page (not exercised)`, null, detail);
  else check(`${label}: all Shorts hidden`, m.shortsLinksVisible === 0 && m.shortsSurfacesVisible === 0 && m.shortsNavEntriesVisible === 0, detail);
  if (m.visibleShortsExamples.length) console.log('    visible:', m.visibleShortsExamples.join('\n             '));
  if (m.watchLinks > 0) {
    check(`${label}: no regular video hidden by the blocker`, m.watchLinksHiddenByBlocker.length === 0,
      `${m.watchLinksVisible}/${m.watchLinks} regular video links visible; hidden by blocker rules: ${m.watchLinksHiddenByBlocker.length}`);
    if (m.watchLinksHiddenByBlocker.length) console.log('    hidden:', m.watchLinksHiddenByBlocker.slice(0, 5).join('\n            '));
  }
}

/** Selectors from content.css, comments removed. */
function cssSelectors(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('{')
    .slice(0, -1)
    .map((chunk) => chunk.slice(chunk.lastIndexOf('}') + 1))
    .flatMap((list) => list.split(','))
    .map((selector) => selector.trim())
    .filter(Boolean);
}

async function launchChrome() {
  const chromePath = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!chromePath) throw new Error(`${BROWSER_NAME} not found; set CHROME_PATH.`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'antishort-chrome-'));
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--mute-audio',
      '--lang=en-US',
      '--window-size=1366,900',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
  );
  const cdp = new Cdp(chrome.stdio[3], chrome.stdio[4]);
  const close = async () => {
    await cdp.send('Browser.close').catch(() => undefined);
    await new Promise((resolve) => {
      chrome.once('exit', resolve);
      setTimeout(resolve, 5000);
    });
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  };
  return { cdp, close };
}

async function openPage(cdp) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  return page;
}

async function emulateIphone(page) {
  await page.send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}

/** The Chrome extension itself, loaded unpacked. */
async function extensionSuite() {
  const { cdp, close } = await launchChrome();
  const css = fs.readFileSync(path.join(EXTENSION_DIR, 'content.css'), 'utf8');
  let shortsId = null;
  try {
    const { product } = await cdp.send('Browser.getVersion');
    console.log(`\n=== Extension in ${BROWSER_NAME} (${product}) ===`);
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: EXTENSION_DIR });
    check(`extension loads (manifest.json + rules.json accepted by ${BROWSER_NAME})`, Boolean(id), `id ${id}`);
    const page = await openPage(cdp);

    console.log('\nDesktop layout (www.youtube.com)');
    await page.goto('https://www.youtube.com/');
    const cssCheck = await page.invalidCssSelectors(css);
    check(`every content.css selector is valid in ${BROWSER_NAME}`, cssCheck.invalid.length === 0, `${cssCheck.checked} selectors, invalid: ${JSON.stringify(cssCheck.invalid)}`);
    const hook = await page.evaluate('typeof window.__antishortHistoryHook');
    check('page hook active in the MAIN world', hook === 'boolean');
    await page.scroll();
    await sleep(2500);
    reportSurfaces('home', await page.measure());

    await page.goto('https://www.youtube.com/results?search_query=funny+cats');
    await page.scroll();
    await sleep(2500);
    const search = await page.measure();
    reportSurfaces('search results', search);

    shortsId = search.aShortsId;
    await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 5000);
    await page.scroll();
    await sleep(2500);
    const watch = await page.measure();
    reportSurfaces('watch page recommendations', watch);
    shortsId = shortsId || watch.aShortsId;

    await page.goto('https://www.youtube.com/@YouTube/shorts');
    const channelUrl = await page.evaluate('location.href');
    check('channel /shorts tab redirects to /videos', /\/@YouTube\/videos/.test(channelUrl), channelUrl);
    reportSurfaces('channel page', await page.measure());

    await page.goto('https://www.youtube.com/shorts');
    const bare = await page.evaluate('location.href');
    check('bare /shorts redirects to the homepage', bare === 'https://www.youtube.com/', bare);

    if (shortsId) {
      const finalUrl = await page.goto(`https://www.youtube.com/shorts/${shortsId}?feature=share`);
      const dnr = page.documentRequests.find((r) => r.redirectedFrom && r.redirectedFrom.includes('/shorts/'));
      check('direct /shorts/<id> URL ends on /watch?v=<id>', finalUrl.startsWith(`https://www.youtube.com/watch?v=${shortsId}`), finalUrl);
      check('...redirected by the DNR rule before any page loaded', Boolean(dnr), dnr ? `${dnr.redirectStatus} ${dnr.redirectText}` : 'no internal redirect seen');

      await page.goto('https://www.youtube.com/results?search_query=funny+cats');
      await page.evaluate(`history.pushState({}, '', '/shorts/${shortsId}'); true`);
      await sleep(3000);
      await page.waitForLoad();
      const spaUrl = await page.evaluate('location.href');
      check('SPA history.pushState into a Short ends on /watch', spaUrl.startsWith(`https://www.youtube.com/watch?v=${shortsId}`), spaUrl);

      await page.goto('https://www.youtube.com/results?search_query=funny+cats');
      const clicked = await page.evaluate(`(() => { const a = document.querySelector('a[href^="/shorts/"]'); if (!a) return null; const id = a.getAttribute('href').split('/')[2].split('?')[0]; a.click(); return id; })()`);
      if (clicked) {
        await sleep(3000);
        await page.waitForLoad();
        const clickUrl = await page.evaluate('location.href');
        check('in-page click on a Shorts link ends on /watch', clickUrl.startsWith(`https://www.youtube.com/watch?v=${clicked}`), clickUrl);
      } else {
        check('in-page click on a Shorts link (no Shorts link on page, not exercised)', null);
      }
    } else {
      check('direct /shorts/<id> and SPA tests (no Shorts id found on live pages, not exercised)', null);
    }

    console.log('\nMobile layout (m.youtube.com, iPhone emulation)');
    await emulateIphone(page);
    await page.goto('https://m.youtube.com/');
    await page.scroll();
    await sleep(2500);
    reportSurfaces('mobile home (incl. bottom nav)', await page.measure());
    await page.goto('https://m.youtube.com/results?search_query=funny+cats');
    await page.scroll();
    await sleep(2500);
    const mobileSearch = await page.measure();
    reportSurfaces('mobile search results', mobileSearch);
    shortsId = shortsId || mobileSearch.aShortsId;
    if (shortsId) {
      const mobileUrl = await page.goto(`https://m.youtube.com/shorts/${shortsId}`);
      check('mobile /shorts/<id> ends on /watch?v=<id>', mobileUrl.startsWith(`https://m.youtube.com/watch?v=${shortsId}`), mobileUrl);
    }
  } finally {
    await close();
  }
  return shortsId;
}

/**
 * The iOS app's injected script (ios-app/src/blocker/blockerScript.generated.ts), without the
 * extension: registered with Page.addScriptToEvaluateOnNewDocument, i.e. in the page's own world at
 * document start, like the WebView's WKUserScript. iPhone user agent and screen size are emulated.
 * This approximates the app's WebView in Chrome; it is not WebKit and not a device.
 */
async function iosBundleSuite(knownShortsId) {
  const { buildScript } = require('./build-ios-blocker.js');
  const { cdp, close } = await launchChrome();
  try {
    console.log('\n=== iOS app blocker bundle, injected at document start (iPhone emulation, no extension) ===');
    const page = await openPage(cdp);
    await emulateIphone(page);
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: buildScript() });

    await page.goto('https://m.youtube.com/');
    const style = await page.evaluate(`(() => { const s = document.querySelector('style[data-antishort]'); return s && s.sheet ? s.sheet.cssRules.length : -1; })()`);
    check('injected <style> is accepted by the page (not blocked by CSP)', style > 0, `${style} CSS rules active`);
    await page.scroll();
    await sleep(2500);
    reportSurfaces('mobile home', await page.measure());

    await page.goto('https://m.youtube.com/results?search_query=funny+cats');
    await page.scroll();
    await sleep(2500);
    const search = await page.measure();
    reportSurfaces('mobile search results', search);
    const shortsId = search.aShortsId || knownShortsId;

    await page.goto('https://m.youtube.com/@YouTube/shorts');
    const channelUrl = await page.evaluate('location.href');
    check('channel /shorts tab redirects to /videos', /\/@YouTube\/videos/.test(channelUrl), channelUrl);

    if (shortsId) {
      const direct = await page.goto(`https://m.youtube.com/shorts/${shortsId}`);
      check('directly loaded /shorts/<id> is replaced by /watch?v=<id> at document start', direct.startsWith(`https://m.youtube.com/watch?v=${shortsId}`), direct);

      await page.goto('https://m.youtube.com/results?search_query=funny+cats');
      await page.evaluate(`history.pushState({}, '', '/shorts/${shortsId}'); true`);
      await sleep(3000);
      await page.waitForLoad();
      const spa = await page.evaluate('location.href');
      check('SPA history.pushState into a Short ends on /watch', spa.startsWith(`https://m.youtube.com/watch?v=${shortsId}`), spa);
    } else {
      check('direct and SPA Shorts redirects (no Shorts id found, not exercised)', null);
    }

    await page.goto('https://example.com/', 1000);
    const untouched = await page.evaluate(`typeof window.__antishortActive === 'undefined' && typeof window.__antishortHistoryHook === 'undefined' && !document.querySelector('style[data-antishort]')`);
    check('non-YouTube page: script exits at its host check', untouched === true);
  } finally {
    await close();
  }
}

async function main() {
  // Chrome writes its compiled DNR index into chrome-extension/_metadata when loading unpacked.
  const metadataDir = path.join(EXTENSION_DIR, '_metadata');
  const hadMetadata = fs.existsSync(metadataDir);
  let shortsId = null;
  try {
    shortsId = await extensionSuite();
  } finally {
    if (!hadMetadata) fs.rmSync(metadataDir, { recursive: true, force: true });
  }
  await iosBundleSuite(shortsId);

  const failed = results.filter((r) => r.ok === false).length;
  const passed = results.filter((r) => r.ok === true).length;
  const skipped = results.filter((r) => r.ok === null).length;
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} not exercised`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
