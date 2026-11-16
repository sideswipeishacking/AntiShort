/**
 * Navigation policy for the in-app WebView.
 *
 * Pure functions only (no React Native imports) so test.js can run this file under Node.
 * Every navigation the WebView attempts goes through decideNavigation(); nothing is opened
 * outside the app unless the user explicitly taps "Open in Safari" in the prompt.
 */

/** Start page. The mobile site is what YouTube serves to an iPhone WebView anyway. */
export const HOME_URL = 'https://m.youtube.com/';

/** Hosts that serve Shorts. Keep in sync with SHORTS_HOSTS in chrome-extension/content.js. */
const SHORTS_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com'];

/**
 * Google's account pages, allowed so you can sign in to YouTube (needed for Subscriptions).
 * The blocker script never runs there, and Google may refuse sign-in inside embedded browsers.
 */
const SIGN_IN_HOSTS = ['accounts.google.com'];

/** Schemes a sub-frame (video player, ads, sign-in helpers) may load. */
const SUBFRAME_SCHEMES = ['https:', 'http:', 'about:', 'blob:', 'data:'];

export type BlockReason = 'external-site' | 'unsupported-scheme' | 'invalid-url';

export type NavigationDecision =
  | { action: 'allow' }
  | { action: 'redirect'; target: string; reason: 'shorts' | 'https' }
  | { action: 'block'; reason: BlockReason; url: string; host: string | null; notify: boolean };

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** youtube.com, any *.youtube.com (www, m, music, consent, accounts) and the youtu.be short links. */
export function isYouTubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
}

export function isSignInHost(hostname: string): boolean {
  return SIGN_IN_HOSTS.includes(hostname.toLowerCase());
}

/** True for http(s) URLs on a YouTube host. */
export function isYouTubeUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const parsed = parse(url);
  return !!parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:') && isYouTubeHost(parsed.hostname);
}

/**
 * Where a Shorts URL should go instead, or null if it is not a Shorts route.
 * TypeScript twin of classifyShortsUrl() in chrome-extension/content.js; test.js runs both
 * (and rules.json) against the same cases.
 *   /shorts/<id>     -> https://<host>/watch?v=<id>
 *   /shorts          -> https://<host>/
 *   /@x/shorts etc.  -> https://<host>/@x/videos
 */
export function getShortsRedirect(url: string): string | null {
  const parsed = parse(url);
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return null;
  const host = parsed.hostname.toLowerCase();
  if (!SHORTS_HOSTS.includes(host)) return null;
  const origin = `https://${host}`;
  const path = parsed.pathname;

  const video = /^\/shorts\/([A-Za-z0-9_-]+)\/?$/.exec(path);
  if (video) return `${origin}/watch?v=${video[1]}`;
  if (/^\/shorts\/?$/.test(path)) return `${origin}/`;
  const channel = /^\/(@[^/]+|(?:channel|c|user)\/[^/]+)\/shorts\/?$/.exec(path);
  if (channel) return `${origin}/${channel[1]}/videos`;
  return null;
}

/**
 * Decides what to do with a navigation request from the WebView.
 * Top-frame navigations: YouTube hosts (Shorts redirected, http upgraded) and Google sign-in are
 * allowed; everything else is blocked and the user is told. Sub-frames (embedded players, ads,
 * sign-in helpers) may load web content but never app-launching schemes; the blocker script is
 * main-frame only, so nothing is injected into them.
 */
export function decideNavigation(url: string, isTopFrame: boolean): NavigationDecision {
  if (url === 'about:blank' || url === 'about:srcdoc') return { action: 'allow' };

  const parsed = parse(url);
  if (!parsed) return { action: 'block', reason: 'invalid-url', url, host: null, notify: isTopFrame };
  const scheme = parsed.protocol.toLowerCase();

  if (!isTopFrame) {
    return SUBFRAME_SCHEMES.includes(scheme)
      ? { action: 'allow' }
      : { action: 'block', reason: 'unsupported-scheme', url, host: null, notify: false };
  }

  if (scheme !== 'https:' && scheme !== 'http:') {
    return { action: 'block', reason: 'unsupported-scheme', url, host: null, notify: true };
  }

  const host = parsed.hostname.toLowerCase();
  if (isYouTubeHost(host) || isSignInHost(host)) {
    const shorts = getShortsRedirect(url);
    if (shorts) return { action: 'redirect', target: shorts, reason: 'shorts' };
    if (scheme === 'http:') {
      // App Transport Security stays on; upgrade instead of loading plain HTTP.
      return { action: 'redirect', target: `https:${url.slice(url.indexOf(':') + 1)}`, reason: 'https' };
    }
    return { action: 'allow' };
  }

  return { action: 'block', reason: 'external-site', url, host, notify: true };
}

/**
 * Turns what the user typed or pasted into a URL to try ("youtube.com/shorts/x" -> "https://...").
 * Returns null for empty input. The result still goes through decideNavigation().
 */
export function normalizeUserUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  return /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
}

/**
 * JavaScript that sends the current YouTube page to `target`. The snippet re-checks the host
 * itself, so it does nothing if the page turned out not to be YouTube.
 */
export function buildNavigationScript(target: string): string {
  const literal = JSON.stringify(target)
    .split(String.fromCharCode(0x2028)).join('\\u2028')
    .split(String.fromCharCode(0x2029)).join('\\u2029');
  return (
    '(function () {' +
    ' var h = String(location.hostname).toLowerCase();' +
    " if (h === 'youtube.com' || /\\.youtube\\.com$/.test(h)) { location.assign(" + literal + '); }' +
    ' })(); true;'
  );
}
