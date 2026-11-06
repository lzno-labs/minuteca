// SPDX-License-Identifier: MPL-2.0
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var lock: AppLock
    @EnvironmentObject private var uploads: UploadService
    @Environment(\.dismiss) private var dismiss
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Link(destination: auth.server) {
                        Label("settings.openWeb", systemImage: "safari")
                    }
                } footer: {
                    Text("settings.webHint")
                }
                Section {
                    Toggle("settings.faceId", isOn: $lock.enabled)
                }
                Section {
                    LabeledContent("settings.account", value: auth.email)
                    LabeledContent("settings.server", value: auth.server.host ?? "")
                    Button("settings.signOut", role: .destructive) { confirmSignOut = true }
                } footer: {
                    Text("settings.signOutHint")
                }
                Section {
                    Text("settings.privacy").font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("settings.title")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("common.done") { dismiss() } } }
            .confirmationDialog("settings.signOutConfirm", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("settings.signOut", role: .destructive) {
                    Task {
                        await auth.signOut()
                        dismiss()
                    }
                }
            }
        }
    }
}
