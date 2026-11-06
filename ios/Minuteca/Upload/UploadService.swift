// SPDX-License-Identifier: MPL-2.0
import Foundation
import MinutecaKit
import Network
import UIKit

/// Sends finished recordings to the server without losing audio:
///
/// 1. join the segments into one file (Joiner);
/// 2. create the meeting (small JSON request, idempotent by id);
/// 3. upload the file with a background URLSession, which iOS finishes even if the app is
///    suspended or closed.
///
/// Every step is saved in the RecordingStore before and after it runs, so a failure at any point
/// is retried from that step: when the network comes back, when the app opens, or by hand.
@MainActor
final class UploadService: NSObject, ObservableObject {
    static let shared = UploadService()
    static let sessionId = "app.lzno.minuteca.upload"

    @Published private(set) var recordings: [Recording] = []
    @Published private(set) var working = false

    private let store = Storage.recordings
    private let monitor = NWPathMonitor()
    private var online = true
    /// Set by the AppDelegate when iOS wakes the app for finished background uploads.
    var backgroundCompletion: (() -> Void)?

    private lazy var background: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionId)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.allowsCellularAccess = true
        config.timeoutIntervalForResource = 24 * 3600
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    override init() {
        super.init()
        _ = try? store.recoverInterrupted()
        reload()
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                let wasOffline = !self.online
                self.online = path.status == .satisfied
                if wasOffline && self.online { self.uploadPending() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "minuteca.network"))
        _ = background // reconnect to uploads iOS kept running while the app was closed
    }

    var pendingCount: Int { recordings.filter(\.needsUpload).count }

    func reload() {
        recordings = store.all
    }

    /// Runs the next step of every recording that is not on the server yet.
    func uploadPending() {
        guard !working else { return }
        working = true
        Task {
            defer {
                working = false
                reload()
            }
            try? store.purgeUploadedAudio(olderThan: 7)
            for r in store.pending {
                await advance(r.id)
            }
        }
    }

    private func advance(_ id: UUID) async {
        guard var r = store.get(id) else { return }
        if nextStep(for: r) == .join {
            do {
                let joined = try await Joiner.join(r, store: store)
                r = try store.update(id) {
                    $0.audioFile = joined.file
                    $0.audioBytes = joined.bytes
                    $0.duration = max($0.duration, joined.duration)
                    $0.state = .ready
                    $0.lastError = nil
                } ?? r
            } catch {
                _ = try? store.update(id) { $0.lastError = .audioUnreadable }
                return
            }
            reload()
        }
        guard let token = AuthService.shared.token else {
            _ = try? store.update(id) { $0.lastError = .signedOut }
            return
        }
        let api = AuthService.shared.api
        if nextStep(for: r) == .createMeeting {
            do {
                let (_, response) = try await URLSession.shared.data(for: api.createMeeting(r, token: token))
                switch outcome(status: (response as? HTTPURLResponse)?.statusCode ?? 0) {
                case .done:
                    r = try store.update(id) { $0.state = .created; $0.lastError = nil } ?? r
                case .signedOut:
                    AuthService.shared.forget()
                    _ = try? store.update(id) { $0.lastError = .signedOut }
                    return
                case .retryLater(let p), .giveUp(let p):
                    _ = try? store.update(id) { $0.lastError = p }
                    return
                }
            } catch {
                _ = try? store.update(id) { $0.lastError = .offline }
                return
            }
        }
        if nextStep(for: r) == .uploadAudio {
            // One upload per recording: if iOS is already sending this file, let it finish.
            let tasks = await background.allTasks
            if tasks.contains(where: { $0.taskDescription == r.id.uuidString }) { return }
            guard let file = r.audioFile else {
                _ = try? store.update(id) { $0.state = .stopped }
                return
            }
            let url = store.url(file, of: id)
            let bytes = r.audioBytes ?? ((try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0)
            let task = background.uploadTask(with: api.uploadAudio(r, bytes: bytes, token: token), fromFile: url)
            task.taskDescription = r.id.uuidString
            task.resume()
        }
    }

    fileprivate func finished(id: UUID, status: Int?, error: Error?) {
        if error != nil || status == nil {
            _ = try? store.update(id) { $0.lastError = .offline }
        } else {
            switch outcome(status: status!) {
            case .done:
                _ = try? store.update(id) { $0.state = .uploaded; $0.uploadedAt = Date(); $0.lastError = nil }
            case .signedOut:
                AuthService.shared.forget()
                _ = try? store.update(id) { $0.lastError = .signedOut }
            case .retryLater(let p), .giveUp(let p):
                _ = try? store.update(id) { $0.lastError = p }
            }
        }
        reload()
    }
}

extension UploadService: URLSessionTaskDelegate {
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let raw = task.taskDescription, let id = UUID(uuidString: raw) else { return }
        let status = (task.response as? HTTPURLResponse)?.statusCode
        Task { @MainActor in self.finished(id: id, status: status, error: error) }
    }

    nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        Task { @MainActor in
            self.backgroundCompletion?()
            self.backgroundCompletion = nil
        }
    }
}
