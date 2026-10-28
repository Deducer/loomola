import XCTest
@testable import LoomDesktopApp

final class RecentHomeListTests: XCTestCase {
    private func rec(_ id: String, _ kind: RecentRecording.Kind, folder: String? = nil) -> RecentRecording {
        RecentRecording(
            id: id, slug: id, title: id, kind: kind, createdAt: Date(),
            durationSeconds: nil, status: "ready", transcriptReady: nil,
            thumbnailURL: nil, folderId: folder, folderName: folder
        )
    }

    func testHomeShowsNotesAndVideosTogether() {
        let items = [rec("n1", .audio), rec("v1", .video), rec("n2", .audio)]
        let home = RecentHomeList.visibleItems(items, captureMode: .audio, folderFilterId: nil)
        XCTAssertEqual(home.map(\.id), ["n1", "v1", "n2"])
    }

    func testVideosSurfaceIsAFilter() {
        let items = [rec("n1", .audio), rec("v1", .video)]
        let videos = RecentHomeList.visibleItems(items, captureMode: .video, folderFilterId: nil)
        XCTAssertEqual(videos.map(\.id), ["v1"])
    }

    func testFolderFilterAppliesToBothKinds() {
        let items = [rec("n1", .audio, folder: "f"), rec("v1", .video, folder: "f"), rec("n2", .audio)]
        let filed = RecentHomeList.visibleItems(items, captureMode: .audio, folderFilterId: "f")
        XCTAssertEqual(filed.map(\.id), ["n1", "v1"])
    }

    func testDurationLabel() {
        XCTAssertEqual(RecentHomeList.durationLabel(seconds: 208.7), "3:29")
        XCTAssertEqual(RecentHomeList.durationLabel(seconds: 3725), "1:02:05")
        XCTAssertNil(RecentHomeList.durationLabel(seconds: 0))
        XCTAssertNil(RecentHomeList.durationLabel(seconds: nil))
    }
}
