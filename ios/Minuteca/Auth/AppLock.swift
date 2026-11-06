// SPDX-License-Identifier: MPL-2.0
import Foundation
import LocalAuthentication

/// Face ID (or the passcode) before showing the recordings. Recording keeps going while the
/// app is locked: the lock only covers the screen.
@MainActor
final class AppLock: ObservableObject {
    @Published private(set) var locked: Bool
    @Published var enabled: Bool {
        didSet { UserDefaults.standard.set(enabled, forKey: "faceIdLock") }
    }

    init() {
        let on = UserDefaults.standard.object(forKey: "faceIdLock") as? Bool ?? true
        enabled = on
        locked = on
    }

    func lockIfNeeded() {
        if enabled { locked = true }
    }

    func unlock() {
        let context = LAContext()
        var error: NSError?
        // Devices without Face ID, Touch ID or a passcode cannot lock.
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            locked = false
            return
        }
        let reason = String(localized: "lock.reason")
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, _ in
            Task { @MainActor in
                if ok { self.locked = false }
            }
        }
    }
}
