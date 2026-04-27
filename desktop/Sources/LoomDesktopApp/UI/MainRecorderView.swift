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

            if viewModel.state == .signedOut {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Sign in")
                        .font(.headline)
                    TextField("Email", text: $viewModel.email)
                        .textFieldStyle(.roundedBorder)
                    SecureField("Password", text: $viewModel.password)
                        .textFieldStyle(.roundedBorder)
                    Button("Sign in") {
                        viewModel.signIn()
                    }
                    .keyboardShortcut(.return, modifiers: [.command])
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("v1 scope")
                        .font(.headline)
                    Text("Sign in, capture one screen, show a draggable camera bubble, upload through the existing Loom Clone backend, then open the web dashboard.")
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Status")
                    .font(.headline)
                Text(viewModel.statusMessage)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            HStack {
                Button("Start Recording") {
                    viewModel.startRecordingPlaceholder()
                }
                .keyboardShortcut("r", modifiers: [.command])
                .disabled(viewModel.state == .signedOut)

                Button("Stop") {
                    viewModel.stopRecordingPlaceholder()
                }
                .disabled(!viewModel.state.isRecordingLike)

                Button("Test Backend") {
                    viewModel.startAndAbortBackendHandshake()
                }
                .disabled(viewModel.state == .signedOut)

                Spacer()

                Button("Open Dashboard") {
                    NSWorkspace.shared.open(URL(string: "https://loom.dissonance.cloud")!)
                }

                if viewModel.state != .signedOut {
                    Button("Sign Out") {
                        viewModel.signOut()
                    }
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
