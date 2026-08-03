import Foundation
import React

@objc(ToxicBufferModule)
class ToxicBufferModule: NSObject {
  private var buffers: [String: Data] = [:]

  @objc
  func allocFromBase64(_ input: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    guard let data = Data(base64Encoded: input) else {
      reject("INVALID_BASE64", "Could not decode base64", nil)
      return
    }

    let handle = "tox_\(UUID().uuidString)"
    buffers[handle] = data
    resolve(handle)
  }

  @objc
  func readAsBase64(_ handle: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    guard let data = buffers[handle] else {
      reject("NOT_FOUND", "Buffer handle not found", nil)
      return
    }

    resolve(data.base64EncodedString())
  }

  @objc
  func zeroizeAndFree(_ handle: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    if var data = buffers.removeValue(forKey: handle) {
      data.resetBytes(in: 0..<data.count)
    }
    resolve(nil)
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }
}
