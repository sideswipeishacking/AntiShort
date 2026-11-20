package expo.modules.antishortpip

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Rational
import androidx.activity.ComponentActivity
import java.lang.ref.WeakReference
import java.util.Collections
import java.util.WeakHashMap

/**
 * Picture-in-picture for the whole activity. Android's WebView has no HTML picture-in-picture, so
 * the app's activity itself shrinks into the floating window; PipZoom makes the video player fill it.
 * Shared by the JS-facing module and the activity lifecycle listener. State lives on the main thread.
 */
internal object PipState {
  private const val POLL_MS = 700L

  /**
   * Read-only: is YouTube's video playing right now? Does nothing outside YouTube. Asked by the page
   * check below; audio focus or "music active" can't tell, because Android keeps a paused video's
   * audio stream open for about 10 seconds and counts other apps' music too.
   */
  const val VIDEO_PLAYING_SCRIPT =
    "(function () {" +
      " var h = String(location.hostname).toLowerCase();" +
      " if (!(h === 'youtube.com' || /\\.youtube\\.com$/.test(h))) return false;" +
      " var v = document.querySelector('video.html5-main-video') || document.querySelector('video');" +
      " return !!(v && !v.paused && !v.ended && v.readyState > 2);" +
      " })()"

  private val main = Handler(Looper.getMainLooper())
  private val registered = Collections.newSetFromMap(WeakHashMap<Activity, Boolean>())

  /** Set from JS: true while a YouTube video page is open. */
  @Volatile
  var autoEnterEnabled = false
    set(value) {
      field = value
      main.post { updatePageCheck() }
    }

  /** The activity while it is in the foreground (main thread). */
  private var resumed: WeakReference<Activity>? = null

  /** Result of the latest page check: the video is playing (main thread). */
  private var videoPlaying = false
  private var checking = false

  /** While a video page is open and the app is in front, ask the page whether its video plays. */
  private val pageCheck = object : Runnable {
    override fun run() {
      val activity = resumed?.get()
      if (!autoEnterEnabled || activity == null) {
        checking = false
        videoPlaying = false
        return
      }
      PipZoom.findWebView(activity)?.evaluateJavascript(VIDEO_PLAYING_SCRIPT) { result ->
        videoPlaying = result == "true"
      }
      main.postDelayed(this, POLL_MS)
    }
  }

  /** Active while the app is (or is about to be) in the picture-in-picture window. */
  private var zoom: PipZoom? = null

  fun isSupported(activity: Activity?): Boolean =
    activity != null &&
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

  /** Shrinks the activity into a 16:9 floating window. False if the device or the user's settings don't allow it. */
  fun enter(activity: Activity?): Boolean {
    if (activity == null || !isSupported(activity) || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    if (activity.isInPictureInPictureMode) return true
    // Pin the layout before the window shrinks, so the page is never resized (see PipZoom).
    val pending = PipZoom.start(activity)
    val entered = try {
      activity.enterPictureInPictureMode(
        PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build(),
      )
    } catch (e: RuntimeException) {
      // IllegalStateException when picture-in-picture is turned off for this app in system settings.
      false
    }
    if (entered) {
      zoom?.restore()
      zoom = pending
    } else {
      pending?.restore()
    }
    return entered
  }

  /** Watches the activity's picture-in-picture mode (once per activity) to undo the zoom on exit. */
  fun register(activity: Activity?) {
    val component = activity as? ComponentActivity ?: return
    if (!registered.add(component)) return
    component.addOnPictureInPictureModeChangedListener { info ->
      if (!info.isInPictureInPictureMode) restore()
    }
  }

  /** Back in the full app (also if a picture-in-picture request never completed). */
  fun onResume(activity: Activity?) {
    if (activity == null) return
    if (!activity.isInPictureInPictureMode) restore()
    resumed = WeakReference(activity)
    updatePageCheck()
  }

  /** Leaving the foreground: stop asking the page (the check loop ends on its next run). */
  fun onPause(activity: Activity?) {
    if (resumed?.get() === activity) resumed = null
  }

  /**
   * Home button or gesture (called before onPause): go into picture-in-picture when a video page is
   * open and its video is playing, so a paused video doesn't pop up a floating window.
   */
  fun onUserLeaveHint(activity: Activity?) {
    if (activity == null || !autoEnterEnabled || !videoPlaying) return
    enter(activity)
  }

  private fun updatePageCheck() {
    if (checking || !autoEnterEnabled || resumed?.get() == null) return
    checking = true
    main.post(pageCheck)
  }

  private fun restore() {
    zoom?.restore()
    zoom = null
  }
}
