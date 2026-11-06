// SPDX-License-Identifier: MPL-2.0
import MinutecaKit
import SwiftUI

struct RootView: View {
    @EnvironmentObject private var recorder: RecorderService
    @EnvironmentObject private var uploads: UploadService
    @State private var settings = false

    var body: some View {
        NavigationStack {
            List {
                Section { RecorderPanel() }
                if uploads.pendingCount > 0 {
                    Section {
                        Label("uploads.pending \(uploads.pendingCount)", systemImage: "icloud.and.arrow.up")
                            .foregroundStyle(.orange)
                        Button("uploads.retry") { uploads.uploadPending() }
                            .disabled(uploads.working)
                    } footer: {
                        Text("uploads.pendingHint")
                    }
                }
                Section("list.title") {
                    if uploads.recordings.isEmpty {
                        Text("list.empty").foregroundStyle(.secondary)
                    }
                    ForEach(uploads.recordings) { RecordingRow(recording: $0) }
                }
            }
            .navigationTitle("app.title")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { settings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel(Text("settings.title"))
                }
            }
            .sheet(isPresented: $settings) { SettingsView() }
            .refreshable { uploads.uploadPending() }
        }
    }
}

struct RecorderPanel: View {
    @EnvironmentObject private var recorder: RecorderService

    var body: some View {
        VStack(spacing: 16) {
            Text(statusText).font(.subheadline.weight(.medium)).foregroundStyle(statusColor)
            Text(Duration.seconds(recorder.elapsed).formatted(.time(pattern: .hourMinuteSecond)))
                .font(.system(size: 48, weight: .bold, design: .monospaced))
            ProgressView(value: Double(recorder.level))
                .tint(.green)
                .opacity(recorder.status == .recording ? 1 : 0.2)
                .accessibilityLabel(Text("recorder.level"))
            HStack(spacing: 24) {
                switch recorder.status {
                case .idle:
                    Button { Task { await recorder.start() } } label: {
                        Image(systemName: "mic.fill").font(.title).frame(width: 72, height: 72)
                    }
                    .buttonStyle(.borderedProminent).tint(.red).clipShape(Circle())
                    .accessibilityLabel(Text("recorder.start"))
                case .recording, .paused, .interrupted:
                    Button { recorder.status == .paused ? recorder.resume() : recorder.pause() } label: {
                        Image(systemName: recorder.status == .paused ? "play.fill" : "pause.fill").font(.title2).frame(width: 56, height: 56)
                    }
                    .buttonStyle(.bordered).clipShape(Circle())
                    .disabled(recorder.status == .interrupted)
                    .accessibilityLabel(Text(recorder.status == .paused ? LocalizedStringKey("recorder.resume") : LocalizedStringKey("recorder.pause")))
                    Button { recorder.stop() } label: {
                        Image(systemName: "stop.fill").font(.title).frame(width: 72, height: 72)
                    }
                    .buttonStyle(.borderedProminent).tint(.red).clipShape(Circle())
                    .accessibilityLabel(Text("recorder.stop"))
                case .finishing:
                    ProgressView()
                }
            }
            if let problem = recorder.problem { Text(problem).font(.footnote).foregroundStyle(.red) }
            Text(recorder.status == .idle ? LocalizedStringKey("recorder.hint") : LocalizedStringKey("recorder.lockHint"))
                .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private var statusText: LocalizedStringKey {
        switch recorder.status {
        case .idle: return "recorder.ready"
        case .recording: return "recorder.recording"
        case .paused: return "recorder.paused"
        case .interrupted: return "recorder.interrupted"
        case .finishing: return "recorder.finishing"
        }
    }

    private var statusColor: Color {
        switch recorder.status {
        case .recording: return .red
        case .paused, .interrupted: return .orange
        default: return .secondary
        }
    }
}

struct RecordingRow: View {
    let recording: Recording

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(recording.title).font(.body.weight(.medium))
            HStack(spacing: 6) {
                Text(recording.startedAt.formatted(date: .abbreviated, time: .shortened))
                Text("·")
                Text(Duration.seconds(recording.duration).formatted(.units(allowed: [.hours, .minutes, .seconds], width: .abbreviated)))
            }
            .font(.caption).foregroundStyle(.secondary)
            Label(stateText, systemImage: stateIcon).font(.caption).foregroundStyle(stateColor)
            if recording.recovered && recording.needsUpload {
                Text("list.recovered").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private var stateText: LocalizedStringKey {
        if let p = recording.lastError, recording.needsUpload {
            switch p {
            case .offline: return "state.offline"
            case .signedOut: return "state.signedOut"
            case .tooLarge: return "state.tooLarge"
            case .server: return "state.server"
            case .audioUnreadable: return "state.unreadable"
            }
        }
        switch recording.state {
        case .recording: return "state.recording"
        case .stopped, .ready: return "state.waiting"
        case .created: return "state.uploading"
        case .uploaded: return "state.uploaded"
        }
    }

    private var stateIcon: String {
        if recording.lastError != nil && recording.needsUpload { return "exclamationmark.triangle" }
        return recording.state == .uploaded ? "checkmark.icloud" : "icloud.and.arrow.up"
    }

    private var stateColor: Color {
        if recording.lastError != nil && recording.needsUpload { return .orange }
        return recording.state == .uploaded ? .green : .secondary
    }
}
