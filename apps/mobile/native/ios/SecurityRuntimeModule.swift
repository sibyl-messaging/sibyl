import Foundation
import UIKit
import React

@objc(SecurityRuntimeModule)
class SecurityRuntimeModule: NSObject {
  @objc
  func setSecureScreen(_ enabled: Bool, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    // iOS does not expose an exact FLAG_SECURE equivalent. Keep method for parity.
    resolve(nil)
  }

  @objc
  func setMaxBrightness(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      UIScreen.main.brightness = 1.0
      resolve(nil)
    }
  }

  @objc
  func restoreBrightness(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      UIScreen.main.brightness = CGFloat(0.5)
      resolve(nil)
    }
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return true
  }
}
