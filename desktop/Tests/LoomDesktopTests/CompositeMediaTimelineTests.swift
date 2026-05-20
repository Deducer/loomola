import CoreMedia
import XCTest
@testable import LoomDesktopApp

final class CompositeMediaTimelineTests: XCTestCase {
    func testVideoFramesStartAtZeroAndStayRelativeToFirstScreenPTS() {
        var timeline = CompositeMediaTimeline()

        let first = timeline.noteVideoFrame(sourcePTS: time(120))
        XCTAssertTrue(first.shouldStartSession)
        XCTAssertEqual(seconds(first.relativePTS), 0, accuracy: 0.001)

        let second = timeline.noteVideoFrame(sourcePTS: time(121.5))
        XCTAssertFalse(second.shouldStartSession)
        XCTAssertEqual(seconds(second.relativePTS), 1.5, accuracy: 0.001)
    }

    func testAudioBeforeFirstVideoFrameIsDropped() {
        var timeline = CompositeMediaTimeline()

        XCTAssertNil(timeline.noteAudioSample(sourcePTS: time(40)))
    }

    func testFirstAudioSampleAnchorsToLatestVideoPosition() throws {
        var timeline = CompositeMediaTimeline()
        _ = timeline.noteVideoFrame(sourcePTS: time(200))
        _ = timeline.noteVideoFrame(sourcePTS: time(202))

        let firstAudioPTS = try XCTUnwrap(timeline.noteAudioSample(sourcePTS: time(10)))
        XCTAssertEqual(seconds(firstAudioPTS), 2, accuracy: 0.001)

        let secondAudioPTS = try XCTUnwrap(timeline.noteAudioSample(sourcePTS: time(10.5)))
        XCTAssertEqual(seconds(secondAudioPTS), 2.5, accuracy: 0.001)
    }

    func testAudioClockRestartReanchorsWithoutGoingBackward() throws {
        var timeline = CompositeMediaTimeline()
        _ = timeline.noteVideoFrame(sourcePTS: time(500))
        _ = timeline.noteVideoFrame(sourcePTS: time(503))

        let firstAudioPTS = try XCTUnwrap(timeline.noteAudioSample(sourcePTS: time(100)))
        XCTAssertEqual(seconds(firstAudioPTS), 3, accuracy: 0.001)

        _ = timeline.noteVideoFrame(sourcePTS: time(505))

        let restartedAudioPTS = try XCTUnwrap(timeline.noteAudioSample(sourcePTS: time(0)))
        XCTAssertEqual(seconds(restartedAudioPTS), 5, accuracy: 0.001)

        let nextAudioPTS = try XCTUnwrap(timeline.noteAudioSample(sourcePTS: time(0.25)))
        XCTAssertEqual(seconds(nextAudioPTS), 5.25, accuracy: 0.001)
    }

    private func time(_ seconds: Double) -> CMTime {
        CMTime(seconds: seconds, preferredTimescale: 48_000)
    }

    private func seconds(_ time: CMTime) -> Double {
        CMTimeGetSeconds(time)
    }
}
