// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "LoomDesktop",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "LoomDesktop", targets: ["LoomDesktopApp"]),
        .executable(name: "LoomDesktopNativeHost", targets: ["LoomDesktopNativeHost"])
    ],
    dependencies: [
        .package(url: "https://github.com/supabase/supabase-swift.git", from: "2.0.0")
    ],
    targets: [
        .executableTarget(
            name: "LoomDesktopApp",
            dependencies: [
                .product(name: "Supabase", package: "supabase-swift")
            ],
            path: "Sources/LoomDesktopApp",
            resources: [
                .copy("Resources/Fonts")
            ]
        ),
        .executableTarget(
            name: "LoomDesktopNativeHost",
            path: "Sources/LoomDesktopNativeHost"
        ),
        .testTarget(
            name: "LoomDesktopTests",
            dependencies: ["LoomDesktopApp"],
            path: "Tests/LoomDesktopTests"
        )
    ],
    swiftLanguageModes: [.v5]
)

// Swift 6 mode emits runtime actor-isolation checks
// (`swift_task_isMainExecutorImpl` reading executor class metadata
// via `objc_msgSend`). On Ian's macOS 26.4.1 / Xcode 26.4.1 setup,
// those checks are crashing inside SwiftUI re-render paths with
//
//   Termination Reason:  Namespace OBJC, Code 1
//   swift_task_isMainExecutorImpl + 36
//   MainActor.assumeIsolated + 88
//   _ButtonGesture.internalBody.getter
//
// and later:
//
//   swift_task_isCurrentExecutorWithFlagsImpl
//   closure #1 in MainRecorderView.body.getter
//
// Target-level `.swiftLanguageMode(.v5)` looked right in this file,
// but SwiftPM still generated `-swift-version 6` for LoomDesktopApp.
// The package-level `swiftLanguageModes: [.v5]` above is the build
// setting that actually changes the emitted compiler flag to
// `-swift-version 5`.
