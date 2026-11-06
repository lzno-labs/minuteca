// SPDX-License-Identifier: MPL-2.0
import Foundation

public enum SignInLink {
    /// The token of a `minuteca://acceso?t=<64 hex>` link opened from the sign-in page, or nil.
    public static func token(from url: URL) -> String? {
        guard url.scheme == "minuteca", url.host == "acceso",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let t = items.first(where: { $0.name == "t" })?.value,
              t.count == 64, t.allSatisfy({ $0.isHexDigit && !$0.isUppercase })
        else { return nil }
        return t
    }
}

public enum Base64URL {
    public static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

public enum EmailAddress {
    public static func isPlausible(_ s: String) -> Bool {
        let parts = s.trimmingCharacters(in: .whitespaces).split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, parts[1].contains("."), !parts[1].hasPrefix("."), !parts[1].hasSuffix(".") else { return false }
        return !s.contains(" ")
    }
}

public enum ServerAddress {
    /// Accepts "minuteca.example.org" or a full URL; https only, except for local testing.
    public static func parse(_ s: String) -> URL? {
        var text = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        if !text.contains("://") { text = "https://" + text }
        guard let url = URL(string: text), let host = url.host, !host.isEmpty else { return nil }
        let local = host == "localhost" || host.hasSuffix(".local") || host.hasPrefix("192.168.") || host.hasPrefix("10.")
        guard url.scheme == "https" || (url.scheme == "http" && local) else { return nil }
        var c = URLComponents()
        c.scheme = url.scheme
        c.host = host
        c.port = url.port
        return c.url
    }
}
