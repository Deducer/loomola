import XCTest
@testable import LoomDesktopApp

final class MultipartUploadCoordinatorTests: XCTestCase {
    func testPartRangesUseTargetPartSize() {
        let partSize = MultipartUploadCoordinator.targetPartSize
        let ranges = MultipartUploadCoordinator.partRanges(fileSize: partSize * 2 + 7)

        XCTAssertEqual(ranges, [
            0..<partSize,
            partSize..<(partSize * 2),
            (partSize * 2)..<(partSize * 2 + 7)
        ])
    }

    func testPartRangesReturnNoPartsForEmptyFile() {
        XCTAssertEqual(MultipartUploadCoordinator.partRanges(fileSize: 0), [])
    }
}
