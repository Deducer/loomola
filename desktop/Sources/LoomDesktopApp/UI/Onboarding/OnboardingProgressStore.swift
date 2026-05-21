import Foundation
import SwiftUI

enum OnboardingPhase: String, CaseIterable, Sendable {
    case setup = "Setup"
    case learn = "Learn"
}

enum OnboardingStep: Int, CaseIterable, Identifiable, Sendable {
    case welcome
    case permissions
    case defaults
    case learnVideo
    case learnNotes

    var id: Int { rawValue }

    var phase: OnboardingPhase {
        switch self {
        case .welcome, .permissions, .defaults:
            return .setup
        case .learnVideo, .learnNotes:
            return .learn
        }
    }

    var next: OnboardingStep? {
        OnboardingStep(rawValue: rawValue + 1)
    }

    var previous: OnboardingStep? {
        OnboardingStep(rawValue: rawValue - 1)
    }

    static func clamped(rawValue: Int) -> OnboardingStep {
        let maxValue = (allCases.last ?? .learnNotes).rawValue
        return OnboardingStep(rawValue: min(max(rawValue, 0), maxValue)) ?? .welcome
    }
}

@MainActor
final class OnboardingProgressStore: ObservableObject {
    nonisolated static let currentVersion = 1

    @Published private(set) var completedAt: Date?
    @Published private(set) var skippedAt: Date?
    @Published private(set) var currentStep: OnboardingStep

    private let defaults: UserDefaults
    private let version: Int

    init(
        defaults: UserDefaults = .standard,
        version: Int = OnboardingProgressStore.currentVersion
    ) {
        self.defaults = defaults
        self.version = version
        completedAt = defaults.object(forKey: Self.completedKey(version: version)) as? Date
        skippedAt = defaults.object(forKey: Self.skippedKey(version: version)) as? Date
        currentStep = OnboardingStep.clamped(
            rawValue: defaults.integer(forKey: Self.lastStepKey(version: version))
        )
    }

    var shouldShow: Bool {
        completedAt == nil && skippedAt == nil
    }

    var statusText: String {
        if completedAt != nil {
            return "Completed"
        }
        if skippedAt != nil {
            return "Skipped"
        }
        return "Not finished"
    }

    func recordStep(_ step: OnboardingStep) {
        currentStep = step
        defaults.set(step.rawValue, forKey: Self.lastStepKey(version: version))
    }

    func complete(now: Date = Date()) {
        completedAt = now
        skippedAt = nil
        defaults.set(now, forKey: Self.completedKey(version: version))
        defaults.removeObject(forKey: Self.skippedKey(version: version))
        defaults.removeObject(forKey: Self.lastStepKey(version: version))
    }

    func skip(now: Date = Date()) {
        skippedAt = now
        completedAt = nil
        defaults.set(now, forKey: Self.skippedKey(version: version))
        defaults.removeObject(forKey: Self.completedKey(version: version))
        defaults.removeObject(forKey: Self.lastStepKey(version: version))
    }

    func replay() {
        completedAt = nil
        skippedAt = nil
        currentStep = .welcome
        defaults.removeObject(forKey: Self.completedKey(version: version))
        defaults.removeObject(forKey: Self.skippedKey(version: version))
        defaults.set(OnboardingStep.welcome.rawValue, forKey: Self.lastStepKey(version: version))
    }

    private static func completedKey(version: Int) -> String {
        "loomola.onboarding.v\(version).completedAt"
    }

    private static func skippedKey(version: Int) -> String {
        "loomola.onboarding.v\(version).skippedAt"
    }

    private static func lastStepKey(version: Int) -> String {
        "loomola.onboarding.v\(version).lastStep"
    }
}
