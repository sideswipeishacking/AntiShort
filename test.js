#!/usr/bin/env node
/**
 * AntiShort test suite. Run from the repository root:  node test.js
 * (needs `npm install` in mobile-app/ first, for the TypeScript compiler and Expo's URL polyfill).
 *
 * Covers:
 *  - Shorts URL redirect logic, checked against ONE table of cases in all three implementations:
 *      chrome-extension/rules.json (DNR), chrome-extension/content.js, mobile-app/src/navigationPolicy.ts
 *    The app policy runs twice: with Node's URL and with whatwg-url-minimum (Expo's on-device URL).
 *  - The app's navigation policy (allowed YouTube hosts, blocked external sites and app schemes).
 *  - The injected blocker's browser runtime in a simulated window (redirects on load, SPA
 *    history changes, YouTube navigation events, popstate and link clicks; host guard).
 *  - Static validation of manifest.json, rules.json, app.json, eas.json, package versions, icons.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, test } = require('node:test');
const vm = require('node:vm');

const ROOT = __dirname;
const EXT_DIR = path.join(ROOT, 'chrome-extension');
const APP_DIR = path.join(ROOT, 'mobile-app');
const APP_MODULES = path.join(APP_DIR, 'node_modules');

const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
// Normalized to LF so the source checks also pass in Windows checkouts (git core.autocrlf=true).
const readText = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n');

const core = require('./chrome-extension/content.js');
const appBlocker = require('./scripts/build-app-blocker.js');
const manifest = readJson('chrome-extension/manifest.json');
const rules = readJson('chrome-extension/rules.json');

// ------------------------------------------------------------------------------------------------
// Implementations under test
// ------------------------------------------------------------------------------------------------

function requireAppModule(name) {
  const resolved = path.join(APP_MODULES, name);
  if (!fs.existsSync(resolved)) {
    throw new Error(`mobile-app/node_modules/${name} is missing. Run "npm install" in mobile-app/ first.`);
  }
  return require(resolved);
}

/** Compiles mobile-app/src/navigationPolicy.ts with the app's TypeScript and binds it to a URL class. */
function loadNavigationPolicy(URLImpl) {
  const ts = requireAppModule('typescript');
  const source = readText('mobile-app/src/navigationPolicy.ts');
  const { outputText, diagnostics } = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  assert.equal(diagnostics.length, 0, 'navigationPolicy.ts should transpile without diagnostics');
  const module = { exports: {} };
  new Function('exports', 'module', 'URL', outputText)(module.exports, module, URLImpl);
  return module.exports;
}

const policyNode = loadNavigationPolicy(URL);
const policyExpo = loadNavigationPolicy(requireAppModule('whatwg-url-minimum').URL);
const POLICIES = [
  ['Node URL', policyNode],
  ['Expo URL polyfill (whatwg-url-minimum)', policyExpo],
];

/** Applies rules.json the way Chrome's declarativeNetRequest would to a main-frame request URL. */
function applyDnrRules(url) {
  const matches = [];
  for (const rule of rules) {
    const flags = rule.condition.isUrlFilterCaseSensitive ? '' : 'i';
    const match = new RegExp(rule.condition.regexFilter, flags).exec(url);
    if (match) {
      matches.push(rule.action.redirect.regexSubstitution.replace(/\\(\d)/g, (_, n) => match[Number(n)] ?? ''));
    }
  }
  assert.ok(matches.length <= 1, `more than one DNR rule matches ${url}`);
  return matches.length ? matches[0] : null;
}

// ------------------------------------------------------------------------------------------------
// Shared cases: [input URL, expected redirect target or null (unchanged)]
// ------------------------------------------------------------------------------------------------

