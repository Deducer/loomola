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

    func testRecorderWindowDefaultAndMinimumFitHomeLayout() {
        XCTAssertGreaterThanOrEqual(RecorderWindowGeometry.minimumContentSize.width, 1100)
        XCTAssertGreaterThanOrEqual(RecorderWindowGeometry.minimumContentSize.height, 700)
        XCTAssertGreaterThanOrEqual(
            RecorderWindowGeometry.defaultContentSize.width,
            RecorderWindowGeometry.minimumContentSize.width
        )
        XCTAssertGreaterThanOrEqual(
            RecorderWindowGeometry.defaultContentSize.height,
            RecorderWindowGeometry.minimumContentSize.height
        )
        XCTAssertFalse(RecorderWindowGeometry.autosaveName.isEmpty)
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

    func testTopChromeUsesStateAwareTitlebarPinning() throws {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let guardedFiles = [
            root.appending(path: "Sources/LoomDesktopApp/UI/MainRecorderView.swift"),
            root.appending(path: "Sources/LoomDesktopApp/UI/Notes/NoteWorkspaceView.swift")
        ]

        for file in guardedFiles {
            let source = try String(contentsOf: file)
            XCTAssertTrue(
                source.contains(".loomolaTitlebarPinned("),
                "\(file.lastPathComponent) must use the state-aware titlebar pinning helper."
            )
        }
    }

    func testNoteChromeStaysVisibleInFullscreen() throws {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let mainSource = try String(
            contentsOf: root.appending(path: "Sources/LoomDesktopApp/UI/MainRecorderView.swift")
        )
        let noteSource = try String(
            contentsOf: root.appending(path: "Sources/LoomDesktopApp/UI/Notes/NoteWorkspaceView.swift")
        )

        XCTAssertTrue(
            mainSource.contains("pinChromeToTitlebar: !windowIsFullScreen"),
            "Note workspace chrome must respect the safe area in fullscreen so the back button stays visible."
        )
        XCTAssertTrue(
            noteSource.contains("let pinChromeToTitlebar: Bool"),
            "Note workspace needs an explicit titlebar-pinning input from the host window."
        )
    }
}
