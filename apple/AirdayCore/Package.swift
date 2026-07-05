// swift-tools-version:5.9
//
// AirdayCore — the SwiftPM package a future Xcode app consumes as a
// local dependency. It wraps the Rust `airday-ffi` crate: a prebuilt
// static-library XCFramework plus the uniffi-generated Swift bindings.
//
// Both the `.xcframework` and `Sources/AirdayCore/Generated/` are build
// outputs produced by `apple/build-xcframework.sh` (`bun run build:apple`)
// and are gitignored — run that script before `swift build` / `swift test`.
//
// See spec/swift-ffi-plan.md and apple/README.md.

import PackageDescription

let package = Package(
    name: "AirdayCore",
    // arm64 macOS/iOS only for now — matches the Rust targets the build
    // script produces. Bump if the local toolchain needs it.
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(name: "AirdayCore", targets: ["AirdayCore"]),
    ],
    targets: [
        // The Rust static libs + C headers, one slice per platform.
        .binaryTarget(
            name: "AirdayCoreFFI",
            path: "AirdayCoreFFI.xcframework"
        ),
        // The Swift surface: the uniffi-generated bindings (in Generated/)
        // plus a thin hand-written convenience layer. Depends on the C
        // module the binary target vends.
        .target(
            name: "AirdayCore",
            dependencies: ["AirdayCoreFFI"],
            path: "Sources/AirdayCore"
        ),
        .testTarget(
            name: "AirdayCoreTests",
            dependencies: ["AirdayCore"],
            path: "Tests/AirdayCoreTests"
        ),
    ]
)
