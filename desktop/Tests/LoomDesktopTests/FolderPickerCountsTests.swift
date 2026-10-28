import XCTest
@testable import LoomDesktopApp

final class FolderPickerCountsTests: XCTestCase {
    private func folder(_ name: String, favorite: Bool = false, count: Int? = nil) -> FolderDTO {
        FolderDTO(id: name.lowercased(), name: name, parentId: nil, isFavorite: favorite, icon: nil, recordingCount: count)
    }

    func testFavouritesCollapseBehindShowMore() {
        let folders = [
            folder("Zeta", favorite: true, count: 4),
            folder("Alpha", favorite: true, count: 60),
            folder("Beta", favorite: true, count: 67),
            folder("Gamma", favorite: true, count: 45),
            folder("Team"),
        ]
        let rows = FolderPickerRows.build(folders: folders, limit: 3)
        XCTAssertEqual(rows.count, 5)
        XCTAssertEqual(rows[0], .folder(folder("Alpha", favorite: true, count: 60)))
        XCTAssertEqual(rows[3], .showMore(remaining: 1))
        XCTAssertEqual(rows[4], .folder(folder("Team")))
    }

    func testExpandedShowsEveryFavourite() {
        let folders = (1...5).map { folder("F\($0)", favorite: true) }
        let rows = FolderPickerRows.build(folders: folders, limit: 3, expanded: true)
        XCTAssertEqual(rows.count, 5)
        XCTAssertFalse(rows.contains { if case .showMore = $0 { return true } else { return false } })
    }

    func testPlainListCollapsesWhenNothingIsFavourite() {
        let folders = (1...4).map { folder("F\($0)") }
        let rows = FolderPickerRows.build(folders: folders, limit: 3)
        XCTAssertEqual(rows.last, .showMore(remaining: 1))
    }

    func testCountDecodesWhenPresentAndDefaultsToNil() throws {
        let json = #"{"folders":[{"id":"a","name":"A","parentId":null,"recordingCount":7},{"id":"b","name":"B","parentId":null}]}"#
        let decoded = try JSONDecoder().decode(ListFoldersResponse.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.folders[0].recordingCount, 7)
        XCTAssertNil(decoded.folders[1].recordingCount)
    }
}
