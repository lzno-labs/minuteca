// SPDX-License-Identifier: MPL-2.0
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import MinutecaKit

final class RecordingTests: XCTestCase {
    func testStepsFollowTheState() {
        var r = Recording(title: "Junta", startedAt: Date())
        XCTAssertEqual(nextStep(for: r), .nothing)
        r.state = .stopped
        XCTAssertEqual(nextStep(for: r), .join)
        r.state = .ready
        XCTAssertEqual(nextStep(for: r), .createMeeting)
        r.state = .created
        XCTAssertEqual(nextStep(for: r), .uploadAudio)
        XCTAssertTrue(r.needsUpload)
        r.state = .uploaded
        XCTAssertEqual(nextStep(for: r), .nothing)
        XCTAssertFalse(r.needsUpload)
    }

    func testMeetingIdIsLowercase() {
        let r = Recording(id: UUID(uuidString: "6F9619FF-8B86-D011-B42D-00C04FC964FF")!, title: "x", startedAt: Date())
        XCTAssertEqual(r.meetingId, "6f9619ff-8b86-d011-b42d-00c04fc964ff")
    }
}

final class SegmentTests: XCTestCase {
    func testRotatesEveryTwoMinutes() {
        let start = Date(timeIntervalSince1970: 0)
        XCTAssertFalse(Segments.shouldRotate(segmentStartedAt: start, now: start.addingTimeInterval(119)))
        XCTAssertTrue(Segments.shouldRotate(segmentStartedAt: start, now: start.addingTimeInterval(120)))
    }

    func testNamesSortInOrder() {
        XCTAssertEqual(Segments.name(index: 7), "segment-0007.m4a")
        XCTAssertLessThan(Segments.name(index: 9), Segments.name(index: 10))
    }

    func testThreeHoursFitTheServerLimit() {
        XCTAssertLessThan(Segments.estimatedBytes(seconds: 3 * 3600), 95 * 1024 * 1024)
    }
}

final class StoreTests: XCTestCase {
    private func tempRoot() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("minuteca-\(UUID().uuidString)")
    }

    func testSurvivesARestartAndRecoversInterruptedRecordings() throws {
        let root = tempRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = RecordingStore(root: root)
        let r = try store.add(Recording(title: "Junta", startedAt: Date()))
        try store.update(r.id) { $0.segments = [Segments.name(index: 0)]; $0.duration = 42 }

        let reopened = RecordingStore(root: root)
        XCTAssertEqual(reopened.get(r.id)?.duration, 42)
        let recovered = try reopened.recoverInterrupted()
        XCTAssertEqual(recovered.map(\.id), [r.id])
        XCTAssertEqual(reopened.get(r.id)?.state, .stopped)
        XCTAssertEqual(reopened.get(r.id)?.recovered, true)
        XCTAssertEqual(reopened.pending.count, 1)
    }

    func testPurgesUploadedAudioButKeepsTheEntry() throws {
        let root = tempRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = RecordingStore(root: root)
        let now = Date()
        let r = try store.add(Recording(title: "Junta", startedAt: now.addingTimeInterval(-10 * 86_400)))
        try Data([1, 2, 3]).write(to: store.url(Segments.joinedName, of: r.id))
        try store.update(r.id) { $0.state = .uploaded; $0.audioFile = Segments.joinedName; $0.uploadedAt = now.addingTimeInterval(-8 * 86_400) }
        try store.purgeUploadedAudio(olderThan: 7, now: now)
        XCTAssertNil(store.get(r.id)?.audioFile)
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.url(Segments.joinedName, of: r.id).path))
        XCTAssertNotNil(store.get(r.id))
    }

    func testNeverPurgesAudioThatIsNotUploaded() throws {
        let root = tempRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = RecordingStore(root: root)
        let r = try store.add(Recording(title: "Junta", startedAt: Date().addingTimeInterval(-60 * 86_400)))
        try store.update(r.id) { $0.state = .ready; $0.audioFile = Segments.joinedName }
        try store.purgeUploadedAudio(olderThan: 7)
        XCTAssertEqual(store.get(r.id)?.audioFile, Segments.joinedName)
    }
}

final class APITests: XCTestCase {
    let api = API(server: URL(string: "https://minuteca.example.org")!)

    func testSignInSendsOnlyTheChallenge() throws {
        let req = api.signInLink(email: "ana@example.org", challenge: "abc")
        XCTAssertEqual(req.url?.absoluteString, "https://minuteca.example.org/api/auth/link")
        let body = try JSONSerialization.jsonObject(with: req.httpBody!) as! [String: String]
        XCTAssertEqual(body, ["email": "ana@example.org", "client": "app", "challenge": "abc"])
    }

    func testUploadRequest() {
        var r = Recording(title: "Junta", startedAt: Date())
        r.duration = 61.6
        let req = api.uploadAudio(r, bytes: 1234, token: "tok")
        XCTAssertEqual(req.httpMethod, "PUT")
        XCTAssertEqual(req.url?.path, "/api/meetings/\(r.meetingId)/audio")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Content-Type"), "audio/mp4")
        XCTAssertEqual(req.value(forHTTPHeaderField: "X-Audio-Duration"), "62")
    }

    func testCreateMeetingIsTaggedAsIos() throws {
        let r = Recording(title: "Junta", startedAt: Date(timeIntervalSince1970: 0))
        let body = try JSONSerialization.jsonObject(with: api.createMeeting(r, token: "t").httpBody!) as! [String: Any]
        XCTAssertEqual(body["source"] as? String, "ios")
        XCTAssertEqual(body["date"] as? String, "1970-01-01T00:00:00Z")
        XCTAssertEqual(body["id"] as? String, r.meetingId)
    }

    func testOutcomes() {
        XCTAssertEqual(outcome(status: 200), .done)
        XCTAssertEqual(outcome(status: 409), .done)
        XCTAssertEqual(outcome(status: 401), .signedOut)
        XCTAssertEqual(outcome(status: 413), .giveUp(.tooLarge))
        XCTAssertEqual(outcome(status: 503), .retryLater(.server))
    }
}

final class SignInTests: XCTestCase {
    func testParsesOnlyWellFormedLinks() {
        let token = String(repeating: "a1", count: 32)
        XCTAssertEqual(SignInLink.token(from: URL(string: "minuteca://acceso?t=\(token)")!), token)
        XCTAssertNil(SignInLink.token(from: URL(string: "minuteca://acceso?t=xyz")!))
        XCTAssertNil(SignInLink.token(from: URL(string: "https://evil.example/acceso?t=\(token)")!))
        XCTAssertNil(SignInLink.token(from: URL(string: "minuteca://other?t=\(token)")!))
    }

    func testBase64URL() {
        XCTAssertEqual(Base64URL.encode(Data([0xfb, 0xff])), "-_8")
    }

    func testServerAddress() {
        XCTAssertEqual(ServerAddress.parse("minuteca.example.org")?.absoluteString, "https://minuteca.example.org")
        XCTAssertEqual(ServerAddress.parse("https://minuteca.example.org/path")?.absoluteString, "https://minuteca.example.org")
        XCTAssertEqual(ServerAddress.parse("http://localhost:8787")?.absoluteString, "http://localhost:8787")
        XCTAssertNil(ServerAddress.parse("http://minuteca.example.org"))
        XCTAssertNil(ServerAddress.parse(""))
    }

    func testEmail() {
        XCTAssertTrue(EmailAddress.isPlausible("ana@example.org"))
        XCTAssertFalse(EmailAddress.isPlausible("ana@example"))
        XCTAssertFalse(EmailAddress.isPlausible("ana example@x.org"))
    }
}
