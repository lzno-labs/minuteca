// SPDX-License-Identifier: MPL-2.0
import Foundation

/// One recording on the iPhone, from the first segment to the upload.
///
/// Audio is written in segments (see `Segments`), so a crash or a killed app loses at most the
/// segment being written. When the recording stops, the segments are joined into one file and
/// the upload starts. Design: docs/design/ios-background-recording.md.
public struct Recording: Codable, Equatable, Identifiable, Sendable {
    public enum State: String, Codable, Sendable {
        /// Recording or paused right now.
        case recording
        /// Stopped; segments still need to be joined into one file.
        case stopped
        /// One file ready, waiting to be uploaded.
        case ready
        /// The meeting exists on the server; the audio upload is in flight or will be retried.
        case created
        /// The server has the audio.
        case uploaded
    }

    public var id: UUID
    public var title: String
    public var startedAt: Date
    public var state: State
    /// File names of the segments, in order, relative to the recording's folder.
    public var segments: [String]
    /// Seconds of audio recorded (pauses not counted).
    public var duration: TimeInterval
    /// The joined file, relative to the recording's folder, once it exists.
    public var audioFile: String?
    public var audioBytes: Int?
    public var uploadedAt: Date?
    /// Last upload problem, for the list ("sin señal", "sesión cerrada"...).
    public var lastError: UploadProblem?
    /// true when the app found this recording unfinished after being closed by the system.
    public var recovered: Bool

    public init(id: UUID = UUID(), title: String, startedAt: Date) {
        self.id = id
        self.title = title
        self.startedAt = startedAt
        self.state = .recording
        self.segments = []
        self.duration = 0
        self.audioFile = nil
        self.audioBytes = nil
        self.uploadedAt = nil
        self.lastError = nil
        self.recovered = false
    }

    /// Still needs work before the server has it.
    public var needsUpload: Bool { state == .stopped || state == .ready || state == .created }

    /// The id the server uses for the meeting (lowercase, like the web app's ids).
    public var meetingId: String { id.uuidString.lowercased() }
}

public enum UploadProblem: String, Codable, Sendable {
    case offline
    case signedOut
    case tooLarge
    case server
    case audioUnreadable
}

/// What the uploader has to do next for a recording.
public enum UploadStep: Equatable, Sendable {
    case join
    case createMeeting
    case uploadAudio
    case nothing
}

public func nextStep(for r: Recording) -> UploadStep {
    switch r.state {
    case .recording, .uploaded: return .nothing
    case .stopped: return .join
    case .ready: return .createMeeting
    case .created: return .uploadAudio
    }
}
