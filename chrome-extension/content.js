/*
 * AntiShort - YouTube Shorts blocker core.
 *
 * This one file is used by both deliverables:
 *   - Chrome extension: isolated-world content script at document_start (see manifest.json).
 *     page-hook.js runs in the page's MAIN world and reports history.pushState/replaceState
 *     calls to this script through DOM events.
 *   - iOS app: scripts/build-ios-blocker.js bundles page-hook.js + this file + content.css into
 *     ios-app/src/blocker/blockerScript.generated.ts, which the WebView injects at document
 *     start (main frame only).
 *
 * Under Node (test.js) there is no window/document: the file only exports its pure URL helpers.
 *
 * Constraints: no network access, no eval, no innerHTML (YouTube enforces Trusted Types), and
 * nothing outside youtube.com / www.youtube.com / m.youtube.com is ever touched.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------------------------
  // Pure URL helpers (unit-tested by test.js against the same cases as rules.json and the app).
  // ---------------------------------------------------------------------------------------------

  /** Hosts that serve Shorts. music.youtube.com has no Shorts and is left alone. */
  var SHORTS_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com'];
  var SHORTS_VIDEO_PATH = /^\/shorts\/([A-Za-z0-9_-]+)\/?$/;
  var SHORTS_ROOT_PATH = /^\/shorts\/?$/;
  var CHANNEL_SHORTS_PATH = /^\/(@[^/]+|(?:channel|c|user)\/[^/]+)\/shorts\/?$/;

  function parseUrl(input, base) {
    if (input === null || input === undefined || input === '') return null;
    try {
      return base ? new URL(String(input), base) : new URL(String(input));
    } catch (e) {
      return null;
    }
  }

  function isShortsHost(hostname) {
    return SHORTS_HOSTS.indexOf(String(hostname || '').toLowerCase()) !== -1;
  }

  /**
   * Classifies a URL as a Shorts route on a YouTube host, or returns null.
   *   /shorts/<id>                         -> { kind: 'video', target: https://<host>/watch?v=<id> }
   *   /shorts                              -> { kind: 'root', target: https://<host>/ }
   *   /@handle/shorts, /channel/<id>/shorts, /c/<name>/shorts, /user/<name>/shorts
   *                                        -> { kind: 'channel-tab', target: .../<channel>/videos }
   * The host is kept (www stays www, m stays m), http is upgraded to https, and the query string
   * and fragment of the Shorts URL are dropped.
   */
  function classifyShortsUrl(input, base) {
    var url = parseUrl(input, base);
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null;
    if (!isShortsHost(url.hostname)) return null;
    var origin = 'https://' + url.hostname.toLowerCase();
    var path = url.pathname;
    var match = SHORTS_VIDEO_PATH.exec(path);
    if (match) {
      return { kind: 'video', videoId: match[1], target: origin + '/watch?v=' + match[1] };
    }
    if (SHORTS_ROOT_PATH.test(path)) {
      return { kind: 'root', target: origin + '/' };
    }
    match = CHANNEL_SHORTS_PATH.exec(path);
    if (match) {
      return { kind: 'channel-tab', target: origin + '/' + match[1] + '/videos' };
    }
    return null;
  }

  /** Returns the URL a Shorts route should be sent to, or null if the URL is not a Shorts route. */
  function getShortsRedirect(input, base) {
    var result = classifyShortsUrl(input, base);
    return result ? result.target : null;
  }

  var api = {
    SHORTS_HOSTS: SHORTS_HOSTS.slice(),
    isShortsHost: isShortsHost,
    classifyShortsUrl: classifyShortsUrl,
    getShortsRedirect: getShortsRedirect
  };

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    return;
  }

  start(window, document);

  // ---------------------------------------------------------------------------------------------
  // Browser runtime
  // ---------------------------------------------------------------------------------------------

  function start(win, doc) {
    var loc = win.location;
    if (!isShortsHost(loc.hostname)) return; // never act on anything but YouTube
    if (win.__antishortActive) return; // already running in this document
    win.__antishortActive = true;

    var ATTR_HIDDEN = 'data-antishort-hidden';
    var ATTR_REWRITTEN = 'data-antishort-rewritten';
    var SCAN_THROTTLE_MS = 250;
    var REDIRECT_GUARD_MS = 3000;
    // Set only by the iOS bundle; the Chrome extension ships content.css through the manifest.
    /* global ANTISHORT_INJECT_CSS */
    var injectedCss = typeof ANTISHORT_INJECT_CSS === 'string' ? ANTISHORT_INJECT_CSS : '';

    // Containers. Desktop uses ytd-*, the mobile site (m.youtube.com, also used by the iOS app) ytm-*.
    var ITEM_WRAPPERS = 'ytd-rich-item-renderer, ytm-rich-item-renderer';
    var CARDS = [
      'ytd-video-renderer', 'ytd-grid-video-renderer', 'ytd-compact-video-renderer',
      'ytd-playlist-video-renderer', 'ytd-playlist-panel-video-renderer', 'ytd-reel-item-renderer',
      'ytd-notification-renderer', 'yt-lockup-view-model',
      'ytm-shorts-lockup-view-model-v2', 'ytm-shorts-lockup-view-model',
      'ytm-video-with-context-renderer', 'ytm-compact-video-renderer', 'ytm-reel-item-renderer',
      'ytm-playlist-video-renderer', 'ytm-video-card-renderer'
    ].join(', ');
    // Shelves that only ever contain Shorts.
    var SHORTS_SHELVES = 'ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts], ytm-reel-shelf-renderer';
    // Tiles that only ever represent a Short.
    var SHORTS_TILES = 'ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytd-reel-item-renderer, ytm-reel-item-renderer';
    // Shorts-specific thumbnail badges inside otherwise generic cards.
    var SHORTS_BADGES = 'ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"], ytm-thumbnail-overlay-time-status-renderer[data-style="SHORTS"]';
    // Shelves that can hold Shorts or regular videos: hidden only when they hold Shorts and no videos.
    var MIXED_SHELVES = 'grid-shelf-view-model, ytd-shelf-renderer, ytd-horizontal-card-list-renderer, ytm-shelf-renderer, ytm-horizontal-card-list-renderer';
    // Wrappers around exactly one shelf.
    var SECTION_WRAPPERS = 'ytd-rich-section-renderer, ytm-rich-section-renderer';
    // Navigation entries, tabs and chips that may be the Shorts entry.
    var NAV_ENTRIES = [
      'ytd-guide-entry-renderer', 'ytd-mini-guide-entry-renderer', 'ytm-pivot-bar-item-renderer',
      'yt-tab-shape', 'tp-yt-paper-tab', 'yt-chip-cloud-chip-renderer', 'ytm-chip-cloud-chip-renderer'
    ].join(', ');
    // Links inside these are text links (descriptions, comments, posts): rewritten, never hidden.
    var TEXT_CONTAINERS = [
      '.yt-core-attributed-string', 'yt-formatted-string', 'yt-attributed-string', '#description',
      '#content-text', 'ytd-text-inline-expander', 'ytd-comment-view-model', 'ytd-comment-renderer',
      'ytm-comment-renderer', 'ytd-post-renderer', 'ytd-backstage-post-renderer', 'ytm-backstage-post-renderer'
    ].join(', ');
    var CHANNEL_LINK = /^\/(@|channel\/|c\/|user\/)/;

    // ----- Redirects --------------------------------------------------------------------------

    var redirectGuardUntil = 0;

    function go(target, replace) {
      var now = Date.now();
      if (now < redirectGuardUntil) return;
      redirectGuardUntil = now + REDIRECT_GUARD_MS;
      try {
        if (replace) loc.replace(target);
        else loc.assign(target);
      } catch (e) {
        redirectGuardUntil = 0;
      }
    }

    /**
     * mode 'current': the Shorts URL is already the document/history entry -> replace it.
     * mode 'pending': a navigation to it has not committed yet -> navigate with a new entry.
     */
    function redirectIfShorts(href, mode) {
      var result = classifyShortsUrl(href, loc.href);
      if (!result) return false;
      go(result.target, mode === 'current');
      return true;
    }

    function checkCurrentLocation() {
      redirectIfShorts(loc.href, 'current');
    }

    function onRouteChange() {
      checkCurrentLocation();
      scheduleScan();
    }

    /** URL from a yt-navigate-start event, if YouTube exposes one (it does in the page world). */
    function navigateEventUrl(event) {
      try {
        var detail = event.detail;
        if (!detail || typeof detail !== 'object') return null;
        if (typeof detail.url === 'string') return detail.url;
        var endpoint = detail.endpoint;
        var meta = endpoint && endpoint.commandMetadata && endpoint.commandMetadata.webCommandMetadata;
        return meta && typeof meta.url === 'string' ? meta.url : null;
      } catch (e) {
        return null;
      }
    }

    function findAnchor(event) {
      var path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      for (var i = 0; i < path.length; i++) {
        var node = path[i];
        if (node && node.nodeType === 1 && node.tagName === 'A' && node.hasAttribute('href')) return node;
      }
      var target = event.target;
      return target && target.closest ? target.closest('a[href]') : null;
    }

    /** The Shorts URL behind a link, including links this script already rewrote. */
    function shortsUrlOfAnchor(anchor) {
      var original = anchor.getAttribute(ATTR_REWRITTEN);
      if (original && isCurrentRewrite(anchor, original)) return original;
      return anchor.getAttribute('href');
    }

    function absolute(href) {
      var url = parseUrl(href, loc.href);
      return url ? url.href : null;
    }

    function isCurrentRewrite(anchor, original) {
      var target = getShortsRedirect(original, loc.href);
      return !!target && target === absolute(anchor.getAttribute('href'));
    }

    // ----- Hiding ---------------------------------------------------------------------------------

    function hide(el) {
      if (!el.hasAttribute(ATTR_HIDDEN)) el.setAttribute(ATTR_HIDDEN, '');
      if (el.style.getPropertyValue('display') !== 'none') el.style.setProperty('display', 'none', 'important');
    }

    function unhide(el) {
      el.removeAttribute(ATTR_HIDDEN);
      if (el.style.getPropertyValue('display') === 'none' && el.style.getPropertyPriority('display') === 'important') {
        el.style.removeProperty('display');
      }
    }

    function rewrite(anchor, original, target) {
      if (anchor.getAttribute('href') !== target) anchor.setAttribute('href', target);
      if (anchor.getAttribute(ATTR_REWRITTEN) !== original) anchor.setAttribute(ATTR_REWRITTEN, original);
    }

    function cardFor(el) {
      return el.closest(ITEM_WRAPPERS) || el.closest(CARDS);
    }

    function label(el) {
      var text = el.getAttribute('tab-title') || el.getAttribute('aria-label') || '';
      if (!text) {
        var titled = el.querySelector('a[title]');
        text = (titled && titled.getAttribute('title')) || el.textContent || '';
      }
      return text.replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function isShortsNavEntry(el) {
      if (el.matches('ytm-pivot-bar-item-renderer') && el.querySelector('.pivot-shorts')) return true;
      if (label(el) !== 'shorts') return false;
      // A subscribed channel that happens to be called "Shorts" links to /@..., not to the feature.
      var link = el.querySelector('a[href]');
      return !(link && CHANNEL_LINK.test(link.getAttribute('href') || ''));
    }

    /** True when a container shows Shorts and no regular videos (text links in posts don't count). */
    function holdsOnlyShorts(container) {
      var hasShorts = !!container.querySelector(SHORTS_TILES);
      if (!hasShorts) {
        var links = container.querySelectorAll('a[href*="/shorts/"]');
        for (var i = 0; i < links.length && !hasShorts; i++) {
          hasShorts = !links[i].closest(TEXT_CONTAINERS);
        }
      }
      return hasShorts && !container.querySelector('a[href*="/watch?"]');
    }

    function each(selector, fn) {
      var nodes = doc.querySelectorAll(selector);
      for (var i = 0; i < nodes.length; i++) fn(nodes[i]);
    }

    function scan() {
      var keep = new Set();
      function add(el) {
        if (el) keep.add(el);
      }

      // 1. Elements that are Shorts by definition.
      each(SHORTS_SHELVES, add);
      each(SHORTS_TILES, function (el) {
        add(el.closest(ITEM_WRAPPERS) || el);
      });
      each(SHORTS_BADGES, function (el) {
        add(cardFor(el));
      });

      // 2. Links to Shorts.
      each('a[href*="/shorts"]', function (anchor) {
        var href = anchor.getAttribute('href');
        var result = classifyShortsUrl(href, loc.href);
        if (!result) return;
        if (anchor.closest(TEXT_CONTAINERS)) {
          rewrite(anchor, href, result.target);
          return;
        }
        if (result.kind === 'video') {
          var card = cardFor(anchor);
          if (card) add(card);
          else rewrite(anchor, href, result.target);
          return;
        }
        // /shorts or /@channel/shorts: the Shorts feed entry or a channel's Shorts tab.
        var nav = anchor.closest(NAV_ENTRIES);
        if (nav) add(nav);
        else if (anchor.getAttribute('role') === 'tab' || anchor.closest('[role="tablist"]')) add(anchor);
        else rewrite(anchor, href, result.target);
      });

      // 3. Labelled Shorts entries: guide/sidebar, mobile pivot bar, channel tabs, chips.
      each(NAV_ENTRIES, function (el) {
        if (isShortsNavEntry(el)) add(el);
      });

      // 4. Shelves that can hold anything: hide only when they hold Shorts and no regular videos.
      each(MIXED_SHELVES, function (el) {
        if (holdsOnlyShorts(el)) add(el);
      });
      each(SECTION_WRAPPERS, function (el) {
        if (el.querySelector(SHORTS_SHELVES) || holdsOnlyShorts(el)) add(el);
      });

      // Apply: unhide anything YouTube recycled into a regular item, then hide the current set.
      each('[' + ATTR_HIDDEN + ']', function (el) {
        if (!keep.has(el)) unhide(el);
      });
      keep.forEach(hide);

      // Drop stale rewrite markers on links YouTube reused for something else.
      each('a[' + ATTR_REWRITTEN + ']', function (anchor) {
        if (!isCurrentRewrite(anchor, anchor.getAttribute(ATTR_REWRITTEN))) anchor.removeAttribute(ATTR_REWRITTEN);
      });
    }

    // ----- Styles (iOS bundle only) -------------------------------------------------------------

    var styleEl = null;

    function needsStyle() {
      return !!injectedCss && !(styleEl && styleEl.isConnected);
    }

    function ensureStyle() {
      if (!needsStyle()) return;
      // At document start the root element may not exist yet; the MutationObserver retries.
      var parent = doc.head || doc.documentElement;
      if (!parent) return;
      if (!styleEl) {
        styleEl = doc.createElement('style');
        styleEl.setAttribute('data-antishort', '');
        styleEl.textContent = injectedCss;
      }
      parent.appendChild(styleEl);
    }

    function tryEnsureStyle() {
      try {
        ensureStyle();
      } catch (e) {
        // Hiding still works through the inline styles set by scan().
      }
    }

    // ----- Throttled scanning ---------------------------------------------------------------------

    var scanTimer = 0;
    var lastScanAt = 0;
    var warned = false;

    function scheduleScan() {
      if (scanTimer) return;
      var wait = Math.max(0, lastScanAt + SCAN_THROTTLE_MS - Date.now());
      scanTimer = win.setTimeout(runScan, wait);
    }

    function runScan() {
      scanTimer = 0;
      lastScanAt = Date.now();
      try {
        ensureStyle();
        scan();
      } catch (e) {
        if (!warned && win.console) {
          warned = true;
          win.console.warn('[AntiShort] scan failed', e);
        }
      }
    }

    var observer = new MutationObserver(function (records) {
      // Runs before the next paint, so the stylesheet lands as soon as <html>/<head> exist.
      if (needsStyle()) tryEnsureStyle();
      for (var i = 0; i < records.length; i++) {
        var record = records[i];
        if (record.type === 'attributes') {
          scheduleScan();
          return;
        }
        var added = record.addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) {
            scheduleScan();
            return;
          }
        }
      }
    });

    // ----- Wiring -----------------------------------------------------------------------------------
    // Listeners are registered first so that nothing below can prevent them from being installed.

    // History API calls reported by page-hook.js, before they happen. Cancelling skips the call.
    win.addEventListener('antishort:beforenavigate', function (event) {
      if (typeof event.detail === 'string' && redirectIfShorts(event.detail, 'pending')) event.preventDefault();
    }, true);
    win.addEventListener('antishort:locationchange', onRouteChange, true);
    win.addEventListener('popstate', onRouteChange, true);
    win.addEventListener('pageshow', onRouteChange, true);

    // YouTube's own SPA navigation events (capture on window sees them wherever they are dispatched).
    win.addEventListener('yt-navigate-start', function (event) {
      var href = navigateEventUrl(event);
      if (!(href && redirectIfShorts(href, 'pending'))) checkCurrentLocation();
    }, true);
    win.addEventListener('yt-navigate-finish', onRouteChange, true);
    win.addEventListener('yt-page-data-updated', onRouteChange, true);

    // Plain clicks on Shorts links go straight to the regular player instead of the Shorts player.
    win.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var anchor = findAnchor(event);
      if (!anchor) return;
      var result = classifyShortsUrl(shortsUrlOfAnchor(anchor), loc.href);
      if (!result) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      go(result.target, false);
    }, true);

    observer.observe(doc, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'is-shorts', 'overlay-style', 'data-style', 'tab-title']
    });
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', onRouteChange, { once: true });

    tryEnsureStyle();
    checkCurrentLocation();
    scheduleScan();
  }
})();