const SHORTS_CASES = [
  ['https://www.youtube.com/shorts/VIDEO_ID', 'https://www.youtube.com/watch?v=VIDEO_ID'],
  ['https://www.youtube.com/shorts/VIDEO_ID?feature=share&si=AbC123', 'https://www.youtube.com/watch?v=VIDEO_ID'],
  ['https://m.youtube.com/shorts/VIDEO_ID', 'https://m.youtube.com/watch?v=VIDEO_ID'],
  ['https://www.youtube.com/shorts', 'https://www.youtube.com/'],
  ['https://www.youtube.com/shorts/', 'https://www.youtube.com/'],
  ['https://m.youtube.com/shorts?app=m', 'https://m.youtube.com/'],
  ['https://www.youtube.com/watch?v=VIDEO_ID', null],
  ['https://youtube.com/shorts/dQw4w9WgXcQ', 'https://youtube.com/watch?v=dQw4w9WgXcQ'],
  ['http://www.youtube.com/shorts/VIDEO_ID', 'https://www.youtube.com/watch?v=VIDEO_ID'],
  ['https://www.youtube.com/shorts/VIDEO_ID/', 'https://www.youtube.com/watch?v=VIDEO_ID'],
  ['https://www.youtube.com/shorts/aB-_9xYz012#comments', 'https://www.youtube.com/watch?v=aB-_9xYz012'],
  ['https://www.youtube.com/@SomeChannel/shorts', 'https://www.youtube.com/@SomeChannel/videos'],
  ['https://m.youtube.com/@SomeChannel/shorts?view=0', 'https://m.youtube.com/@SomeChannel/videos'],
  [
    'https://www.youtube.com/channel/UC1234567890abcdefghijkl/shorts',
    'https://www.youtube.com/channel/UC1234567890abcdefghijkl/videos',
  ],
  ['https://www.youtube.com/c/SomeName/shorts/', 'https://www.youtube.com/c/SomeName/videos'],
  ['https://www.youtube.com/@SomeChannel/videos', null],
  ['https://www.youtube.com/@SomeChannel', null],
  ['https://www.youtube.com/', null],
  ['https://www.youtube.com/feed/subscriptions', null],
  ['https://www.youtube.com/results?search_query=shorts', null],
  ['https://www.youtube.com/watch?v=VIDEO_ID&list=shorts', null],
  ['https://www.youtube.com/shorts/VIDEO_ID/extra', null],
  ['https://www.youtube.com/shortsfeed', null],
  ['https://www.youtube.com/SHORTS/VIDEO_ID', null],
  ['https://music.youtube.com/shorts/VIDEO_ID', null],
  ['https://example.com/shorts/VIDEO_ID', null],
  ['https://www.youtube.com.evil.example/shorts/VIDEO_ID', null],
  ['https://notyoutube.com/shorts/VIDEO_ID', null],
  ['https://evil.example/?next=https://www.youtube.com/shorts/VIDEO_ID', null],
];

describe('Shorts URL redirects (same cases for every implementation)', () => {
  for (const [input, expected] of SHORTS_CASES) {
    test(`${input} -> ${expected ?? 'unchanged'}`, () => {
      assert.equal(core.getShortsRedirect(input), expected, 'chrome-extension/content.js');
      assert.equal(applyDnrRules(input), expected, 'chrome-extension/rules.json');
      for (const [label, policy] of POLICIES) {
        assert.equal(policy.getShortsRedirect(input), expected, `mobile-app navigationPolicy.ts (${label})`);
      }
    });
  }

  test('content.js resolves relative Shorts links against the page URL', () => {
    assert.equal(core.getShortsRedirect('/shorts/REL_123', 'https://m.youtube.com/'), 'https://m.youtube.com/watch?v=REL_123');
    assert.equal(core.getShortsRedirect('/watch?v=REL_123', 'https://m.youtube.com/'), null);
    assert.equal(core.classifyShortsUrl('/@chan/shorts', 'https://www.youtube.com/feed').kind, 'channel-tab');
    assert.equal(core.getShortsRedirect('not a url'), null);
    assert.equal(core.getShortsRedirect(''), null);
    assert.equal(core.getShortsRedirect(null), null);
  });
});

// ------------------------------------------------------------------------------------------------
// App navigation policy
// ------------------------------------------------------------------------------------------------

