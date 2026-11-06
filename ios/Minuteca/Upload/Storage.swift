// SPDX-License-Identifier: MPL-2.0
import Foundation
import MinutecaKit

enum Storage {
    /// Application Support/Recordings: kept by iOS, not visible in Files, removed with the app.
    static let recordings: RecordingStore = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return RecordingStore(root: base.appendingPathComponent("Recordings", isDirectory: true))
    }()
}
