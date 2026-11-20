package expo.modules.antishortpip

import android.app.Activity
import android.content.Context
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/**
 * Hooks the main activity: watch picture-in-picture mode on create, undo the zoom and check the
 * page while in front (resume/pause), auto-enter on the Home button/gesture.
 */
class AntiShortPipPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context?): List<ReactActivityLifecycleListener> =
    listOf(
      object : ReactActivityLifecycleListener {
        override fun onCreate(activity: Activity?, savedInstanceState: Bundle?) {
          PipState.register(activity)
        }

        override fun onResume(activity: Activity?) {
          PipState.onResume(activity)
        }

        override fun onPause(activity: Activity?) {
          PipState.onPause(activity)
        }

        override fun onUserLeaveHint(activity: Activity?) {
          PipState.onUserLeaveHint(activity)
        }
      },
    )
}