const ALLOW = { action: 'allow' };
const NAVIGATION_CASES = [
  // [url, isTopFrame, expected (subset of the decision)]
  ['https://m.youtube.com/', true, ALLOW],
  ['https://www.youtube.com/watch?v=VIDEO_ID', true, ALLOW],
  ['https://music.youtube.com/', true, ALLOW],
  ['https://consent.youtube.com/m?continue=https%3A%2F%2Fm.youtube.com%2F', true, ALLOW],
  ['https://youtu.be/VIDEO_ID', true, ALLOW],
  ['https://accounts.google.com/ServiceLogin?service=youtube', true, ALLOW],
  ['about:blank', true, ALLOW],
  [
    'https://m.youtube.com/shorts/VIDEO_ID',
    true,
    { action: 'redirect', target: 'https://m.youtube.com/watch?v=VIDEO_ID', reason: 'shorts' },
  ],
  [
    'https://www.youtube.com/shorts/VIDEO_ID?feature=share',
    true,
    { action: 'redirect', target: 'https://www.youtube.com/watch?v=VIDEO_ID', reason: 'shorts' },
  ],
  ['https://m.youtube.com/shorts', true, { action: 'redirect', target: 'https://m.youtube.com/', reason: 'shorts' }],
  [
    'http://m.youtube.com/watch?v=VIDEO_ID',
    true,
    { action: 'redirect', target: 'https://m.youtube.com/watch?v=VIDEO_ID', reason: 'https' },
  ],
  ['https://example.com/', true, { action: 'block', reason: 'external-site', host: 'example.com', notify: true }],
  ['https://www.google.com/search?q=shorts', true, { action: 'block', reason: 'external-site', notify: true }],
  ['https://www.youtube.com.evil.example/', true, { action: 'block', reason: 'external-site', notify: true }],
  ['https://evilyoutube.com/watch?v=VIDEO_ID', true, { action: 'block', reason: 'external-site', notify: true }],
  ['https://accounts.google.com.evil.example/', true, { action: 'block', reason: 'external-site', notify: true }],
  ['vnd.youtube://VIDEO_ID', true, { action: 'block', reason: 'unsupported-scheme', notify: true }],
  ['youtube://watch?v=VIDEO_ID', true, { action: 'block', reason: 'unsupported-scheme', notify: true }],
  ['mailto:someone@example.com', true, { action: 'block', reason: 'unsupported-scheme', notify: true }],
  ['data:text/html,hello', true, { action: 'block', reason: 'unsupported-scheme', notify: true }],
  ['not a url', true, { action: 'block', reason: 'invalid-url', notify: true }],
  ['https://googleads.g.doubleclick.net/pagead/ads', false, ALLOW],
  ['https://www.youtube.com/embed/VIDEO_ID', false, ALLOW],
  ['about:srcdoc', false, ALLOW],
  ['vnd.youtube://VIDEO_ID', false, { action: 'block', reason: 'unsupported-scheme', notify: false }],
  // Android: react-native-webview does not report the frame (isTopFrame undefined). Treated as the
  // top frame, so other websites stay blocked; page-made about:/blob:/data: content passes silently.
  ['https://example.com/', undefined, { action: 'block', reason: 'external-site', host: 'example.com', notify: true }],
  ['https://googleads.g.doubleclick.net/pagead/ads', undefined, { action: 'block', reason: 'external-site', notify: true }],
  ['https://m.youtube.com/', undefined, ALLOW],
  ['https://accounts.google.com/ServiceLogin?service=youtube', undefined, ALLOW],
  [
    'https://m.youtube.com/shorts/VIDEO_ID',
    undefined,
    { action: 'redirect', target: 'https://m.youtube.com/watch?v=VIDEO_ID', reason: 'shorts' },
  ],
  ['intent://watch?v=VIDEO_ID#Intent;scheme=vnd.youtube;package=com.google.android.youtube;end', undefined, { action: 'block', reason: 'unsupported-scheme', notify: true }],
  ['vnd.youtube://VIDEO_ID', undefined, { action: 'block', reason: 'unsupported-scheme', notify: true }],
  ['blob:https://m.youtube.com/0b1c2d3e-0000-4000-8000-000000000000', undefined, ALLOW],
  ['data:text/html,hello', undefined, ALLOW],
  ['about:srcdoc', undefined, ALLOW],
  ['not a url', undefined, { action: 'block', reason: 'invalid-url', notify: true }],
];

describe('App navigation policy (iPhone/Android)', () => {
  for (const [label, policy] of POLICIES) {
    describe(label, () => {
      for (const [url, isTopFrame, expected] of NAVIGATION_CASES) {
        test(`${isTopFrame === undefined ? 'unknown frame (Android)' : isTopFrame ? 'top frame' : 'sub-frame'} ${url} -> ${expected.action}${expected.reason ? ` (${expected.reason})` : ''}`, () => {
          const decision = policy.decideNavigation(url, isTopFrame);
          for (const [key, value] of Object.entries(expected)) {
            assert.equal(decision[key], value, `decision.${key} for ${url}: ${JSON.stringify(decision)}`);
          }
          if (expected.action === 'allow') assert.deepEqual(Object.keys(decision), ['action']);
        });
      }

      test('a non-YouTube URL is rejected (required case)', () => {
        assert.equal(policy.decideNavigation('https://example.com/some/page', true).action, 'block');
      });

      test('a normal /watch?v= URL is left unchanged (required case)', () => {
        assert.deepEqual({ ...policy.decideNavigation('https://www.youtube.com/watch?v=VIDEO_ID', true) }, ALLOW);
      });

      test('pasted links ("Open YouTube link") are normalized, then go through the same policy', () => {
        assert.equal(policy.normalizeUserUrl('  youtube.com/shorts/VIDEO_ID '), 'https://youtube.com/shorts/VIDEO_ID');
        assert.equal(policy.normalizeUserUrl('https://m.youtube.com/watch?v=VIDEO_ID'), 'https://m.youtube.com/watch?v=VIDEO_ID');
        assert.equal(policy.normalizeUserUrl('   '), null);
        const pastedShort = policy.decideNavigation(policy.normalizeUserUrl('www.youtube.com/shorts/VIDEO_ID?si=x'), true);
        assert.equal(pastedShort.action, 'redirect');
        assert.equal(pastedShort.target, 'https://www.youtube.com/watch?v=VIDEO_ID');
        assert.equal(policy.decideNavigation(policy.normalizeUserUrl('example.com'), true).action, 'block');
        assert.equal(policy.decideNavigation(policy.normalizeUserUrl('javascript:alert(1)'), true).action, 'block');
      });

      test('isYouTubeUrl only accepts http(s) YouTube URLs', () => {
        assert.equal(policy.isYouTubeUrl('https://m.youtube.com/feed/subscriptions'), true);
        assert.equal(policy.isYouTubeUrl('https://accounts.google.com/'), false);
        assert.equal(policy.isYouTubeUrl('vnd.youtube://x'), false);
        assert.equal(policy.isYouTubeUrl(null), false);
        assert.equal(policy.HOME_URL, 'https://m.youtube.com/');
      });
    });
  }

  test('buildNavigationScript only navigates YouTube pages and escapes the target', () => {
    const target = 'https://m.youtube.com/watch?v=a"b\'c</script>';
    const script = policyNode.buildNavigationScript(target);
    for (const [hostname, expectAssign] of [['m.youtube.com', true], ['www.youtube.com', true], ['accounts.google.com', false]]) {
      const assigned = [];
      const context = vm.createContext({ location: { hostname, assign: (u) => assigned.push(u) } });
      assert.equal(vm.runInContext(script, context), true);
      assert.deepEqual(assigned, expectAssign ? [target] : [], hostname);
    }
  });
});

