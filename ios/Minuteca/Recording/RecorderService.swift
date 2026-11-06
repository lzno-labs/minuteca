// SPDX-License-Identifier: MPL-2.0
import AVFoundation
import Foundation
import MinutecaKit

/// Records in segments of up to 2 minutes (MinutecaKit.Segments), so the app being killed loses
/// at most one segment, and a call or Siri never ends the recording: the running segment is
/// closed when the interruption starts and a new one opens when it ends.
/// Design: docs/design/ios-background-recording.md.
@MainActor
final class RecorderService: NSObject, ObservableObject {
    static let shared = RecorderService()

    enum Status: Equatable {
        case idle
        case recording
        case paused
        /// Interrupted by a call or another app; it resumes on its own when it ends.
        case interrupted
        case finishing
    }

    @Published private(set) var status: Status = .idle
    @Published private(set) var elapsed: TimeInterval = 0
    @Published private(set) var level: Float = 0
    @Published var problem: LocalizedStringResource?

    private let store = Storage.recordings
    private var current: Recording?
    private var recorder: AVAudioRecorder?
    private var segmentStartedAt = Date()
    /// Seconds in segments already closed.
    private var closedSeconds: TimeInterval = 0
    private var ticker: Timer?

    var isActive: Bool { status != .idle && status != .finishing }

    override init() {
        super.init()
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(onInterruption(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        center.addObserver(self, selector: #selector(onMediaReset(_:)), name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
    }

    // MARK: - Controls

    func start() async {
        problem = nil
        guard await AVAudioApplication.requestRecordPermission() else {
            problem = "recorder.micDenied"
            return
        }
        do {
            try activateSession()
            let title = String(localized: "recording.defaultTitle \(Date().formatted(date: .numeric, time: .shortened))")
            let r = try store.add(Recording(title: title, startedAt: Date()))
            current = r
            closedSeconds = 0
            elapsed = 0
            try openSegment()
            status = .recording
            startTicker()
        } catch {
            problem = "recorder.failed"
            status = .idle
        }
    }

    func pause() {
        guard status == .recording else { return }
        recorder?.pause()
        status = .paused
    }

    func resume() {
        guard status == .paused else { return }
        if recorder?.record() != true {
            // The old segment cannot continue (for example after a long pause): open a new one.
            closeSegment()
            try? openSegment()
        }
        status = .recording
    }

    /// Ends the recording and hands it to the uploader.
    func stop() {
        guard let r = current, isActive else { return }
        status = .finishing
        closeSegment()
        ticker?.invalidate()
        ticker = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        _ = try? store.update(r.id) {
            $0.state = .stopped
            $0.duration = self.closedSeconds
        }
        current = nil
        recorder = nil
        status = .idle
        elapsed = 0
        level = 0
        UploadService.shared.uploadPending()
    }

    // MARK: - Segments

    private func activateSession() throws {
        let session = AVAudioSession.sharedInstance()
        // .record keeps the microphone with the screen locked (UIBackgroundModes: audio).
        try session.setCategory(.record, mode: .default, options: [.allowBluetooth])
        try session.setActive(true)
    }

    private func openSegment() throws {
        guard let r = current else { return }
        let index = (store.get(r.id)?.segments.count) ?? 0
        let name = Segments.name(index: index)
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: Segments.sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: Segments.bitRate,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        let rec = try AVAudioRecorder(url: store.url(name, of: r.id), settings: settings)
        rec.isMeteringEnabled = true
        guard rec.record() else { throw RecorderError.cannotStart }
        recorder = rec
        segmentStartedAt = Date()
        // The segment is listed before it has audio, so a crash still finds it.
        _ = try store.update(r.id) { $0.segments.append(name) }
    }

    /// Closes the running segment; AVAudioRecorder writes the file's index on stop.
    private func closeSegment() {
        guard let rec = recorder else { return }
        closedSeconds += rec.currentTime
        rec.stop()
        recorder = nil
        if let r = current { _ = try? store.update(r.id) { $0.duration = self.closedSeconds } }
    }

    private func startTicker() {
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func tick() {
        guard let rec = recorder else { return }
        elapsed = closedSeconds + rec.currentTime
        if status == .recording {
            rec.updateMeters()
            level = max(0, min(1, (rec.averagePower(forChannel: 0) + 50) / 50))
            if Segments.shouldRotate(segmentStartedAt: segmentStartedAt, now: Date()) {
                closeSegment()
                do { try openSegment() } catch { problem = "recorder.failed" }
            }
        } else {
            level = 0
        }
    }

    // MARK: - Interruptions (calls, Siri, alarms) and media resets

    @objc private nonisolated func onInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        Task { @MainActor in
            switch type {
            case .began:
                guard self.status == .recording || self.status == .paused else { return }
                // Save what we have: the system stops the microphone during a call.
                self.closeSegment()
                self.status = .interrupted
            case .ended:
                guard self.status == .interrupted else { return }
                self.resumeAfterInterruption()
            @unknown default:
                break
            }
        }
    }

    @objc private nonisolated func onMediaReset(_ note: Notification) {
        Task { @MainActor in
            guard self.isActive else { return }
            self.recorder = nil
            self.resumeAfterInterruption()
        }
    }

    private func resumeAfterInterruption() {
        do {
            try activateSession()
            try openSegment()
            status = .recording
        } catch {
            // The session may only come back when the app is in front again (see MinutecaApp).
            status = .interrupted
        }
    }

    /// Called when the app comes to the front: a recording still interrupted (for example a call
    /// that ended while iOS kept the microphone) tries to continue.
    func retryIfInterrupted() {
        if status == .interrupted { resumeAfterInterruption() }
    }
}

enum RecorderError: Error {
    case cannotStart
}
