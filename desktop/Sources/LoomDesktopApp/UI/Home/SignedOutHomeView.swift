import SwiftUI

/// Signed-out screen. Centered brand moment instead of a system form.
/// Email + password fields use the new `Field` token; Sign in is a
/// primary CTA at full width.
struct SignedOutHomeView: View {
    @ObservedObject var viewModel: RecorderViewModel
    @FocusState private var focusedField: SignedOutField?

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: DSSpacing.xl) {
                BrandLogoMark(size: 64)

                VStack(spacing: DSSpacing.sm) {
                    Text("Capture you own.")
                        .font(DSFont.Display.xl())
                        .foregroundStyle(DSColor.Text.primary)
                    Text("Self-hosted screen recording + AI meeting notes. One workspace.")
                        .font(DSFont.Body.md())
                        .foregroundStyle(DSColor.Text.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 360)
                }

                VStack(spacing: DSSpacing.md) {
                    Field(placeholder: "Email", text: $viewModel.email, icon: "envelope")
                        .focused($focusedField, equals: .email)
                        .disabled(viewModel.isSigningIn)
                    Field(placeholder: "Password", text: $viewModel.password, icon: "lock", isSecure: true)
                        .focused($focusedField, equals: .password)

                    if shouldShowStatus {
                        signInStatus(viewModel.statusMessage)
                    }

                    PrimaryButton(
                        viewModel.isSigningIn ? "Signing in" : "Sign in",
                        icon: viewModel.isSigningIn ? nil : "arrow.right",
                        isLoading: viewModel.isSigningIn
                    ) {
                        viewModel.signIn()
                    }
                    .disabled(viewModel.email.isEmpty || viewModel.password.isEmpty || viewModel.isSigningIn)
                    .frame(maxWidth: .infinity)
                }
                .frame(maxWidth: 360)
                .onAppear { focusedField = .email }

                Text("Trouble signing in?")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Accent.primary)
                    .contentShape(Rectangle())
                    .overlay {
                        ActionHitArea {
                            if let url = URL(string: "https://loom.dissonance.cloud") {
                                NSWorkspace.shared.open(url)
                            }
                        }
                    }
            }
            .frame(maxWidth: 480)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(DSSpacing.xxxl)
        .background(DSColor.Bg.canvas)
    }

    private var shouldShowStatus: Bool {
        viewModel.isSigningIn ||
            viewModel.statusMessage.hasPrefix("Sign-in failed") ||
            viewModel.statusMessage.contains("could not") ||
            viewModel.statusMessage.contains("missing") ||
            viewModel.statusMessage.contains("restricted")
    }

    private func signInStatus(_ message: String) -> some View {
        let isError = message.hasPrefix("Sign-in failed") ||
            message.contains("could not") ||
            message.contains("restricted")
        return HStack(alignment: .top, spacing: DSSpacing.sm) {
            Image(systemName: isError ? "exclamationmark.triangle.fill" : "arrow.triangle.2.circlepath")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(isError ? DSColor.State.warning : DSColor.Accent.primary)
                .padding(.top, 1)
            Text(message)
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DSColor.Bg.surfaceRaised, in: RoundedRectangle(cornerRadius: DSRadius.md))
        .overlay {
            RoundedRectangle(cornerRadius: DSRadius.md)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        }
    }
}

/// Focusable fields on the signed-out screen.
enum SignedOutField: Hashable {
    case email
    case password
}
