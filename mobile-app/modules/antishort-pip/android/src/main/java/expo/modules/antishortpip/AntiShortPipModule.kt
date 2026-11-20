package expo.modules.antishortpip

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS API: `AntiShortPip` (typed in modules/antishort-pip/index.ts). */
class AntiShortPipModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AntiShortPip")

    OnCreate {
      PipState.register(appContext.currentActivity)
    }

    OnDestroy {
      PipState.autoEnterEnabled = false
    }

    Function("isSupported") {
      PipState.isSupported(appContext.currentActivity)
    }

    Function("setAutoEnterEnabled") { enabled: Boolean ->
      PipState.autoEnterEnabled = enabled
    }

    AsyncFunction("enterAsync") {
      PipState.enter(appContext.currentActivity)
    }.runOnQueue(Queues.MAIN)
  }
}
