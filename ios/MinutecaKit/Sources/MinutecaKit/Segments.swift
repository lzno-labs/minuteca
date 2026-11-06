// SPDX-License-Identifier: MPL-2.0
import Foundation

/// Rules for the audio segments of a recording.
public enum Segments {
    /// A new segment starts every 2 minutes, so a crash loses at most this much audio.
    public static let maxLength: TimeInterval = 120

    /// AAC in an .m4a container, mono, 24 kHz, 32 kbit/s: about 14 MB per hour, clear speech,
    /// and a 3 hour meeting stays far below the server's 95 MB limit.
    public static let sampleRate: Double = 24_000
    public static let bitRate = 32_000
    public static let fileExtension = "m4a"
    public static let contentType = "audio/mp4"

    public static func name(index: Int) -> String {
        String(format: "segment-%04d.%@", index, fileExtension)
    }

    public static let joinedName = "audio.\(fileExtension)"

    /// true when the running segment should be closed and a new one started.
    public static func shouldRotate(segmentStartedAt: Date, now: Date) -> Bool {
        now.timeIntervalSince(segmentStartedAt) >= maxLength
    }

    /// Estimated size of `seconds` of audio, in bytes.
    public static func estimatedBytes(seconds: TimeInterval) -> Int {
        Int(seconds * Double(bitRate) / 8)
    }
}
