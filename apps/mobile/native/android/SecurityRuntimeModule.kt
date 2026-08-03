package ai.sibyl.ghost

import android.app.Activity
import android.view.WindowManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class SecurityRuntimeModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  override fun getName(): String = "SecurityRuntimeModule"

  @ReactMethod
  fun setSecureScreen(enabled: Boolean, promise: Promise) {
    val activity: Activity? = currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "No active activity")
      return
    }

    activity.runOnUiThread {
      if (enabled) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun setMaxBrightness(promise: Promise) {
    val activity: Activity? = currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "No active activity")
      return
    }

    activity.runOnUiThread {
      val params = activity.window.attributes
      params.screenBrightness = 1.0f
      activity.window.attributes = params
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun restoreBrightness(promise: Promise) {
    val activity: Activity? = currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "No active activity")
      return
    }

    activity.runOnUiThread {
      val params = activity.window.attributes
      params.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
      activity.window.attributes = params
      promise.resolve(null)
    }
  }
}
