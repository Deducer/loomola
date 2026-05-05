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
    ]
)
