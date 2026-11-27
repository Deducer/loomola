import Foundation
import OSLog
import SwiftUI

private let micCheckLog = Logger(subsystem: "cloud.dissonance.loom.desktop", category: "miccheck")

/// Result of a short "say something" mic test before recording.
enum MicCheckResult: Equatable {
    case idle
    case listening
    /// Sound above the threshold reached the app.
    case heard
    /// The mic opened but delivered nothing above the threshold.
    case silent
    /// The mic never delivered audio (start failed or timed out).
    case failed

    /// Verdict once listening ends. `buffers` is how many audio
    /// buffers arrived; zero means the mic never really started.
    static func verdict(buffers: Int, peak: Double) -> MicCheckResult {
        if buffers == 0 { return .failed }
        return peak >= VideoMicStatus.soundThreshold ? .heard : .silent
    }
}

/// Opens the selected mic for a few seconds with no file writer and
/// reports whether it heard anything. On Bluetooth headsets opening
/// the mic switches the headset to its call profile, so this only
/// runs when asked, never in the background.
@MainActor
final class MicCheckController: ObservableObject {
    static let listenSeconds: Double = 5

    @Published private(set) var result: MicCheckResult = .idle
    @Published private(set) var level: Double = 0

    private var coordinator: MicrophoneCaptureCoordinator?
    private var runTask: Task<Void, Never>?
    private var peak: Double = 0
    private var buffers = 0

    func run(deviceID: String?) {
        cancel()
        result = .listening
        level = 0
        peak = 0
        buffers = 0
        let coordinator = MicrophoneCaptureCoordinator()
        coordinator.onLevel = { [weak self] value in
            Task { @MainActor in
                guard let self, self.result == .listening else { return }
                self.buffers += 1
                self.level = value
                self.peak = max(self.peak, value)
            }
        }
        self.coordinator = coordinator
        runTask = Task { @MainActor [weak self] in
            do {
                try await coordinator.startWithTimeout(deviceID: deviceID, outputURL: nil)
            } catch {
                guard let self, !Task.isCancelled, self.coordinator === coordinator else { return }
                micCheckLog.error("mic check could not start: \(error.localizedDescription, privacy: .public)")
                self.finish(failedToStart: true)
                return
            }
            // Cancelled (or replaced) while the mic was still opening: the
            // cancel's stop() found no engine yet, so stop it now or the
            // mic stays open with nobody owning it.
            guard let self, !Task.isCancelled, self.coordinator === coordinator else {
                _ = try? await coordinator.stop()
                return
            }
            try? await Task.sleep(nanoseconds: UInt64(Self.listenSeconds * 1_000_000_000))
            guard !Task.isCancelled, self.coordinator === coordinator else { return }
            self.finish(failedToStart: false)
        }
    }

    func cancel() {
        runTask?.cancel()
        runTask = nil
        stopCoordinator()
        if result == .listening { result = .idle }
        level = 0
    }

    private func finish(failedToStart: Bool) {
        stopCoordinator()
        result = failedToStart ? .failed : MicCheckResult.verdict(buffers: buffers, peak: peak)
        level = 0
        micCheckLog.notice("mic check result=\(String(describing: self.result), privacy: .public) peak=\(self.peak, privacy: .public) buffers=\(self.buffers, privacy: .public)")
    }

    private func stopCoordinator() {
        guard let coordinator else { return }
        self.coordinator = nil
        Task { _ = try? await coordinator.stop() }
    }
}

/// "Test mic" control with a live meter and a plain verdict.
struct MicCheckRow: View {
    @ObservedObject var check: MicCheckController
    let deviceID: String?
    let deviceName: String

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: iconName)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 16)
            if check.result == .listening {
                MicCheckMeter(level: check.level)
                    .frame(width: 80, height: 8)
            }
            Text(message)
                .font(DSFont.Body.sm())
                .foregroundStyle(check.result == .idle ? DSColor.Text.secondary : tint)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: DSSpacing.sm)
            SecondaryButton(check.result == .listening ? "Listening…" : "Test mic", icon: "waveform") {
                check.run(deviceID: deviceID)
            }
            .disabled(check.result == .listening)
        }
        .accessibilityElement(children: .combine)
        .onDisappear { check.cancel() }
    }

    private var message: String {
        switch check.result {
        case .idle: return "Check \(deviceName) before you record"
        case .listening: return "Say something…"
        case .heard: return "\(deviceName) is working"
        case .silent: return "Didn't hear anything from \(deviceName). Check it's unmuted, or pick another mic."
        case .failed: return "\(deviceName) didn't start. Pick another mic or reconnect it."
        }
    }

    private var iconName: String {
        switch check.result {
        case .failed, .silent: return "mic.slash.fill"
        case .heard: return "checkmark.circle.fill"
        default: return "mic.fill"
        }
    }

    private var tint: Color {
        switch check.result {
        case .heard: return DSColor.State.success
        case .silent: return DSColor.State.warning
        case .failed: return DSColor.State.danger
        case .idle, .listening: return DSColor.Text.secondary
        }
    }
}

private struct MicCheckMeter: View {
    let level: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(DSColor.Bg.subtle)
                Capsule()
                    .fill(level >= VideoMicStatus.soundThreshold ? DSColor.State.success : DSColor.Text.tertiary)
                    // Peak level is linear and speech peaks around 0.1-0.5;
                    // a square root makes normal speech fill most of the bar.
                    .frame(width: proxy.size.width * min(1, sqrt(max(0, level)) * 1.4))
            }
        }
        .animation(.linear(duration: 0.08), value: level)
        .accessibilityLabel("Microphone level")
    }
}
