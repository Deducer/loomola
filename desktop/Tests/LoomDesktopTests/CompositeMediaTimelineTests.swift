import CoreMedia
import XCTest
@testable import LoomDesktopApp

final class CompositeMediaTimelineTests: XCTestCase {
    func testVideoFramesStartAtZeroAndStayRelativeToFirstScreenPTS() throws {
        var timeline = CompositeMediaTimeline()

        let first = try XCTUnwrap(timeline.noteVideoFrame(sourcePTS: time(120)))
        XCTAssertTrue(first.shouldStartSession)
        XCTAssertEqual(seconds(first.relativePTS), 0, accuracy: 0.001)

        let second = try XCTUnwrap(timeline.noteVideoFrame(sourcePTS: time(121.5)))
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

    func testPauseDropsFramesAndAudio() {
        var timeline = CompositeMediaTimeline()
        _ = timeline.noteVideoFrame(sourcePTS: time(10))
        timeline.pause()

        XCTAssertNil(timeline.noteVideoFrame(sourcePTS: time(11)))
        XCTAssertNil(timeline.noteAudioSample(sourcePTS: time(3)))
    }

    func testResumeClosesTheGap() throws {
        var timeline = CompositeMediaTimeline()
        _ = timeline.noteVideoFrame(sourcePTS: time(10))
        _ = timeline.noteVideoFrame(sourcePTS: time(14))
        timeline.pause()
        _ = timeline.noteVideoFrame(sourcePTS: time(20))
        timeline.resume(hostTime: time(60))

        let resumed = try XCTUnwrap(timeline.noteVideoFrame(sourcePTS: time(60)))
        XCTAssertEqual(seconds(resumed.relativePTS), 4 + 1.0 / 30, accuracy: 0.001)

        let later = try XCTUnwrap(timeline.noteVideoFrame(sourcePTS: time(61)))
        XCTAssertEqual(seconds(later.relativePTS), 5 + 1.0 / 30, accuracy: 0.001)
    }

    func testAudioReanchorsAfterResume() throws {
        var timeline = CompositeMediaTimeline()
        _ = timeline.noteVideoFrame(sourcePTS: time(10))
        _ = timeline.noteAudioSample(sourcePTS: time(100))
        _ = timeline.noteVideoFrame(sourcePTS: time(12))
        timeline.pause()
        timeline.resume(hostTime: time(40))

        let audio = try XCTUnwrap(timeline.noteAudioSample(sourcePTS: time(130)))
        XCTAssertEqual(seconds(audio), 2 + 1.0 / 30, accuracy: 0.001)
        let next = try XCTUnwrap(timeline.noteAudioSample(sourcePTS: time(130.5)))
        XCTAssertEqual(seconds(next), 2.5 + 1.0 / 30, accuracy: 0.001)
    }

    /// Talking over a still slide: ScreenCaptureKit sends no frames, so
    /// audio runs ahead of video. Resume must continue after the audio,
    /// never before it.
    func testStaticScreenBeforePauseKeepsAudioInOrder() throws {
        var timeline = CompositeMediaTimeline()
        _ = timeline.noteVideoFrame(sourcePTS: time(10))
        var t = 100.0
        while t < 120 {
            _ = timeline.noteAudioSample(sourcePTS: time(t), duration: time(0.5))
            t += 0.5
        }
        timeline.pause()
        timeline.resume(hostTime: time(70))

        let audio = try XCTUnwrap(timeline.noteAudioSample(sourcePTS: time(300), duration: time(0.5)))
        XCTAssertEqual(seconds(audio), 20, accuracy: 0.001)

        // Screen stays still 5 s after resume; the first new frame lands 5 s on.
        let frame = try XCTUnwrap(timeline.noteVideoFrame(sourcePTS: time(75)))
        XCTAssertEqual(seconds(frame.relativePTS), 25, accuracy: 0.001)
    }

    func testRepeatedPausesAccumulate() throws {
        var timeline = CompositeMediaTimeline()
        _ = timeline.noteVideoFrame(sourcePTS: time(0))
        _ = timeline.noteVideoFrame(sourcePTS: time(10))
        timeline.pause()
        timeline.resume(hostTime: time(30))
        _ = timeline.noteVideoFrame(sourcePTS: time(30))
        _ = timeline.noteVideoFrame(sourcePTS: time(35))
        timeline.pause()
        timeline.resume(hostTime: time(100))
        let frame = try XCTUnwrap(timeline.noteVideoFrame(sourcePTS: time(100)))
        XCTAssertEqual(seconds(frame.relativePTS), 15 + 2.0 / 30, accuracy: 0.001)
    }

    func testFrameFromBeforeResumeIsDropped() {
        var timeline = CompositeMediaTimeline()
        _ = timeline.noteVideoFrame(sourcePTS: time(0))
        _ = timeline.noteVideoFrame(sourcePTS: time(10))
        timeline.pause()
        timeline.resume(hostTime: time(50))
        XCTAssertNil(timeline.noteVideoFrame(sourcePTS: time(49)))
    }

    private func time(_ seconds: Double) -> CMTime {
        CMTime(seconds: seconds, preferredTimescale: 48_000)
    }

    private func seconds(_ time: CMTime) -> Double {
        CMTimeGetSeconds(time)
    }
}