// ------------------------------------------------------------------------------------------------
// Injected blocker runtime in a simulated browser window
// ------------------------------------------------------------------------------------------------

/**
 * Minimal window/document stand-in: enough for the blocker's redirect and navigation wiring.
 * DOM hiding needs a real page and is covered by the live-page smoke test described in README.
 */
function createFakeBrowser(href) {
  const url = new URL(href);
  const log = { replace: [], assign: [], pushState: [], replaceState: [], styles: [] };
  const listeners = new Map();
  const timers = [];

  class FakeEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.cancelable = Boolean(init.cancelable);
      this.detail = init.detail;
      this.defaultPrevented = false;
      this.button = 0;
      this.path = [];
    }
    preventDefault() {
      if (this.cancelable) this.defaultPrevented = true;
    }
    stopImmediatePropagation() {
      this.stopped = true;
    }
    composedPath() {
      return this.path;
    }
  }
  class FakeCustomEvent extends FakeEvent {}

  const originalPushState = function (state, title, next) {
    log.pushState.push(String(next));
    url.href = new URL(String(next), url.href).href;
  };
  const originalReplaceState = function (state, title, next) {
    log.replaceState.push(String(next));
    url.href = new URL(String(next), url.href).href;
  };

  const win = {
    location: {
      get href() {
        return url.href;
      },
      get hostname() {
        return url.hostname;
      },
      replace: (next) => log.replace.push(String(next)),
      assign: (next) => log.assign.push(String(next)),
    },
    history: { pushState: originalPushState, replaceState: originalReplaceState },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) || []) {
        fn.call(win, event);
        if (event.stopped) break;
      }
      return !event.defaultPrevented;
    },
    setTimeout(fn) {
      timers.push(fn);
      return timers.length;
    },
    console,
    URL,
    Event: FakeEvent,
    CustomEvent: FakeCustomEvent,
    MutationObserver: class {
      observe() {}
    },
  };
  win.window = win;
  win.document = {
    readyState: 'complete',
    head: {
      appendChild(el) {
        el.isConnected = true;
        log.styles.push(el.textContent);
      },
    },
    documentElement: { appendChild() {} },
    createElement: (tag) => ({ tagName: tag.toUpperCase(), isConnected: false, textContent: '', setAttribute() {} }),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  vm.createContext(win);

  return {
    win,
    log,
    listeners,
    originalPushState,
    FakeEvent,
    setUrl(next) {
      url.href = new URL(next, url.href).href;
    },
    run(script) {
      vm.runInContext(script, win, { filename: 'app-blocker.js' });
    },
    flushTimers() {
      for (let i = 0; i < 20 && timers.length; i++) timers.shift()();
    },
  };
}

function fakeAnchor(href) {
  return {
    nodeType: 1,
    tagName: 'A',
    hasAttribute: (name) => name === 'href',
    getAttribute: (name) => (name === 'href' ? href : null),
  };
}

