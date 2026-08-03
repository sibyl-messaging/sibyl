package ai.sibyl.ghost

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.ConcurrentHashMap

class ToxicBufferModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  private val buffers = ConcurrentHashMap<String, ByteArray>()

  override fun getName(): String = "ToxicBufferModule"

  @ReactMethod
  fun allocFromBase64(input: String, promise: Promise) {
    val handle = "tox_" + System.nanoTime().toString()
    val data = Base64.decode(input, Base64.DEFAULT)
    buffers[handle] = data
    promise.resolve(handle)
  }

  @ReactMethod
  fun readAsBase64(handle: String, promise: Promise) {
    val data = buffers[handle]
    if (data == null) {
      promise.reject("NOT_FOUND", "Buffer handle not found")
      return
    }
    promise.resolve(Base64.encodeToString(data, Base64.NO_WRAP))
  }

  @ReactMethod
  fun zeroizeAndFree(handle: String, promise: Promise) {
    val data = buffers.remove(handle)
    if (data != null) {
      for (i in data.indices) {
        data[i] = 0
      }
    }
    promise.resolve(null)
  }
}
