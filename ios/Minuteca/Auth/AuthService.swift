// SPDX-License-Identifier: MPL-2.0
import CryptoKit
import Foundation
import MinutecaKit
import Security

/// Sign in with an email link, like the web, plus a secret that never leaves the iPhone
/// (docs/adr/0003-access.md): the app keeps a random verifier and sends only its SHA-256.
/// The link opens the web page, which hands the token to the app through minuteca://acceso.
/// Only this app, holding the verifier, can trade it for a session.
@MainActor
final class AuthService: ObservableObject {
    static let shared = AuthService()

    @Published private(set) var token: String? = Keychain.load(.sessionToken)
    @Published var email: String = UserDefaults.standard.string(forKey: "email") ?? ""
    @Published var server: URL = AuthService.savedServer()
    @Published private(set) var linkSent = false
    @Published var problem: LocalizedStringResource?

    var signedIn: Bool { token != nil }
    var api: API { API(server: server) }

    static func savedServer() -> URL {
        if let s = UserDefaults.standard.string(forKey: "server"), let url = ServerAddress.parse(s) { return url }
        let fromPlist = Bundle.main.object(forInfoDictionaryKey: "MinutecaServerURL") as? String ?? ""
        return ServerAddress.parse(fromPlist) ?? URL(string: "https://minuteca.lzno.app")!
    }

    func setServer(_ text: String) -> Bool {
        guard let url = ServerAddress.parse(text) else { return false }
        server = url
        UserDefaults.standard.set(url.absoluteString, forKey: "server")
        return true
    }

    func requestLink() async {
        problem = nil
        let address = email.trimmingCharacters(in: .whitespaces).lowercased()
        guard EmailAddress.isPlausible(address) else {
            problem = "signin.invalidEmail"
            return
        }
        UserDefaults.standard.set(address, forKey: "email")
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let verifier = Base64URL.encode(Data(bytes))
        let challenge = Base64URL.encode(Data(SHA256.hash(data: Data(verifier.utf8))))
        Keychain.save(verifier, as: .pendingVerifier)
        do {
            let (_, response) = try await URLSession.shared.data(for: api.signInLink(email: address, challenge: challenge))
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 200 { linkSent = true } else { problem = status == 429 ? "signin.tooMany" : "signin.failed" }
        } catch {
            problem = "signin.offline"
        }
    }

    /// minuteca://acceso?t=… opened from the sign-in page.
    func handle(_ url: URL) async {
        guard let linkToken = SignInLink.token(from: url) else {
            problem = "signin.badLink"
            return
        }
        guard let verifier = Keychain.load(.pendingVerifier) else {
            problem = "signin.otherDevice"
            return
        }
        do {
            let (data, response) = try await URLSession.shared.data(for: api.appToken(linkToken: linkToken, verifier: verifier))
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let session = body["token"] as? String
            else {
                problem = "signin.expired"
                return
            }
            Keychain.save(session, as: .sessionToken)
            Keychain.delete(.pendingVerifier)
            token = session
            linkSent = false
            problem = nil
            UploadService.shared.uploadPending()
        } catch {
            problem = "signin.offline"
        }
    }

    func cancelLink() {
        linkSent = false
        Keychain.delete(.pendingVerifier)
    }

    /// Ends the session on the server too. Recordings not yet uploaded stay on the iPhone.
    func signOut() async {
        if let token { _ = try? await URLSession.shared.data(for: api.signOut(token: token)) }
        forget()
    }

    /// The server said the session is no longer valid.
    func forget() {
        Keychain.delete(.sessionToken)
        token = nil
    }
}
