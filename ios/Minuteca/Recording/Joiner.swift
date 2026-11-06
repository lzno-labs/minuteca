// SPDX-License-Identifier: MPL-2.0
import AVFoundation
import Foundation
import MinutecaKit

/// Joins the segments of a recording into one .m4a file for the upload. Segments that cannot be
/// read (the last one, if the app was killed while writing it) are skipped.
enum Joiner {
    struct Result {
        let file: String
        let bytes: Int
        let duration: TimeInterval
    }

    static func join(_ r: Recording, store: RecordingStore) async throws -> Result {
        let output = store.url(Segments.joinedName, of: r.id)
        try? FileManager.default.removeItem(at: output)

        var readable: [(AVURLAsset, CMTime)] = []
        for name in r.segments {
            let asset = AVURLAsset(url: store.url(name, of: r.id))
            guard let duration = try? await asset.load(.duration), duration.seconds > 0.05,
                  let tracks = try? await asset.loadTracks(withMediaType: .audio), !tracks.isEmpty
            else { continue }
            readable.append((asset, duration))
        }
        guard !readable.isEmpty else { throw JoinError.noAudio }

        if readable.count == 1 {
            try FileManager.default.copyItem(at: readable[0].0.url, to: output)
        } else {
            let composition = AVMutableComposition()
            guard let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
                throw JoinError.noAudio
            }
            var cursor = CMTime.zero
            for (asset, duration) in readable {
                guard let source = try await asset.loadTracks(withMediaType: .audio).first else { continue }
                try track.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: source, at: cursor)
                cursor = cursor + duration
            }
            // Passthrough keeps the AAC as recorded (fast); re-encoding is the fallback.
            if !(await export(composition, to: output, preset: AVAssetExportPresetPassthrough)) {
                try? FileManager.default.removeItem(at: output)
                guard await export(composition, to: output, preset: AVAssetExportPresetAppleM4A) else { throw JoinError.exportFailed }
            }
        }
        let bytes = (try FileManager.default.attributesOfItem(atPath: output.path)[.size] as? NSNumber)?.intValue ?? 0
        let total: TimeInterval = readable.reduce(0.0) { $0 + $1.1.seconds }
        return Result(file: Segments.joinedName, bytes: bytes, duration: total)
    }

    private static func export(_ asset: AVAsset, to url: URL, preset: String) async -> Bool {
        guard let session = AVAssetExportSession(asset: asset, presetName: preset) else { return false }
        session.outputURL = url
        session.outputFileType = .m4a
        return await withCheckedContinuation { continuation in
            session.exportAsynchronously {
                continuation.resume(returning: session.status == .completed)
            }
        }
    }
}

enum JoinError: Error {
    case noAudio
    case exportFailed
}
