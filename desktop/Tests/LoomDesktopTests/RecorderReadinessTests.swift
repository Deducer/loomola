import XCTest
@testable import LoomDesktopApp

final class RecorderReadinessTests: XCTestCase {
    func testAudioBlocksWhenNoInputsAreEnabled() {
        let snapshot = RecorderReadinessEvaluator.evaluate(
            input(
                mode: .audio,
                includeMic: false,
                includeSystemAudio: false
            )
        )

        XCTAssertFalse(snapshot.canStart)
        XCTAssertEqual(snapshot.state, .blocked)
        XCTAssertEqual(snapshot.primaryIssue?.id, "audio-inputs-off")
    }

    func testAudioBlocksWhenSelectedMicIsMissing() {
        let snapshot = RecorderReadinessEvaluator.evaluate(
            input(
                mode: .audio,
                captureSources: CaptureSourceSnapshot(
                    displays: [],
                    windows: [],
                    cameras: [],
                    microphones: [MediaDeviceSource(id: "studio", name: "Studio Mic")]
                ),
                selectedMicDeviceID: "missing"
            )
        )

        XCTAssertFalse(snapshot.canStart)
        XCTAssertEqual(snapshot.primaryIssue?.id, "selected-audio-mic-missing")
    }

    func testVideoBlocksWithoutScreenPermission() {
        let snapshot = RecorderReadinessEvaluator.evaluate(
            input(
                mode: .video,
                permissionStatus: PermissionStatus(
                    camera: .granted,
                    microphone: .granted,
                    screenRecording: .denied,
                    accessibility: .denied
                )
            )
        )

        XCTAssertFalse(snapshot.canStart)
        XCTAssertTrue(snapshot.issues.contains { $0.id == "screen-permission" })
    }

    func testOrphanWarningStillAllowsRecording() {
        let snapshot = RecorderReadinessEvaluator.evaluate(
            input(mode: .audio, hasUnrescuedOrphans: true)
        )

        XCTAssertTrue(snapshot.canStart)
        XCTAssertEqual(snapshot.state, .degraded)
        XCTAssertEqual(snapshot.primaryIssue?.id, "orphaned-recording")
    }

    func testReadyAudioWithCoreAudioTap() {
        let snapshot = RecorderReadinessEvaluator.evaluate(input(mode: .audio))

        XCTAssertTrue(snapshot.canStart)
        XCTAssertEqual(snapshot.state, .ready)
    }

    func testUnknownBackendKeepsSignedInRecorderChecking() {
        let snapshot = RecorderReadinessEvaluator.evaluate(
            input(mode: .video, backendStatus: .unknown)
        )

        XCTAssertFalse(snapshot.canStart)
        XCTAssertEqual(snapshot.state, .checking)
    }

    private func input(
        mode: RecorderReadinessMode,
        isSignedIn: Bool = true,
        backendStatus: BackendReadinessStatus = .reachable,
        permissionStatus: PermissionStatus = PermissionStatus(
            camera: .granted,
            microphone: .granted,
            screenRecording: .granted,
            accessibility: .denied
        ),
        captureSources: CaptureSourceSnapshot = CaptureSourceSnapshot(
            displays: [DisplaySource(id: 1, name: "Display", width: 1920, height: 1080)],
            windows: [],
            cameras: [MediaDeviceSource(id: "camera", name: "Camera")],
            microphones: [MediaDeviceSource(id: "mic", name: "Mic")]
        ),
        selectedCameraDeviceID: String? = nil,
        selectedMicDeviceID: String? = nil,
        includeMic: Bool = true,
        includeSystemAudio: Bool = false,
        systemAudioCaptureMode: SystemAudioCaptureMode = .coreAudioTap,
        selectedSystemAudioDeviceID: String? = nil,
        allowsAppleSystemAudioCapture: Bool = false,
        supportsScreenCaptureKit: Bool = true,
        hasMainScreen: Bool = true,
        hasUnrescuedOrphans: Bool = false
    ) -> RecorderReadinessInput {
        RecorderReadinessInput(
            mode: mode,
            isSignedIn: isSignedIn,
            backendStatus: backendStatus,
            permissionStatus: permissionStatus,
            captureSources: captureSources,
            captureSourcesLoaded: true,
            selectedCameraDeviceID: selectedCameraDeviceID,
            selectedMicDeviceID: selectedMicDeviceID,
            includeMic: includeMic,
            includeSystemAudio: includeSystemAudio,
            systemAudioCaptureMode: systemAudioCaptureMode,
            selectedSystemAudioDeviceID: selectedSystemAudioDeviceID,
            allowsAppleSystemAudioCapture: allowsAppleSystemAudioCapture,
            supportsScreenCaptureKit: supportsScreenCaptureKit,
            hasMainScreen: hasMainScreen,
            hasUnrescuedOrphans: hasUnrescuedOrphans
        )
    }
}
