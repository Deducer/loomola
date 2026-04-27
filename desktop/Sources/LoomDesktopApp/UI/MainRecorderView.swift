import SwiftUI

struct MainRecorderView: View {
    @StateObject private var viewModel = RecorderViewModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Loom Desktop")
                        .font(.title2.weight(.semibold))
                    Text("Native recorder scaffold")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                StatusPill(state: viewModel.state)
            }

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                Text("v1 scope")
                    .font(.headline)
                Text("Sign in, capture one screen, show a draggable camera bubble, upload through the existing Loom Clone backend, then open the web dashboard.")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Next build slice")
                    .font(.headline)
                Text("Implement bearer-token auth and MP4/M4A upload compatibility in the web API before wiring native capture.")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            HStack {
                Button("Start Recording") {
                    viewModel.startRecordingPlaceholder()
                }
                .keyboardShortcut("r", modifiers: [.command])

                Button("Stop") {
                    viewModel.stopRecordingPlaceholder()
                }
                .disabled(!viewModel.state.isRecordingLike)

                Spacer()

                Button("Open Dashboard") {
                    NSWorkspace.shared.open(URL(string: "https://loom.dissonance.cloud")!)
                }
            }
        }
        .padding(24)
    }
}

private struct StatusPill: View {
    let state: RecorderState

    var body: some View {
        Text(state.label)
            .font(.caption.weight(.medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(.quaternary, in: Capsule())
    }
}
