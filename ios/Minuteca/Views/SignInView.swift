// SPDX-License-Identifier: MPL-2.0
import SwiftUI

struct SignInView: View {
    @EnvironmentObject private var auth: AuthService
    @State private var sending = false
    @State private var showServer = false
    @State private var serverText = ""
    @State private var badServer = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Image(systemName: "mic.circle.fill").font(.system(size: 48)).foregroundStyle(.indigo)
                        Text("signin.title").font(.title.bold())
                        Text("signin.tagline").foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 8)
                }
                if auth.linkSent {
                    Section {
                        Label("signin.sentTitle", systemImage: "envelope.badge")
                        Text("signin.sent \(auth.email)").foregroundStyle(.secondary)
                        Button("signin.cancel", role: .cancel) { auth.cancelLink() }
                    }
                } else {
                    Section {
                        TextField("signin.email", text: $auth.email)
                            .keyboardType(.emailAddress)
                            .textContentType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button {
                            sending = true
                            Task {
                                await auth.requestLink()
                                sending = false
                            }
                        } label: {
                            HStack {
                                Text("signin.send")
                                if sending { Spacer(); ProgressView() }
                            }
                        }
                        .disabled(sending)
                    } footer: {
                        Text("signin.onlyList")
                    }
                }
                if let problem = auth.problem {
                    Section { Text(problem).foregroundStyle(.red) }
                }
                Section {
                    DisclosureGroup("signin.server", isExpanded: $showServer) {
                        Text(auth.server.absoluteString).font(.footnote).foregroundStyle(.secondary)
                        TextField("signin.serverPlaceholder", text: $serverText)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button("signin.serverSave") { badServer = !auth.setServer(serverText) }
                        if badServer { Text("signin.serverInvalid").foregroundStyle(.red) }
                    }
                }
            }
        }
    }
}

struct LockedView: View {
    let unlock: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "lock.fill").font(.system(size: 44)).foregroundStyle(.secondary)
            Text("lock.title").font(.title2.bold())
            Button("lock.unlock", action: unlock).buttonStyle(.borderedProminent)
        }
        .padding()
    }
}
