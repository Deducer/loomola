// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "LoomDesktop",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "LoomDesktop", targets: ["LoomDesktopApp"])
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
            path: "Sources/LoomDesktopApp"
        ),
        .testTarget(
            name: "LoomDesktopTests",
            dependencies: ["LoomDesktopApp"],
            path: "Tests/LoomDesktopTests"
        )
    ]
)