describe('Injected blocker runtime (app bundle = page-hook.js + content.js + content.css)', () => {
  const script = appBlocker.buildScript();

  test('does nothing at all on non-YouTube pages', () => {
    for (const href of ['https://accounts.google.com/ServiceLogin', 'https://music.youtube.com/', 'https://example.com/shorts/VIDEO_ID']) {
      const browser = createFakeBrowser(href);
      browser.run(script);
      browser.flushTimers();
      assert.equal(browser.listeners.size, 0, `no listeners on ${href}`);
      assert.equal(browser.win.history.pushState, browser.originalPushState, `history untouched on ${href}`);
      assert.deepEqual(browser.log.styles, [], `no styles on ${href}`);
      assert.deepEqual([...browser.log.replace, ...browser.log.assign], [], `no navigation on ${href}`);
    }
  });

  test('redirects a directly loaded /shorts/<id> page with location.replace', () => {
    const browser = createFakeBrowser('https://www.youtube.com/shorts/VIDEO_ID?feature=share');
    browser.run(script);
    assert.deepEqual(browser.log.replace, ['https://www.youtube.com/watch?v=VIDEO_ID']);
    assert.deepEqual(browser.log.assign, []);
  });

  test('redirects a directly loaded bare /shorts page to the homepage', () => {
    const browser = createFakeBrowser('https://m.youtube.com/shorts');
    browser.run(script);
    assert.deepEqual(browser.log.replace, ['https://m.youtube.com/']);
  });

  test('leaves the homepage and normal watch pages alone, and injects the CSS once', () => {
    const browser = createFakeBrowser('https://m.youtube.com/');
    browser.run(script);
    browser.win.history.pushState({}, '', '/watch?v=VIDEO_ID');
    browser.flushTimers();
    assert.deepEqual(browser.log.pushState, ['/watch?v=VIDEO_ID']);
    assert.deepEqual([...browser.log.replace, ...browser.log.assign], []);
    assert.equal(browser.log.styles.length, 1);
    assert.match(browser.log.styles[0], /ytm-reel-shelf-renderer/);
  });

  test('SPA navigation into a Short (history.pushState) is cancelled and sent to the watch page', () => {
    const browser = createFakeBrowser('https://m.youtube.com/');
    browser.run(script);
    browser.win.history.pushState({}, '', '/shorts/SPA_123');
    assert.deepEqual(browser.log.pushState, [], 'the Shorts history entry is never created');
    assert.deepEqual(browser.log.assign, ['https://m.youtube.com/watch?v=SPA_123']);
  });

  test('history.replaceState to a channel Shorts tab goes to the Videos tab', () => {
    const browser = createFakeBrowser('https://www.youtube.com/@SomeChannel');
    browser.run(script);
    browser.win.history.replaceState({}, '', '/@SomeChannel/shorts');
    assert.deepEqual(browser.log.replaceState, []);
    assert.deepEqual(browser.log.assign, ['https://www.youtube.com/@SomeChannel/videos']);
  });

  test('yt-navigate-start with a Shorts URL redirects before YouTube renders it', () => {
    const browser = createFakeBrowser('https://www.youtube.com/');
    browser.run(script);
    browser.win.dispatchEvent(new browser.FakeEvent('yt-navigate-start', { detail: { url: '/shorts/NAV_456' } }));
    assert.deepEqual(browser.log.assign, ['https://www.youtube.com/watch?v=NAV_456']);
  });

  test('popstate back onto a Shorts URL replaces it', () => {
    const browser = createFakeBrowser('https://www.youtube.com/');
    browser.run(script);
    browser.setUrl('/shorts/BACK_789');
    browser.win.dispatchEvent(new browser.FakeEvent('popstate'));
    assert.deepEqual(browser.log.replace, ['https://www.youtube.com/watch?v=BACK_789']);
  });

  test('plain clicks on Shorts links open the watch page; modified clicks and normal links pass through', () => {
    const browser = createFakeBrowser('https://www.youtube.com/');
    browser.run(script);

    const shortsClick = new browser.FakeEvent('click', { cancelable: true });
    shortsClick.path = [fakeAnchor('/shorts/CLICK_1')];
    browser.win.dispatchEvent(shortsClick);
    assert.equal(shortsClick.defaultPrevented, true);
    assert.deepEqual(browser.log.assign, ['https://www.youtube.com/watch?v=CLICK_1']);

    const fresh = createFakeBrowser('https://www.youtube.com/');
    fresh.run(script);
    const ctrlClick = new fresh.FakeEvent('click', { cancelable: true });
    ctrlClick.ctrlKey = true;
    ctrlClick.path = [fakeAnchor('/shorts/CLICK_2')];
    fresh.win.dispatchEvent(ctrlClick);
    const normalClick = new fresh.FakeEvent('click', { cancelable: true });
    normalClick.path = [fakeAnchor('/watch?v=NORMAL')];
    fresh.win.dispatchEvent(normalClick);
    assert.equal(ctrlClick.defaultPrevented, false);
    assert.equal(normalClick.defaultPrevented, false);
    assert.deepEqual(fresh.log.assign, []);
  });

  test('a second redirect within the guard window is ignored (no redirect loops)', () => {
    const browser = createFakeBrowser('https://m.youtube.com/');
    browser.run(script);
    browser.win.history.pushState({}, '', '/shorts/FIRST');
    browser.win.history.pushState({}, '', '/shorts/SECOND');
    assert.deepEqual(browser.log.assign, ['https://m.youtube.com/watch?v=FIRST']);
  });

  test('works when <html> does not exist yet at document start (Chrome timing)', () => {
    const browser = createFakeBrowser('https://m.youtube.com/');
    const { head, documentElement } = browser.win.document;
    browser.win.document.head = null;
    browser.win.document.documentElement = null;
    browser.run(script);
    assert.ok(browser.listeners.size > 0, 'listeners registered despite the missing root element');
    browser.win.history.pushState({}, '', '/shorts/EARLY_1');
    assert.deepEqual(browser.log.assign, ['https://m.youtube.com/watch?v=EARLY_1']);
    assert.deepEqual(browser.log.styles, [], 'style waits for a root element');
    browser.win.document.head = head;
    browser.win.document.documentElement = documentElement;
    browser.flushTimers();
    assert.equal(browser.log.styles.length, 1, 'style added once the root element exists');

    const direct = createFakeBrowser('https://www.youtube.com/shorts/EARLY_2');
    direct.win.document.head = null;
    direct.win.document.documentElement = null;
    direct.run(script);
    assert.deepEqual(direct.log.replace, ['https://www.youtube.com/watch?v=EARLY_2']);
  });

  test('running the script twice in one document does not double-register', () => {
    const browser = createFakeBrowser('https://m.youtube.com/');
    browser.run(script);
    const counts = [...browser.listeners.values()].map((list) => list.length);
    browser.run(script);
    assert.deepEqual([...browser.listeners.values()].map((list) => list.length), counts);
  });
});

