import XCTest
@testable import LoomDesktopApp

final class OnboardingProgressStoreTests: XCTestCase {
    func testStepNavigationIsBounded() {
        XCTAssertNil(OnboardingStep.welcome.previous)
        XCTAssertEqual(OnboardingStep.welcome.next, .permissions)
        XCTAssertEqual(OnboardingStep.learnVideo.next, .learnNotes)
        XCTAssertNil(OnboardingStep.learnNotes.next)
    }

    func testClampsStoredStepIndex() {
        XCTAssertEqual(OnboardingStep.clamped(rawValue: -10), .welcome)
        XCTAssertEqual(OnboardingStep.clamped(rawValue: 999), .learnNotes)
    }

    @MainActor
    func testCompletionPersistsAndSuppressesTour() {
        let defaults = makeDefaults()
        defer { defaults.removePersistentDomain(forName: defaultsSuiteName) }

        let store = OnboardingProgressStore(defaults: defaults, version: 99)
        XCTAssertTrue(store.shouldShow)

        let completedAt = Date(timeIntervalSince1970: 1_234)
        store.recordStep(.learnNotes)
        store.complete(now: completedAt)

        let restored = OnboardingProgressStore(defaults: defaults, version: 99)
        XCTAssertFalse(restored.shouldShow)
        XCTAssertEqual(restored.completedAt, completedAt)
        XCTAssertNil(restored.skippedAt)
        XCTAssertEqual(restored.currentStep, .welcome)
    }

    @MainActor
    func testReplayClearsCompletionAndRestartsAtWelcome() {
        let defaults = makeDefaults()
        defer { defaults.removePersistentDomain(forName: defaultsSuiteName) }

        let store = OnboardingProgressStore(defaults: defaults, version: 100)
        store.skip(now: Date(timeIntervalSince1970: 2_000))
        XCTAssertFalse(store.shouldShow)

        store.replay()

        XCTAssertTrue(store.shouldShow)
        XCTAssertNil(store.completedAt)
        XCTAssertNil(store.skippedAt)
        XCTAssertEqual(store.currentStep, .welcome)
    }

    private var defaultsSuiteName: String {
        "LoomolaOnboardingProgressStoreTests"
    }

    private func makeDefaults() -> UserDefaults {
        let defaults = UserDefaults(suiteName: defaultsSuiteName)!
        defaults.removePersistentDomain(forName: defaultsSuiteName)
        return defaults
    }
}
