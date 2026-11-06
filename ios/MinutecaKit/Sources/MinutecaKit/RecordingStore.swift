// SPDX-License-Identifier: MPL-2.0
import Foundation

/// The list of recordings, kept as a JSON file next to the audio folders:
///
///     <root>/recordings.json
///     <root>/<recording id>/segment-0000.m4a ...
///     <root>/<recording id>/audio.m4a
///
/// Every change is written at once (atomically), so the list survives the app being killed.
public final class RecordingStore: @unchecked Sendable {
    public let root: URL
    private let lock = NSLock()
    private var items: [Recording]
    private let fileManager = FileManager.default

    public init(root: URL) {
        self.root = root
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let index = root.appendingPathComponent("recordings.json")
        if let data = try? Data(contentsOf: index), let list = try? Self.decoder.decode([Recording].self, from: data) {
            items = list
        } else {
            items = []
        }
    }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.sortedKeys]
        return e
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    public var all: [Recording] {
        lock.lock(); defer { lock.unlock() }
        return items.sorted { $0.startedAt > $1.startedAt }
    }

    public func get(_ id: UUID) -> Recording? {
        lock.lock(); defer { lock.unlock() }
        return items.first { $0.id == id }
    }

    public var pending: [Recording] { all.filter(\.needsUpload) }

    public func folder(for id: UUID) -> URL {
        root.appendingPathComponent(id.uuidString, isDirectory: true)
    }

    public func url(_ file: String, of id: UUID) -> URL {
        folder(for: id).appendingPathComponent(file)
    }

    @discardableResult
    public func add(_ r: Recording) throws -> Recording {
        try fileManager.createDirectory(at: folder(for: r.id), withIntermediateDirectories: true)
        lock.lock()
        items.append(r)
        lock.unlock()
        try save()
        return r
    }

    @discardableResult
    public func update(_ id: UUID, _ change: (inout Recording) -> Void) throws -> Recording? {
        lock.lock()
        guard let i = items.firstIndex(where: { $0.id == id }) else {
            lock.unlock()
            return nil
        }
        change(&items[i])
        let r = items[i]
        lock.unlock()
        try save()
        return r
    }

    public func remove(_ id: UUID) throws {
        lock.lock()
        items.removeAll { $0.id == id }
        lock.unlock()
        try? fileManager.removeItem(at: folder(for: id))
        try save()
    }

    /// Recordings that were still `.recording` when the app was killed: they become `.stopped`
    /// (their segments are joined and uploaded like any other) and are flagged as recovered.
    @discardableResult
    public func recoverInterrupted() throws -> [Recording] {
        lock.lock()
        var recovered: [Recording] = []
        for i in items.indices where items[i].state == .recording {
            items[i].state = .stopped
            items[i].recovered = true
            recovered.append(items[i])
        }
        lock.unlock()
        if !recovered.isEmpty { try save() }
        return recovered
    }

    /// Frees space: the audio of recordings uploaded more than `keepDays` ago is deleted from the
    /// iPhone (the server keeps it for its own retention period). The list entry stays.
    public func purgeUploadedAudio(olderThan keepDays: Int, now: Date = Date()) throws {
        let limit = now.addingTimeInterval(-Double(keepDays) * 86_400)
        for r in all where r.state == .uploaded && (r.uploadedAt ?? now) < limit && (r.audioFile != nil || !r.segments.isEmpty) {
            try? fileManager.removeItem(at: folder(for: r.id))
            try update(r.id) { $0.audioFile = nil; $0.segments = [] }
        }
        // List entries older than the server's retention are dropped altogether.
        let gone = now.addingTimeInterval(-31 * 86_400)
        for r in all where r.state == .uploaded && r.startedAt < gone {
            try remove(r.id)
        }
    }

    private func save() throws {
        lock.lock()
        let snapshot = items
        lock.unlock()
        let data = try Self.encoder.encode(snapshot)
        try data.write(to: root.appendingPathComponent("recordings.json"), options: .atomic)
    }
}
