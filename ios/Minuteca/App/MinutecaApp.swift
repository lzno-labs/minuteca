// SPDX-License-Identifier: MPL-2.0
import SwiftUI
import UIKit

/// The recorder for iPhone: it only records, pauses, lists and uploads. Transcription, names,
/// search, export and sharing live in the web app, which also opens on the iPhone.
@main
struct MinutecaApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var phase
    @StateObject private var auth = AuthService.shared
    @StateObject private var recorder = RecorderService.shared
    @StateObject private var uploads = UploadService.shared
    @StateObject private var lock = AppLock()

    var body: some Scene {
        WindowGroup {
            Group {
                if !auth.signedIn {
                    SignInView()
                } else if lock.locked {
                    LockedView(unlock: lock.unlock)
                } else {
                    RootView()
                }
            }
            .environmentObject(auth)
            .environmentObject(recorder)
            .environmentObject(uploads)
            .environmentObject(lock)
            .onOpenURL { url in Task { await auth.handle(url) } }
            .onAppear { if lock.locked && auth.signedIn { lock.unlock() } }
        }
        .onChange(of: phase) { _, now in
            switch now {
            case .background:
                lock.lockIfNeeded()
            case .active:
                if lock.locked && auth.signedIn { lock.unlock() }
                recorder.retryIfInterrupted()
                uploads.uploadPending()
            default:
                break
            }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    /// iOS relaunches the app when background uploads finish; the uploader reconnects to them.
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        Task { @MainActor in
            UploadService.shared.backgroundCompletion = completionHandler
        }
    }
}
