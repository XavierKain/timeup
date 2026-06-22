// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Timup",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "TimupApp", targets: ["TimupApp"]),
        .library(name: "TimupCore", targets: ["TimupCore"]),
    ],
    targets: [
        // Pure logic, no AppKit — fully unit-testable.
        .target(name: "TimupCore"),
        // The menu-bar agent. AppKit/SwiftUI, system frameworks only (no external deps).
        .executableTarget(
            name: "TimupApp",
            dependencies: ["TimupCore"]
        ),
        // Functional smoke test: drives the real brain via BrainClient on a
        // throwaway timer, then discards. Run with `swift run TimupSmoke`.
        .executableTarget(
            name: "TimupSmoke",
            dependencies: ["TimupCore"]
        ),
        .testTarget(
            name: "TimupCoreTests",
            dependencies: ["TimupCore"]
        ),
    ]
)
