import EventKit
import Foundation
import OSLog
import UserNotifications

struct CalendarMeetingReminder: Equatable, Sendable {
    let notificationIdentifier: String
    let title: String
    let start: Date
    let fireDate: Date
    let joinURL: URL
    let context: MeetingContext
}

/// Pure eligibility and timing logic for calendar reminders.
enum CalendarMeetingReminderPlanner {
    static let leadTime: TimeInterval = 60
    static let schedulingHorizon: TimeInterval = 24 * 60 * 60

    static func reminders(
        from events: [CalendarEventCandidate],
        now: Date,
        horizon: TimeInterval = schedulingHorizon
    ) -> [CalendarMeetingReminder] {
        events.compactMap { event in
            guard !event.isAllDay,
                  !event.isCanceled,
                  !event.isDeclined,
                  event.start > now,
                  event.start <= now.addingTimeInterval(horizon),
                  let joinURL = event.joinURL
            else { return nil }

            let title = event.title.trimmingCharacters(in: .whitespacesAndNewlines)
            let context = context(for: event, title: title, joinURL: joinURL)
            return CalendarMeetingReminder(
                notificationIdentifier: notificationIdentifier(for: event),
                title: title.isEmpty ? "Upcoming meeting" : title,
                start: event.start,
                // If Loomola opens inside the final minute, notify promptly;
                // the start > now guard still guarantees no late reminder.
                fireDate: max(event.start.addingTimeInterval(-leadTime), now.addingTimeInterval(1)),
                joinURL: joinURL,
                context: context
            )
        }
        .sorted { $0.start < $1.start }
    }

    private static func context(
        for event: CalendarEventCandidate,
        title: String,
        joinURL: URL
    ) -> MeetingContext {
        let app = provider(for: joinURL)
        return MeetingContext(
            detectedApp: app.name,
            sourceContextHint: "Calendar · \(event.start.formatted(date: .omitted, time: .shortened))",
            suggestedTitle: title.isEmpty ? app.fallbackTitle : title,
            joinURL: joinURL,
            bundleIdentifier: app.bundleIdentifier,
            calendarEventOccurrenceIdentifier: event.occurrenceIdentifier,
            calendarEventEnd: event.end
        )
    }

    private static func provider(for url: URL) -> (name: String, fallbackTitle: String, bundleIdentifier: String?) {
        let host = url.host?.lowercased() ?? ""
        if host.contains("zoom.us") {
            return ("zoom", "Zoom meeting", "us.zoom.xos")
        }
        if host == "meet.google.com" {
            return ("google-meet", "Google Meet", "com.google.Chrome")
        }
        if host == "teams.microsoft.com" {
            return ("teams", "Teams meeting", "com.microsoft.teams2")
        }
        if host.contains("webex.com") {
            return ("webex", "Webex meeting", "Cisco-Systems.Spark")
        }
        if host == "facetime.apple.com" {
            return ("facetime", "FaceTime call", "com.apple.FaceTime")
        }
        return ("meeting", "Meeting", nil)
    }

    private static func notificationIdentifier(for event: CalendarEventCandidate) -> String {
        let occurrence = "\(event.identifier)|\(Int(event.start.timeIntervalSince1970))|\(event.title)"
        let encoded = Data(occurrence.utf8).base64EncodedString()
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "=", with: "")
        return CalendarReminderNotification.identifierPrefix + String(encoded.prefix(180))
    }
}

enum CalendarReminderPreferences {
    static let enabledKey = "loomola.calendarRemindersEnabled"
    static let nextReminderKey = "loomola.calendarReminderNextSummary"
    static let statusKey = "loomola.calendarReminderStatus"
    static let changed = Notification.Name("loomola.calendarReminderPreferencesChanged")
    static let statusChanged = Notification.Name("loomola.calendarReminderStatusChanged")

    static var isEnabled: Bool {
        UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true
    }

    static var nextReminderSummary: String? {
        UserDefaults.standard.string(forKey: nextReminderKey)
    }

    static var statusSummary: String {
        UserDefaults.standard.string(forKey: statusKey) ?? "Not checked yet"
    }
}

