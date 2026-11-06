// swift-tools-version:5.9
// SPDX-License-Identifier: MPL-2.0
// Pure logic of the iOS recorder (Foundation only), so it builds and tests on Linux CI too.
import PackageDescription

let package = Package(
    name: "MinutecaKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "MinutecaKit", targets: ["MinutecaKit"])],
    targets: [
        .target(name: "MinutecaKit"),
        .testTarget(name: "MinutecaKitTests", dependencies: ["MinutecaKit"]),
    ]
)
