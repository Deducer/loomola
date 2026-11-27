import XCTest
@testable import LoomDesktopApp

final class MicCheckResultTests: XCTestCase {
    func testNoBuffersMeansFailed() {
        XCTAssertEqual(MicCheckResult.verdict(buffers: 0, peak: 0.5), .failed)
    }

    func testQuietMicIsSilent() {
        XCTAssertEqual(MicCheckResult.verdict(buffers: 40, peak: 0.004), .silent)
    }

    func testSpeechIsHeard() {
        XCTAssertEqual(MicCheckResult.verdict(buffers: 40, peak: 0.2), .heard)
    }
}
