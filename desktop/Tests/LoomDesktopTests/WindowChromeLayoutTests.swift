import XCTest
@testable import LoomDesktopApp

final class WindowChromeLayoutTests: XCTestCase {
    func testChromeLivesInsideWindowSafeBand() {
        XCTAssertGreaterThanOrEqual(WindowChromeLayout.topPadding, 12)
        XCTAssertGreaterThanOrEqual(WindowChromeLayout.barHeight, 44)
        XCTAssertGreaterThan(WindowChromeLayout.homeContentTopPaddingNormal, WindowChromeLayout.barHeight)
        XCTAssertGreaterThan(WindowChromeLayout.homeContentTopPaddingExpanded, WindowChromeLayout.barHeight)
        XCTAssertGreaterThan(WindowChromeLayout.noteContentTopPadding, WindowChromeLayout.barHeight)
    }

    func testTopChromeDoesNotUseGeometryDependentOffsets() throws {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let guardedFiles = [
            root.appending(path: "Sources/LoomDesktopApp/UI/MainRecorderView.swift"),
            root.appending(path: "Sources/LoomDesktopApp/UI/Notes/NoteWorkspaceView.swift")
        ]

        for file in guardedFiles {
            let source = try String(contentsOf: file)
            XCTAssertFalse(
                source.contains("chromeYOffset"),
                "\(file.lastPathComponent) should use WindowChromeLayout safe padding, not a propagated Y offset."
            )
            XCTAssertFalse(
                source.contains("homeChromeYOffset"),
                "\(file.lastPathComponent) should not reintroduce the fragile homeChromeYOffset path."
            )
        }
    }

    func testTopChromeExplicitlyIgnoresTheTitlebarSafeArea() throws {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let guardedFiles = [
            root.appending(path: "Sources/LoomDesktopApp/UI/MainRecorderView.swift"),
            root.appending(path: "Sources/LoomDesktopApp/UI/Notes/NoteWorkspaceView.swift")
        ]

        for file in guardedFiles {
            let source = try String(contentsOf: file)
            XCTAssertTrue(
                source.contains(".ignoresSafeArea(.container, edges: .top)"),
                "\(file.lastPathComponent) must pin custom chrome into the macOS titlebar band."
            )
        }
    }
}
