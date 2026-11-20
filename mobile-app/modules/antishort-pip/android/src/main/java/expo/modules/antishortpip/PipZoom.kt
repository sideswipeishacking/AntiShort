package expo.modules.antishortpip

import android.app.Activity
import android.graphics.RectF
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.webkit.WebView
import android.widget.FrameLayout
import org.json.JSONArray
import kotlin.math.min

/**
 * What the picture-in-picture window shows, without the page ever noticing.
 *
 * Every view in the activity's content (the React Native root, and YouTube's fullscreen video view
 * if react-native-webview is showing one) is pinned at its full size while the window shrinks. So
 * neither React Native nor the page is laid out again: YouTube's player is never resized or hidden,
 * and the video keeps playing. The topmost pinned view is then scaled and shifted so that the video
 * fills the small window. (React Native can't do this itself: while Android keeps the activity paused
 * in picture-in-picture, it doesn't apply UI updates. And a page that shrinks makes YouTube pause.)
 *
 * The player's position comes from a read-only query of YouTube's player element. If YouTube's own
 * fullscreen view is showing, its video surface can't be scaled like a normal view (it would end up
 * outside the window), so the page is asked to leave fullscreen; the video continues in the page's
 * player, which is then scaled into the window. The fullscreen view stays pinned until it closes.
 */
