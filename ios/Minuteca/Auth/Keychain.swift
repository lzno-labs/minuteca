// SPDX-License-Identifier: MPL-2.0
import Foundation
import Security

/// Secrets of the app, on this device only. Readable after the first unlock so uploads can
/// finish in the background with the phone locked.
enum Keychain {
    enum Item: String {
        case sessionToken = "minuteca.session-token"
        case pendingVerifier = "minuteca.pending-verifier"
    }

    static func save(_ value: String, as item: Item) {
        delete(item)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: item.rawValue,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: Data(value.utf8),
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    static func load(_ item: Item) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: item.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(_ item: Item) {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: item.rawValue] as CFDictionary)
    }
}
