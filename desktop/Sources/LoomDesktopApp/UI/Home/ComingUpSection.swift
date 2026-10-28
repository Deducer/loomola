import SwiftUI

/// Granola's "Coming up" card at the top of home: the next few calendar
/// events grouped by day, each day led by a big serif numeral. Reads
/// EventKit through `CalendarAttendeeService.shared`; hidden when the
/// calendar isn't connected or nothing is scheduled.
struct ComingUpSection: View {
    /// Fired when the user clicks an event row; the host starts a note
    /// titled after the event.
    let onStartNote: (CalendarEventCandidate) -> Void

    @State private var days: [ComingUpDay] = []
    @State private var loaded = false

    var body: some View {
        // Always a real container so `.task` runs even while there is
        // nothing to show yet.
        VStack(alignment: .leading, spacing: DSSpacing.md) {
            if !days.isEmpty {
                Text("Coming up")
                    .font(DSFont.Serif.display())
                    .foregroundStyle(DSColor.Text.primary)
                card
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task { load() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            load()
        }
    }

    private var card: some View {
        VStack(spacing: 0) {
            ForEach(Array(days.enumerated()), id: \.element.dayNumber) { index, day in
                dayRow(day)
                if index < days.count - 1 {
                    Rectangle()
                        .fill(DSColor.Border.subtle)
                        .frame(height: 1)
                        .padding(.leading, DSSpacing.lg)
                }
            }
        }
        .background(
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .fill(DSColor.Bg.surface)
        )
        .overlay {
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        }
    }

    private func dayRow(_ day: ComingUpDay) -> some View {
        HStack(alignment: .top, spacing: DSSpacing.lg) {
            HStack(alignment: .top, spacing: 6) {
                Text(day.dayNumber)
                    .font(DSFont.Serif.numeral())
                    .foregroundStyle(DSColor.Text.primary)
                    .frame(width: 36, alignment: .trailing)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Text(day.monthLabel)
                            .font(DSFont.Body.sm())
                            .foregroundStyle(DSColor.Text.secondary)
                        if day.isToday {
                            Circle()
                                .fill(DSColor.State.recording)
                                .frame(width: 5, height: 5)
                        }
                    }
                    Text(day.weekdayLabel)
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Text.tertiary)
                }
                .padding(.top, 6)
            }
            .frame(width: 112, alignment: .leading)

            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                ForEach(day.events, id: \.occurrenceIdentifier) { event in
                    ComingUpEventRow(event: event, onStart: { onStartNote(event) })
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, DSSpacing.lg)
        .padding(.vertical, DSSpacing.md)
    }

    private func load() {
        let service = CalendarAttendeeService.shared
        guard service.hasAccess else {
            days = []
            loaded = true
            return
        }
        let now = Date()
        let horizon = now.addingTimeInterval(Double(ComingUpGrouping.horizonDays) * 86_400)
        let events = service.eventsStarting(after: now.addingTimeInterval(-4 * 3600), before: horizon)
        days = ComingUpGrouping.days(from: events, now: now)
        loaded = true
    }
}

private struct ComingUpEventRow: View {
    let event: CalendarEventCandidate
    let onStart: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(alignment: .top, spacing: DSSpacing.md) {
            RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                .fill(DSColor.Accent.calendar)
                .frame(width: 2.5, height: 34)
            VStack(alignment: .leading, spacing: 3) {
                Text(event.title)
                    .font(DSFont.Body.lg().weight(.regular))
                    .foregroundStyle(DSColor.Text.primary)
                    .lineLimit(1)
                Text(ComingUpGrouping.timeRange(for: event))
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.tertiary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, DSSpacing.sm)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                .fill(hovering ? DSColor.Bg.subtle : Color.clear)
        )
        .contentShape(Rectangle())
        .overlay { ActionHitArea(action: onStart) }
        .onHover { hovering = $0 }
        .help("Start a note for this meeting")
    }
}
