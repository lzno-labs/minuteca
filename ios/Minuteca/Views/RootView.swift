// SPDX-License-Identifier: MPL-2.0
import MinutecaKit
import SwiftUI

struct RootView: View {
    @EnvironmentObject private var recorder: RecorderService
    @EnvironmentObject private var uploads: UploadService
    @EnvironmentObject private var auth: AuthService
    @Environment(\.openURL) private var openURL
    @State private var settings = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    RecorderPanel()
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                if uploads.pendingCount > 0 {
                    Section {
                        HStack(spacing: 12) {
                            Image(systemName: "icloud.and.arrow.up")
                                .font(.title3)
                                .foregroundStyle(.orange)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("uploads.pending \(uploads.pendingCount)").font(.subheadline.weight(.semibold))
                                Text("uploads.pendingHint").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            Button("uploads.retry") { uploads.uploadPending() }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                                .disabled(uploads.working)
                        }
                    }
                }
                Section("list.title") {
                    if uploads.recordings.isEmpty {
                        ContentUnavailableView {
                            Label("list.empty", systemImage: "waveform")
                        } description: {
                            Text("list.emptyHint")
                        }
                    }
                    ForEach(uploads.recordings) { r in
                        Button {
                            if r.state == .uploaded { openURL(webURL(for: r)) }
                        } label: {
                            RecordingRow(recording: r)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("app.title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { openURL(auth.server) } label: { Image(systemName: "safari") }
                        .accessibilityLabel(Text("settings.openWeb"))
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { settings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel(Text("settings.title"))
                }
            }
            .sheet(isPresented: $settings) { SettingsView() }
            .refreshable { uploads.uploadPending() }
        }
    }

    /// The meeting in the web app, where it is transcribed and shared (/?m=<id>).
    private func webURL(for r: Recording) -> URL {
        var c = URLComponents(url: auth.server, resolvingAgainstBaseURL: false) ?? URLComponents()
        c.queryItems = [URLQueryItem(name: "m", value: r.meetingId)]
        return c.url ?? auth.server
    }
}

struct RecorderPanel: View {
    @EnvironmentObject private var recorder: RecorderService
    @State private var pulse = false

    private var live: Bool { recorder.status == .recording || recorder.status == .paused || recorder.status == .interrupted }

    var body: some View {
        VStack(spacing: 18) {
            Label(statusText, systemImage: statusIcon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(statusColor)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(statusColor.opacity(0.12), in: Capsule())

            Text(Duration.seconds(recorder.elapsed).formatted(.time(pattern: .hourMinuteSecond)))
                .font(.system(size: 54, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .contentTransition(.numericText())
                .animation(.default, value: Int(recorder.elapsed))

            LevelMeter(level: recorder.status == .recording ? recorder.level : 0)
                .frame(height: 28)
                .padding(.horizontal, 24)
                .accessibilityLabel(Text("recorder.level"))

            HStack(spacing: 28) {
                if live {
                    Button { recorder.status == .paused ? recorder.resume() : recorder.pause() } label: {
                        Image(systemName: recorder.status == .paused ? "play.fill" : "pause.fill")
                            .font(.title2)
                            .frame(width: 64, height: 64)
                            .background(Color(.secondarySystemFill), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(recorder.status == .interrupted)
                    .accessibilityLabel(Text(recorder.status == .paused ? LocalizedStringKey("recorder.resume") : LocalizedStringKey("recorder.pause")))
                }
                Button {
                    if live { recorder.stop() } else { Task { await recorder.start() } }
                } label: {
                    ZStack {
                        if recorder.status == .recording {
                            Circle()
                                .stroke(Color.red.opacity(0.35), lineWidth: 6)
                                .frame(width: 104, height: 104)
                                .scaleEffect(pulse ? 1.18 : 1)
                                .opacity(pulse ? 0 : 1)
                                .animation(.easeOut(duration: 1.4).repeatForever(autoreverses: false), value: pulse)
                                .onAppear { pulse = true }
                                .onDisappear { pulse = false }
                        }
                        Circle()
                            .fill(Color.red.gradient)
                            .frame(width: 88, height: 88)
                            .shadow(color: .red.opacity(0.3), radius: 10, y: 4)
                        Image(systemName: live ? "stop.fill" : "mic.fill")
                            .font(.system(size: 32, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                    .frame(width: 110, height: 110)
                }
                .buttonStyle(.plain)
                .disabled(recorder.status == .finishing)
                .accessibilityLabel(Text(live ? LocalizedStringKey("recorder.stop") : LocalizedStringKey("recorder.start")))
                .sensoryFeedback(trigger: recorder.status) { old, new in
                    if new == .recording && old == .idle { return .start }
                    if new == .idle && old != .idle { return .stop }
                    return nil
                }
            }

            if let problem = recorder.problem {
                Text(problem).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
            }
            Text(recorder.status == .idle ? LocalizedStringKey("recorder.hint") : LocalizedStringKey("recorder.lockHint"))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
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

    private var statusIcon: String {
        switch recorder.status {
        case .idle: return "mic"
        case .recording: return "record.circle"
        case .paused: return "pause.circle"
        case .interrupted: return "phone.circle"
        case .finishing: return "arrow.down.circle"
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

/// Bars that follow the microphone level, quiet when not recording.
struct LevelMeter: View {
    let level: Float
    private let bars = 24

    var body: some View {
        GeometryReader { geo in
            HStack(alignment: .center, spacing: 3) {
                ForEach(0..<bars, id: \.self) { i in
                    let center = abs(Double(i) - Double(bars - 1) / 2) / (Double(bars) / 2)
                    let height = max(0.12, Double(level) * (1 - center * 0.7))
                    Capsule()
                        .fill(i < bars * 2 / 3 ? Color.green : (i < bars * 5 / 6 ? Color.yellow : Color.red))
                        .opacity(level > 0 ? 0.85 : 0.25)
                        .frame(height: geo.size.height * height)
                }
            }
            .frame(maxHeight: .infinity)
            .animation(.easeOut(duration: 0.15), value: level)
        }
    }
}

struct RecordingRow: View {
    let recording: Recording

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: stateIcon)
                .font(.title3)
                .foregroundStyle(stateColor)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(recording.title).font(.body.weight(.medium)).lineLimit(1)
                HStack(spacing: 6) {
                    Text(recording.startedAt.formatted(.dateTime.day().month(.abbreviated).hour().minute()))
                    Text("·")
                    Text(Duration.seconds(recording.duration).formatted(.units(allowed: [.hours, .minutes], width: .abbreviated)))
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                Text(stateText).font(.caption.weight(.medium)).foregroundStyle(stateColor)
                if recording.recovered && recording.needsUpload {
                    Text("list.recovered").font(.caption2).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 4)
            if recording.state == .uploaded {
                Image(systemName: "arrow.up.right.square")
                    .foregroundStyle(.tint)
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
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
        if recording.lastError != nil && recording.needsUpload { return "exclamationmark.icloud" }
        switch recording.state {
        case .recording: return "record.circle"
        case .uploaded: return "checkmark.icloud"
        default: return "icloud.and.arrow.up"
        }
    }

    private var stateColor: Color {
        if recording.lastError != nil && recording.needsUpload { return .orange }
        return recording.state == .uploaded ? .green : .secondary
    }
}
