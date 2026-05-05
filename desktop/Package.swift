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
            ],
            swiftSettings: swift5LanguageMode
        ),
        .executableTarget(
            name: "LoomDesktopNativeHost",
            path: "Sources/LoomDesktopNativeHost",
            swiftSettings: swift5LanguageMode
        ),
        .testTarget(
            name: "LoomDesktopTests",
            dependencies: ["LoomDesktopApp"],
            path: "Tests/LoomDesktopTests",
            swiftSettings: swift5LanguageMode
        )
    ]
)

// Swift 6 mode emits aggressive runtime actor-isolation checks
// (`swift_task_isMainExecutorImpl` reading executor class metadata
// via `objc_msgSend`). These checks have a bug on macOS 26.4.1
// where reading the executor's metadata returns a corrupt pointer,
// crashing the app on every SwiftUI button dispatch with
//
//   Termination Reason:  Namespace OBJC, Code 1
//   swift_task_isMainExecutorImpl + 36
//   MainActor.assumeIsolated + 88
//   _ButtonGesture.internalBody.getter
//
// Confirmed by Ian's six identical crash reports — none of our
// own code is on the stack. Pinning the language mode to Swift 5
// emits the older non-strict isolation checks, bypassing the
// buggy runtime path. Revisit when macOS 26.5+ is available; the
// bug is likely fixed in a near-term Apple release.
private let swift5LanguageMode: [SwiftSetting] = [
    .swiftLanguageMode(.v5)
]
