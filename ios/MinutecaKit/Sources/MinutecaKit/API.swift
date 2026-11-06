// SPDX-License-Identifier: MPL-2.0
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Requests to a minuteca server (the same API as the web app). Building them here keeps them
/// testable on Linux; sending them is the app's job.
public struct API: Sendable {
    public let server: URL

    public init(server: URL) {
        self.server = server
    }

    private func request(_ path: String, method: String, token: String? = nil, json: [String: Any]? = nil) -> URLRequest {
        var r = URLRequest(url: server.appendingPathComponent(path))
        r.httpMethod = method
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let json {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])
        }
        return r
    }

    /// Asks the server to email a sign-in link for the app. Only the challenge travels; the
    /// verifier stays on the iPhone (docs/adr/0003-access.md).
    public func signInLink(email: String, challenge: String) -> URLRequest {
        request("api/auth/link", method: "POST", json: ["email": email, "client": "app", "challenge": challenge])
    }

    /// Trades the link's token and the verifier for the app's session token.
    public func appToken(linkToken: String, verifier: String) -> URLRequest {
        request("api/auth/app-token", method: "POST", json: ["token": linkToken, "verifier": verifier])
    }

    public func signOut(token: String) -> URLRequest {
        request("api/auth/logout", method: "POST", token: token)
    }

    public func me(token: String) -> URLRequest {
        request("api/me", method: "GET", token: token)
    }

    /// Creates the meeting (idempotent: the same id returns the same meeting).
    public func createMeeting(_ r: Recording, token: String) -> URLRequest {
        let iso = ISO8601DateFormatter()
        return request("api/meetings", method: "POST", token: token, json: [
            "id": r.meetingId,
            "title": r.title,
            "date": iso.string(from: r.startedAt),
            "source": "ios",
            "duration": Int(r.duration.rounded()),
        ])
    }

    /// The audio upload. The body is the joined file, sent by a background URLSession task.
    public func uploadAudio(_ r: Recording, bytes: Int, token: String) -> URLRequest {
        var req = request("api/meetings/\(r.meetingId)/audio", method: "PUT", token: token)
        req.setValue(Segments.contentType, forHTTPHeaderField: "Content-Type")
        req.setValue(String(bytes), forHTTPHeaderField: "Content-Length")
        req.setValue(String(Int(r.duration.rounded())), forHTTPHeaderField: "X-Audio-Duration")
        return req
    }
}

/// How the app reacts to the answer of an upload step.
public enum UploadOutcome: Equatable, Sendable {
    case done
    case retryLater(UploadProblem)
    case signedOut
    case giveUp(UploadProblem)
}

public func outcome(status: Int) -> UploadOutcome {
    switch status {
    case 200, 201: return .done
    // The server already has this meeting's audio and transcribed it: nothing left to send.
    case 409: return .done
    case 401: return .signedOut
    case 413: return .giveUp(.tooLarge)
    case 400, 415: return .giveUp(.audioUnreadable)
    default: return .retryLater(.server)
    }
}