internal class PipZoom private constructor(
  private val content: ViewGroup,
  private val root: View,
  private val webView: WebView,
) {
  /** Pinned views with their original LayoutParams. */
  private val pinned = ArrayList<Pair<View, ViewGroup.LayoutParams>>()

  /** Player rectangle in the root view's coordinates (px); null: not known. */
  private var player: RectF? = defaultPlayerRect()

  /** WebView visibility, size and position at the last player query. */
  private var queriedFor = ""

  /**
   * Every layout pass (window resized, fullscreen view removed, page moved): ask the page again if the
   * WebView changed, and rescale.
   */
  private val layoutListener = ViewTreeObserver.OnGlobalLayoutListener {
    val (x, y) = offsetInRoot(webView)
    val state = "${webView.isShown} ${webView.width}x${webView.height} $x,$y"
    if (state != queriedFor) {
      queriedFor = state
      queryPlayerRect()
    }
    apply()
  }

  private fun start() {
    for (i in 0 until content.childCount) pin(content.getChildAt(i))
    if (fullscreenView() != null) webView.evaluateJavascript(EXIT_FULLSCREEN_SCRIPT, null)
    content.viewTreeObserver.addOnGlobalLayoutListener(layoutListener)
    queryPlayerRect()
  }

  /**
   * Fixes [view] at its current size. The parent may become smaller than the view; it clips it. Same
   * LayoutParams class as before: the parent (a FrameLayout) casts to its own type.
   */
  private fun pin(view: View) {
    val saved = view.layoutParams ?: return
    if (view.width <= 0 || view.height <= 0) return
    val fixed = when (saved) {
      is FrameLayout.LayoutParams -> FrameLayout.LayoutParams(saved)
      is ViewGroup.MarginLayoutParams -> ViewGroup.MarginLayoutParams(saved)
      else -> ViewGroup.LayoutParams(saved)
    }
    fixed.width = view.width
    fixed.height = view.height
    view.layoutParams = fixed
    pinned.add(Pair(view, saved))
  }

  /** Back to normal: the views follow their parent again, without any scaling. */
  fun restore() {
    content.viewTreeObserver.removeOnGlobalLayoutListener(layoutListener)
    for ((view, saved) in pinned) {
      unscale(view)
      if (view.parent === content) view.layoutParams = saved
    }
    pinned.clear()
  }

  /** Scales the topmost view so the video fills the (smaller) window, centered. */
  private fun apply() {
    val width = content.width.toFloat()
    val height = content.height.toFloat()
    for ((view, _) in pinned) unscale(view)
    // The window hasn't shrunk (yet): show everything as it is.
    if (width <= 0f || height <= 0f || width >= root.width * 0.95f) return
    // YouTube's fullscreen view is closing (see start()); scale the page once it has gone.
    if (fullscreenView() != null) return
    val rect = player ?: return
    if (webView.isShown) fit(root, rect, width, height)
  }

  /** YouTube's fullscreen video view: react-native-webview adds it to the content, above the root. */
  private fun fullscreenView(): View? {
    for (i in content.childCount - 1 downTo 0) {
      val child = content.getChildAt(i)
      if (child !== root && child.visibility == View.VISIBLE && child.width > 0 && child.height > 0) return child
    }
    return null
  }

  private fun fit(view: View, rect: RectF, width: Float, height: Float) {
    if (rect.width() <= 0f || rect.height() <= 0f) return
    val scale = min(width / rect.width(), height / rect.height())
    view.pivotX = 0f
    view.pivotY = 0f
    view.scaleX = scale
    view.scaleY = scale
    view.translationX = (width - rect.width() * scale) / 2f - rect.left * scale
    view.translationY = (height - rect.height() * scale) / 2f - rect.top * scale
  }

  private fun unscale(view: View) {
    view.scaleX = 1f
    view.scaleY = 1f
    view.translationX = 0f
    view.translationY = 0f
  }

  /** Before the page answers: m.youtube.com's player sits under its 48 px header, 16:9, full width. */
  private fun defaultPlayerRect(): RectF {
    val density = webView.resources.displayMetrics.density
    val (x, y) = offsetInRoot(webView)
    val width = webView.width.toFloat()
    val top = y + HEADER_CSS_PX * density
    return RectF(x, top, x + width, top + width * 9f / 16f)
  }

  /** Asks the page where YouTube's player is (CSS px in the viewport), then converts to root px. */
  private fun queryPlayerRect() {
    webView.evaluateJavascript(PLAYER_RECT_SCRIPT) { result ->
      player = parsePlayerRect(result) ?: player
      apply()
    }
  }

  /** Null keeps the last known rectangle (e.g. during fullscreen, where the fullscreen view is used). */
  private fun parsePlayerRect(result: String?): RectF? {
    if (result == null || result == "null" || result.contains("fullscreen")) return null
    return try {
      val values = JSONArray(result)
      val density = webView.resources.displayMetrics.density
      val (x, y) = offsetInRoot(webView)
      val left = x + values.getDouble(0).toFloat() * density
      val top = y + values.getDouble(1).toFloat() * density
      RectF(left, top, left + values.getDouble(2).toFloat() * density, top + values.getDouble(3).toFloat() * density)
    } catch (e: Exception) {
      null
    }
  }

  /** Position of [view] inside the root, from layout positions (ignores the root's own scaling). */
  private fun offsetInRoot(view: View): Pair<Float, Float> {
    var x = 0f
    var y = 0f
    var current: View? = view
    while (current != null && current !== root) {
      x += current.left - current.scrollX
      y += current.top - current.scrollY
      current = current.parent as? View
    }
    return Pair(x, y)
  }

  companion object {
    private const val HEADER_CSS_PX = 48f

    /**
     * Read-only: where YouTube's player is, as [left, top, width, height] in CSS px, "fullscreen", or
     * null. Does nothing outside YouTube.
     */
    const val PLAYER_RECT_SCRIPT =
      "(function () {" +
        " var h = String(location.hostname).toLowerCase();" +
        " if (!(h === 'youtube.com' || /\\.youtube\\.com$/.test(h))) return null;" +
        " if (document.fullscreenElement || document.webkitFullscreenElement) return 'fullscreen';" +
        " var e = document.querySelector('#movie_player') || document.querySelector('video');" +
        " if (!e) return null;" +
        " var r = e.getBoundingClientRect();" +
        " if (r.width < 1 || r.height < 1) return null;" +
        " return [r.left, r.top, r.width, r.height];" +
        " })()"

    /** Leaves YouTube's fullscreen mode (the page's own Fullscreen API). Does nothing outside YouTube. */
    const val EXIT_FULLSCREEN_SCRIPT =
      "(function () {" +
        " var h = String(location.hostname).toLowerCase();" +
        " if (!(h === 'youtube.com' || /\\.youtube\\.com$/.test(h))) return;" +
        " if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();" +
        " else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();" +
        " })()"

    /** Pins the activity's content views and starts following the window; null if the layout isn't as expected. */
    fun start(activity: Activity): PipZoom? {
      val content = activity.findViewById<ViewGroup>(android.R.id.content) ?: return null
      val root = content.getChildAt(0) ?: return null
      if (root.width <= 0 || root.height <= 0) return null
      val webView = findWebView(root) ?: return null
      return PipZoom(content, root, webView).also { it.start() }
    }

    /** The app's WebView (the React Native root is the first child of the activity's content view). */
    fun findWebView(activity: Activity): WebView? {
      val content = activity.findViewById<ViewGroup>(android.R.id.content) ?: return null
      return content.getChildAt(0)?.let { findWebView(it) }
    }

    /** The page's WebView, also while it is hidden behind YouTube's fullscreen view. */
    private fun findWebView(view: View): WebView? {
      if (view is WebView) return view
      if (view is ViewGroup) {
        for (i in 0 until view.childCount) {
          findWebView(view.getChildAt(i))?.let { return it }
        }
      }
      return null
    }
  }
}
