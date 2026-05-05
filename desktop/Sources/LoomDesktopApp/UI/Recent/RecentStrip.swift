import AppKit
import SwiftUI

/// Horizontal row of Recent cards on the idle home view. Renders 4
/// cards by default. Empty state when the user has nothing recorded
/// yet; skeleton state during initial load.
struct RecentStrip: View {
    @ObservedObject var service: RecentRecordingsService

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.md) {
            HStack(alignment: .firstTextBaseline) {
                Text("Recent")
                    .font(DSFont.Display.lg())
                    .foregroundStyle(DSColor.Text.primary)
                Spacer()
                if !service.items.isEmpty {
                    Button("View all", action: openLibrary)
                        .buttonStyle(.plain)
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Accent.primary)
                }
            }

            content
        }
        .onAppear {
            if service.items.isEmpty {
                service.refresh()
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if !service.hasLoaded {
            // Cold-launch skeleton. Once the first refresh
            // completes (success OR error), never show this again
            // — subsequent 60s refreshes update items in place
            // without flashing.
            skeleton
        } else if service.items.isEmpty {
            emptyState
        } else {
            HStack(alignment: .top, spacing: DSSpacing.md) {
                ForEach(service.items.prefix(4)) { recording in
                    RecentCard(recording: recording) { open(recording: recording) }
                }
                Spacer()
            }
        }
    }

    private var skeleton: some View {
        HStack(spacing: DSSpacing.md) {
            ForEach(0..<4, id: \.self) { _ in
                RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                    .fill(DSColor.Bg.subtle)
                    .frame(width: 140, height: 110)
            }
            Spacer()
        }
    }

    private var emptyState: some View {
        VStack(spacing: DSSpacing.md) {
            Image(systemName: "waveform.path.ecg.rectangle")
                .font(.system(size: 42, weight: .light))
                .foregroundStyle(DSColor.Text.tertiary)
            Text("Nothing recorded yet.")
                .font(DSFont.Body.lg())
                .foregroundStyle(DSColor.Text.secondary)
            Text("Hit Start recording or press ⌥⇧R to begin.")
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, DSSpacing.xxl)
    }

    private func open(recording: RecentRecording) {
        let path = recording.kind == .audio ? "/notes/\(recording.slug)" : "/v/\(recording.slug)"
        if let url = URL(string: "https://loom.dissonance.cloud" + path) {
            NSWorkspace.shared.open(url)
        }
    }

    private func openLibrary() {
        if let url = URL(string: "https://loom.dissonance.cloud") {
            NSWorkspace.shared.open(url)
        }
    }
}
