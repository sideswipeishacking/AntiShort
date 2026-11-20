/**
 * Picture-in-picture helpers. Pure strings and functions (no React Native imports) so test.js can
 * check them under Node.
 *
 * iPhone: WebKit's own video picture-in-picture. YouTube's page allows it (its <video> does not set
 * disablePictureInPicture). The toolbar button asks the page's video to switch presentation mode;
 * YouTube's fullscreen player also has the system picture-in-picture button.
 *
 * Android: WebView has no HTML picture-in-picture, so the whole activity shrinks into the floating
 * window (modules/antishort-pip), which also makes the player fill that window. The page itself is
 * not changed.
 *
 * Nothing here works around YouTube: if YouTube pauses or blocks playback, that stays as it is.
 */

/** YouTube hosts whose watch pages the app treats as video pages. */
const VIDEO_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com'];

/** True for a YouTube video page (/watch?v=… or /live/…), where picture-in-picture makes sense. */
export function isVideoPageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || !VIDEO_HOSTS.includes(parsed.hostname.toLowerCase())) return false;
  // `search`, not `searchParams`: Expo's minimal URL polyfill on the phone is the URL class in use.
  return (parsed.pathname === '/watch' && /[?&]v=[^&]+/.test(parsed.search)) || /^\/live\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname);
}

/**
 * iPhone toolbar button: switch YouTube's video into WebKit's picture-in-picture, or back. Runs
 * through WKWebView's evaluateJavaScript, which counts as a user action. Does nothing when the page
 * has no video or WebKit doesn't offer picture-in-picture for it.
 */
export const IOS_PIP_TOGGLE_SCRIPT =
  '(function () {' +
  ' var h = String(location.hostname).toLowerCase();' +
  " if (!(h === 'youtube.com' || /\\.youtube\\.com$/.test(h))) return;" +
  " var v = document.querySelector('video.html5-main-video') || document.querySelector('video');" +
  " if (!v || typeof v.webkitSetPresentationMode !== 'function') return;" +
  " if (typeof v.webkitSupportsPresentationMode === 'function' && !v.webkitSupportsPresentationMode('picture-in-picture')) return;" +
  " v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');" +
  ' })(); true;';