enum CalendarReminderNotification {
    static let identifierPrefix = "loomola.calendar."
    static let categoryIdentifier = "LOOMOLA_CALENDAR_MEETING"
    static let takeNotesActionIdentifier = "LOOMOLA_TAKE_NOTES"
    static let joinActionIdentifier = "LOOMOLA_JOIN_MEETING"

    private enum UserInfoKey {
        static let detectedApp = "detectedApp"
        static let sourceContextHint = "sourceContextHint"
        static let suggestedTitle = "suggestedTitle"
        static let joinURL = "joinURL"
        static let bundleIdentifier = "bundleIdentifier"
        static let calendarEventOccurrenceIdentifier = "calendarEventOccurrenceIdentifier"
        static let calendarEventEnd = "calendarEventEnd"
    }

    static func userInfo(for context: MeetingContext) -> [AnyHashable: Any] {
        var info: [AnyHashable: Any] = [
            UserInfoKey.detectedApp: context.detectedApp,
            UserInfoKey.sourceContextHint: context.sourceContextHint,
            UserInfoKey.suggestedTitle: context.suggestedTitle,
        ]
        info[UserInfoKey.joinURL] = context.joinURL?.absoluteString
        info[UserInfoKey.bundleIdentifier] = context.bundleIdentifier
        info[UserInfoKey.calendarEventOccurrenceIdentifier] = context.calendarEventOccurrenceIdentifier
        info[UserInfoKey.calendarEventEnd] = context.calendarEventEnd?.timeIntervalSince1970
        return info
    }

    static func context(from userInfo: [AnyHashable: Any]) -> MeetingContext? {
        guard let detectedApp = userInfo[UserInfoKey.detectedApp] as? String,
              let sourceContextHint = userInfo[UserInfoKey.sourceContextHint] as? String,
              let suggestedTitle = userInfo[UserInfoKey.suggestedTitle] as? String
        else { return nil }
        return MeetingContext(
            detectedApp: detectedApp,
            sourceContextHint: sourceContextHint,
            suggestedTitle: suggestedTitle,
            joinURL: (userInfo[UserInfoKey.joinURL] as? String).flatMap(URL.init(string:)),
            bundleIdentifier: userInfo[UserInfoKey.bundleIdentifier] as? String,
            calendarEventOccurrenceIdentifier: userInfo[UserInfoKey.calendarEventOccurrenceIdentifier] as? String,
            calendarEventEnd: (userInfo[UserInfoKey.calendarEventEnd] as? Double).map {
                Date(timeIntervalSince1970: $0)
            }
        )
    }
}

@MainActor
final class CalendarReminderCoordinator {
    static let shared = CalendarReminderCoordinator()

    private let center = UNUserNotificationCenter.current()
    private let calendarService = CalendarAttendeeService.shared
    private let log = Logger(
        subsystem: "cloud.dissonance.loom.desktop",
        category: "calendar-reminders"
    )
    private var refreshTimer: Timer?
    private var calendarObserver: NSObjectProtocol?

    func start() {
        registerCategory()
        if calendarObserver == nil {
            calendarObserver = NotificationCenter.default.addObserver(
                forName: .EKEventStoreChanged,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor in self?.refresh() }
            }
        }
        NotificationCenter.default.addObserver(
            forName: CalendarReminderPreferences.changed,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 5 * 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        refresh()
    }

    func refresh() {
        Task { @MainActor in
            guard CalendarReminderPreferences.isEnabled else {
                await clearPendingReminders()
                publishStatus("Calendar reminders are off.", next: nil)
                return
            }
            guard calendarService.hasAccess else {
                await clearPendingReminders()
                publishStatus("Calendar access is required.", next: nil)
                return
            }

            let settings = await center.notificationSettings()
            var authorizationStatus = settings.authorizationStatus
            if authorizationStatus == .notDetermined {
                do {
                    _ = try await center.requestAuthorization(options: [.alert, .sound])
                    authorizationStatus = await center.notificationSettings().authorizationStatus
                } catch {
                    publishStatus("Notification permission failed: \(error.localizedDescription)", next: nil)
                    return
                }
            }
            guard authorizationStatus == .authorized || authorizationStatus == .provisional else {
                await clearPendingReminders()
                publishStatus("macOS notifications are disabled for Loomola.", next: nil)
                return
            }

            let now = Date()
            let events = calendarService.eventsStarting(
                after: now,
                before: now.addingTimeInterval(CalendarMeetingReminderPlanner.schedulingHorizon)
            )
            let reminders = CalendarMeetingReminderPlanner.reminders(from: events, now: now)
            await reconcile(reminders: reminders, now: now)
            let next = reminders.first.map {
                "\($0.title) · \($0.start.formatted(date: .abbreviated, time: .shortened))"
            }
            publishStatus(
                reminders.isEmpty
                    ? "No joinable meetings in the next 24 hours."
                    : "Scheduled \(reminders.count) meeting reminder\(reminders.count == 1 ? "" : "s").",
                next: next
            )
        }
    }

