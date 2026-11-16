/*
 * AntiShort page hook.
 *
 * Runs in the page's own JavaScript world (Chrome: content script with "world": "MAIN";
 * iOS app: bundled ahead of content.js). Content scripts in Chrome's isolated world cannot see
 * the page calling history.pushState/replaceState, which is how YouTube's single-page app
 * navigates, so this file wraps those two functions and reports each call as DOM events:
 *
 *   "antishort:beforenavigate"  cancelable, detail = absolute target URL (string), fired before
 *                               the call. If a listener cancels it, the call is skipped because
 *                               the blocker is already redirecting to the regular watch page.
 *   "antishort:locationchange"  fired after the call.
 *
 * It contains no blocking logic, makes no network requests, and only runs on YouTube hosts.
 */
(function () {
  'use strict';

  var host = String(location.hostname).toLowerCase();
  if (host !== 'youtube.com' && host !== 'www.youtube.com' && host !== 'm.youtube.com') return;
  if (window.__antishortHistoryHook) return;
  Object.defineProperty(window, '__antishortHistoryHook', { value: true });

  var history = window.history;

  function absolute(url) {
    try {
      return new URL(String(url), location.href).href;
    } catch (e) {
      return null;
    }
  }

  function wrap(name) {
    var original = history[name];
    if (typeof original !== 'function') return;
    history[name] = function (state, unused, url) {
      if (url !== undefined && url !== null) {
        var target = absolute(url);
        var allowed = !target || window.dispatchEvent(
          new CustomEvent('antishort:beforenavigate', { detail: target, cancelable: true })
        );
        if (!allowed) return undefined;
      }
      var result = original.apply(this, arguments);
      window.dispatchEvent(new Event('antishort:locationchange'));
      return result;
    };
  }

  wrap('pushState');
  wrap('replaceState');
})();
