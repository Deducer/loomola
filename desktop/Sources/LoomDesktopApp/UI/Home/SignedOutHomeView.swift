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
                    Field(placeholder: "Password", text: $viewModel.password, icon: "lock", isSecure: true)
                        .focused($focusedField, equals: .password)
                    PrimaryButton("Sign in", icon: "arrow.right") {
                        viewModel.signIn()
                    }
                    .disabled(viewModel.email.isEmpty || viewModel.password.isEmpty)
                    .frame(maxWidth: .infinity)
                }
                .frame(maxWidth: 360)
                .onAppear { focusedField = .email }

                Button {
                    if let url = URL(string: "https://loom.dissonance.cloud") {
                        NSWorkspace.shared.open(url)
                    }
                } label: {
                    Text("Trouble signing in?")
                        .font(DSFont.Body.sm())
                        .foregroundStyle(DSColor.Accent.primary)
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: 480)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(DSSpacing.xxxl)
        .background(DSColor.Bg.canvas)
    }
}

/// Focusable fields on the signed-out screen.
enum SignedOutField: Hashable {
    case email
    case password
}