    private func reconcile(reminders: [CalendarMeetingReminder], now: Date) async {
        let pending = await center.pendingNotificationRequests()
        let owned = pending.filter { $0.identifier.hasPrefix(CalendarReminderNotification.identifierPrefix) }
        let desiredIdentifiers = Set(reminders.map(\.notificationIdentifier))
        let existingIdentifiers = Set(owned.map(\.identifier))
        let stale = existingIdentifiers.subtracting(desiredIdentifiers)
        if !stale.isEmpty {
            center.removePendingNotificationRequests(withIdentifiers: Array(stale))
        }

        for reminder in reminders where !existingIdentifiers.contains(reminder.notificationIdentifier) {
            let content = UNMutableNotificationContent()
            content.title = reminder.title
            content.body = "Starts in one minute"
            content.sound = .default
            content.categoryIdentifier = CalendarReminderNotification.categoryIdentifier
            content.threadIdentifier = "loomola-calendar-meetings"
            content.userInfo = CalendarReminderNotification.userInfo(for: reminder.context)
            content.interruptionLevel = .timeSensitive

            let interval = reminder.fireDate.timeIntervalSince(now)
            let trigger: UNNotificationTrigger
            if interval <= 1.5 {
                trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
            } else {
                let components = Calendar.current.dateComponents(
                    [.year, .month, .day, .hour, .minute, .second],
                    from: reminder.fireDate
                )
                trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            }
            do {
                try await center.add(
                    UNNotificationRequest(
                        identifier: reminder.notificationIdentifier,
                        content: content,
                        trigger: trigger
                    )
                )
            } catch {
                log.error("failed to schedule \(reminder.title, privacy: .public): \(error.localizedDescription, privacy: .public)")
            }
        }
        log.notice("calendar reminder reconciliation → \(reminders.count, privacy: .public) desired, \(stale.count, privacy: .public) removed")
    }

    private func clearPendingReminders() async {
        let identifiers = await center.pendingNotificationRequests()
            .map(\.identifier)
            .filter { $0.hasPrefix(CalendarReminderNotification.identifierPrefix) }
        if !identifiers.isEmpty {
            center.removePendingNotificationRequests(withIdentifiers: identifiers)
        }
    }

    private func registerCategory() {
        let takeNotes = UNNotificationAction(
            identifier: CalendarReminderNotification.takeNotesActionIdentifier,
            title: "Take Notes",
            options: [.foreground]
        )
        let join = UNNotificationAction(
            identifier: CalendarReminderNotification.joinActionIdentifier,
            title: "Join Meeting",
            options: []
        )
        center.setNotificationCategories([
            UNNotificationCategory(
                identifier: CalendarReminderNotification.categoryIdentifier,
                actions: [takeNotes, join],
                intentIdentifiers: [],
                options: []
            )
        ])
    }

    private func publishStatus(_ status: String, next: String?) {
        UserDefaults.standard.set(status, forKey: CalendarReminderPreferences.statusKey)
        if let next {
            UserDefaults.standard.set(next, forKey: CalendarReminderPreferences.nextReminderKey)
        } else {
            UserDefaults.standard.removeObject(forKey: CalendarReminderPreferences.nextReminderKey)
        }
        NotificationCenter.default.post(name: CalendarReminderPreferences.statusChanged, object: nil)
    }
}