// ------------------------------------------------------------------------------------------------
// Static validation: Chrome extension
// ------------------------------------------------------------------------------------------------

function pngInfo(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a', `${file} is a PNG`);
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

const YOUTUBE_MATCHES = ['*://youtube.com/*', '*://www.youtube.com/*', '*://m.youtube.com/*'];

describe('Chrome extension manifest.json', () => {
  test('is Manifest V3 with basic metadata', () => {
    assert.equal(manifest.manifest_version, 3);
    assert.equal(typeof manifest.name, 'string');
    assert.ok(manifest.name.length > 0 && manifest.name.length <= 75);
    assert.match(manifest.version, /^\d+(\.\d+){0,3}$/);
    assert.ok(manifest.description.length <= 132);
    assert.ok(Number(manifest.minimum_chrome_version) >= 111, 'world: MAIN needs Chrome 111+');
  });

  test('requests only the declarativeNetRequest permission and YouTube hosts', () => {
    assert.deepEqual(manifest.permissions, ['declarativeNetRequestWithHostAccess']);
    assert.deepEqual(manifest.host_permissions, YOUTUBE_MATCHES);
    assert.equal(manifest.optional_permissions, undefined);
    assert.equal(manifest.web_accessible_resources, undefined);
    assert.equal(manifest.background, undefined);
  });

  test('declares rules.json as its only static DNR ruleset', () => {
    const resources = manifest.declarative_net_request.rule_resources;
    assert.equal(resources.length, 1);
    assert.equal(resources[0].enabled, true);
    assert.ok(fs.existsSync(path.join(EXT_DIR, resources[0].path)));
  });

  test('content scripts run at document_start on YouTube only, with the history hook in the MAIN world', () => {
    const [hook, main] = manifest.content_scripts;
    assert.equal(manifest.content_scripts.length, 2);
    for (const entry of manifest.content_scripts) {
      assert.deepEqual(entry.matches, YOUTUBE_MATCHES);
      assert.equal(entry.run_at, 'document_start');
      assert.notEqual(entry.all_frames, true);
      for (const file of [...(entry.js || []), ...(entry.css || [])]) {
        assert.ok(fs.existsSync(path.join(EXT_DIR, file)), `${file} exists`);
      }
    }
    assert.deepEqual(hook.js, ['page-hook.js']);
    assert.equal(hook.world, 'MAIN');
    assert.deepEqual(main.js, ['content.js']);
    assert.deepEqual(main.css, ['content.css']);
    assert.equal(main.world, undefined, 'content.js stays in the isolated world');
  });

  test('icons exist with the declared sizes', () => {
    for (const [size, file] of Object.entries(manifest.icons)) {
      const info = pngInfo(path.join(EXT_DIR, file));
      assert.equal(info.width, Number(size));
      assert.equal(info.height, Number(size));
    }
  });

  test('blocker scripts make no network requests and use no eval/innerHTML', () => {
    for (const file of ['content.js', 'page-hook.js']) {
      const source = fs.readFileSync(path.join(EXT_DIR, file), 'utf8');
      const forbiddenUses = ['fetch(', 'XMLHttpRequest', 'import(', 'eval(', 'new Function', '.innerHTML', '.outerHTML', 'insertAdjacentHTML', 'sendBeacon', 'WebSocket', 'chrome.'];
      for (const forbidden of forbiddenUses) {
        assert.ok(!source.includes(forbidden), `${file} must not use ${forbidden}`);
      }
    }
  });

  test('content.css contains the shared hidden-marker rule and balanced braces', () => {
    const css = readText('chrome-extension/content.css');
    assert.match(css, /\[data-antishort-hidden\]\s*\{\s*display:\s*none !important;/);
    assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
  });
});

describe('Chrome extension rules.json', () => {
  test('has unique positive integer ids', () => {
    const ids = rules.map((rule) => rule.id);
    assert.ok(ids.every((id) => Number.isInteger(id) && id > 0));
    assert.equal(new Set(ids).size, ids.length);
  });

  test('every rule is a main-frame regex redirect to https://(www.|m.)youtube.com', () => {
    for (const rule of rules) {
      assert.equal(rule.action.type, 'redirect');
      assert.match(rule.action.redirect.regexSubstitution, /^https:\/\/\\1youtube\.com\//);
      assert.deepEqual(rule.condition.resourceTypes, ['main_frame']);
      assert.equal(rule.condition.isUrlFilterCaseSensitive, true);
      assert.equal(rule.condition.urlFilter, undefined);
      assert.ok(rule.condition.regexFilter.startsWith('^https?://(www\\.|m\\.|)youtube\\.com/'));
    }
  });

  test('regexes compile, avoid features RE2 lacks, and reference existing groups', () => {
    for (const rule of rules) {
      const pattern = rule.condition.regexFilter;
      assert.doesNotThrow(() => new RegExp(pattern));
      assert.doesNotMatch(pattern, /\(\?[=!<]|\\[1-9]/, 'no lookaround or backreferences (unsupported by RE2)');
      const groups = new RegExp(`${pattern}|`).exec('').length - 1;
      for (const ref of rule.action.redirect.regexSubstitution.match(/\\(\d)/g) || []) {
        assert.ok(Number(ref.slice(1)) <= groups, `${ref} exists in rule ${rule.id}`);
      }
    }
  });
});

// ------------------------------------------------------------------------------------------------
// Static validation: Expo app
// ------------------------------------------------------------------------------------------------

describe('Expo app configuration', () => {
  const appJson = readJson('mobile-app/app.json');
  const easJson = readJson('mobile-app/eas.json');
  const pkg = readJson('mobile-app/package.json');
  const expo = appJson.expo;

  test('app.json has a valid iOS app identity', () => {
    assert.equal(expo.name, 'AntiShort');
    assert.match(expo.slug, /^[a-z0-9-]+$/);
    assert.match(expo.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(expo.platforms, ['ios', 'android']);
    assert.match(expo.ios.bundleIdentifier, /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/);
    assert.match(expo.ios.buildNumber, /^\d+(\.\d+){0,2}$/);
    assert.equal(expo.ios.config.usesNonExemptEncryption, false);
  });

  test('app.json has a valid Android app identity', () => {
    // Java package rules: segments start with a letter, letters/digits/underscores only.
    assert.match(expo.android.package, /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/);
    assert.ok(Number.isInteger(expo.android.versionCode) && expo.android.versionCode >= 1);
  });

  test('Android: no runtime permissions, no backups, no cleartext HTTP', () => {
    const android = expo.android;
    // [] = only what the libraries need (INTERNET); everything a web page could ask for is removed
    // from the merged manifest as well.
    assert.deepEqual(android.permissions, []);
    for (const permission of [
      'CAMERA',
      'RECORD_AUDIO',
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'READ_EXTERNAL_STORAGE',
      'WRITE_EXTERNAL_STORAGE',
      'SYSTEM_ALERT_WINDOW',
    ]) {
      assert.ok(android.blockedPermissions.includes(`android.permission.${permission}`), permission);
    }
    assert.equal(android.allowBackup, false);
    // Cleartext traffic stays off (Android's default since API 28); nothing may switch it on.
    assert.equal(android.usesCleartextTraffic, undefined);
    assert.ok(!JSON.stringify(appJson).includes('usesCleartextTraffic'));
  });

  test('Android adaptive icon layers are 1024x1024 PNGs with transparency', () => {
    for (const key of ['foregroundImage', 'monochromeImage']) {
      const info = pngInfo(path.join(APP_DIR, expo.android.adaptiveIcon[key]));
      assert.deepEqual([info.width, info.height], [1024, 1024], key);
      assert.equal(info.colorType, 6, `${key}: RGBA`);
    }
    assert.match(expo.android.adaptiveIcon.backgroundColor, /^#[0-9A-Fa-f]{6}$/);
  });

  test('requests no device permissions and enforces strict TLS (App Transport Security)', () => {
    const infoPlist = expo.ios.infoPlist || {};
    assert.deepEqual(Object.keys(infoPlist).filter((key) => /UsageDescription$/.test(key)), []);
    // Replaces the template's ATS dictionary as a whole: no arbitrary, web-content or local-network
    // exceptions, and no per-domain exceptions.
    assert.deepEqual(infoPlist.NSAppTransportSecurity, { NSAllowsArbitraryLoads: false });
    assert.equal(expo.ios.entitlements, undefined);
    for (const file of ['src/BrowserScreen.tsx', 'src/navigationPolicy.ts']) {
      assert.ok(!readText(`mobile-app/${file}`).includes('NSAllowsArbitraryLoads'), file);
    }
  });

  test('app.json is either linked to an EAS project (eas init) or not linked at all', () => {
    // The repository ships linked to the maintainer's project; forks delete owner + extra.eas and
    // run `npx eas init`, which writes both back (docs/build-ios.md, step 3).
    const projectId = expo.extra && expo.extra.eas && expo.extra.eas.projectId;
    if (projectId === undefined) {
      assert.equal(expo.owner, undefined, 'owner without an EAS project id');
      return;
    }
    assert.match(projectId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    if (expo.owner !== undefined) assert.match(expo.owner, /^[a-z0-9][a-z0-9_-]*$/i);
  });

  test('no stray Expo/EAS config outside mobile-app (EAS must be run from mobile-app/)', () => {
    for (const file of ['app.json', 'app.config.js', 'app.config.ts', 'eas.json']) {
      assert.ok(!fs.existsSync(path.join(ROOT, file)), `${file} at the repository root`);
    }
    // EAS reads .easignore only at the git root; a copy inside mobile-app/ would be silently ignored.
    assert.ok(!fs.existsSync(path.join(APP_DIR, '.easignore')));
    const gitignore = readText('.gitignore');
    for (const entry of ['node_modules/', 'mobile-app/ios/', 'mobile-app/android/']) {
      assert.ok(gitignore.split(/\r?\n/).includes(entry), `.gitignore keeps ${entry} out of the EAS upload`);
    }
  });

  test('icon is a 1024x1024 PNG without alpha; splash image exists', () => {
    const icon = pngInfo(path.join(APP_DIR, expo.icon));
    assert.deepEqual([icon.width, icon.height], [1024, 1024]);
    assert.equal(icon.colorType, 2, 'RGB without alpha channel');
    const splash = expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen');
    assert.ok(splash, 'expo-splash-screen plugin configured');
    assert.ok(fs.existsSync(path.join(APP_DIR, splash[1].image)));
  });

  test('eas.json has an internal-distribution preview profile for real devices', () => {
    assert.equal(easJson.build.preview.distribution, 'internal');
    assert.notEqual(easJson.build.preview.ios && easJson.build.preview.ios.simulator, true);
    // An APK installs directly on any Android phone (the default, an app bundle, does not).
    assert.equal(easJson.build.preview.android.buildType, 'apk');
    assert.ok(['local', 'remote'].includes(easJson.cli.appVersionSource));
    assert.match(easJson.cli.version, /^>= \d+\.\d+\.\d+$/);
  });

  test('native dependencies use the versions Expo SDK pins (bundledNativeModules.json)', () => {
    const bundled = requireAppModule('expo/bundledNativeModules.json');
    const installedExpo = requireAppModule('expo/package.json').version;
    assert.match(installedExpo, /^58\./, 'Expo SDK 58');
    for (const [name, range] of Object.entries(pkg.dependencies)) {
      if (name === 'expo') continue;
      assert.equal(range, bundled[name], `${name} should be ${bundled[name]}`);
    }
    assert.equal(requireAppModule('react-native-webview/package.json').version, '14.0.1');
  });

  test('the WebView is configured to keep every navigation inside the policy', () => {
    const screen = readText('mobile-app/src/BrowserScreen.tsx');
    assert.match(screen, /const ROUTE_ALL_URLS_THROUGH_POLICY = \['\*'\];/);
    assert.match(screen, /originWhitelist=\{ROUTE_ALL_URLS_THROUGH_POLICY\}/);
    assert.match(screen, /onShouldStartLoadWithRequest=\{onShouldStartLoadWithRequest\}/);
    assert.match(screen, /onOpenWindow=\{onOpenWindow\}/);
    assert.match(screen, /injectedJavaScriptBeforeContentLoaded=\{BLOCKER_SCRIPT\}/);
    assert.match(screen, /injectedJavaScriptBeforeContentLoadedForMainFrameOnly\n/);
    assert.match(screen, /mediaCapturePermissionGrantType="deny"/);
    assert.match(screen, /allowsLinkPreview=\{false\}/);
    assert.doesNotMatch(screen, /onMessage=/, 'no JS bridge exposed to web pages');
    assert.doesNotMatch(screen, /applicationNameForUserAgent|userAgent=/, 'user agent is not spoofed');
  });

  test('Android: back button, re-injection, renderer loss and iOS-only APIs are handled', () => {
    const screen = readText('mobile-app/src/BrowserScreen.tsx');
    assert.match(screen, /BackHandler\.addEventListener\('hardwareBackPress'/);
    // Android evaluates the "before content loaded" script at onPageStarted; run it again on load.
    assert.match(screen, /injectedJavaScript=\{IS_ANDROID \? BLOCKER_SCRIPT : undefined\}/);
    assert.match(screen, /onRenderProcessGone=\{onRenderProcessGone\}/);
    assert.match(screen, /mixedContentMode="never"/);
    // Android lets a navigation through when the JS answer takes > 250 ms: onLoadStart re-checks it.
    const loadStart = screen.slice(screen.indexOf('const onLoadStart'), screen.indexOf('const onLoadProgress'));
    assert.match(loadStart, /if \(IS_ANDROID\) \{[\s\S]*decideNavigation\(url, true\)[\s\S]*stopLoading\(\)/);
    // Alert.prompt and ActionSheetIOS do nothing on Android: each use must sit behind an Android branch.
    for (const api of ['Alert.prompt(', 'ActionSheetIOS.showActionSheetWithOptions(']) {
      const index = screen.indexOf(api);
      assert.ok(index > 0, api);
      const before = screen.slice(Math.max(0, screen.lastIndexOf('useCallback(', index)), index);
      assert.match(before, /if \(IS_ANDROID\) \{[\s\S]*return;/, `${api} is skipped on Android`);
    }
    assert.match(readText('mobile-app/src/components/LinkPrompt.tsx'), /onRequestClose=\{onCancel\}/);
  });

  test('the injected blocker module is generated from the current extension sources', () => {
    assert.ok(appBlocker.isUpToDate(), 'run: node scripts/build-app-blocker.js');
    assert.doesNotThrow(() => new vm.Script(appBlocker.buildScript()));
  });
});
