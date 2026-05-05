import SwiftUI

/// Surface shown between Stop click and upload completion. Replaces
/// the recording surface immediately on Stop so the user knows
/// their click was received — without this, the recording surface
/// stayed up while the upload ran in the background and the user
/// re-clicked Stop thinking the first click missed.
///
/// Three sub-states drive the copy + indicator:
///   - .finalizing → "Finalizing recording…" with indeterminate spinner
///   - .uploading(progress) → "Uploading…" with determinate progress bar
///   - .complete → "Uploaded" with a brief success state before the
///     parent router routes back to IdleHomeView
struct FinalizingHomeView: View {
    @ObservedObject var viewModel: RecorderViewModel

    var body: some View {
        VStack(spacing: DSSpacing.xl) {
            Spacer()

            VStack(spacing: DSSpacing.md) {
                indicator
                Text(headline)
                    .font(DSFont.Display.lg())
                    .foregroundStyle(DSColor.Text.primary)
                Text(subhead)
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.secondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(DSSpacing.xxxl)
        .background(DSColor.Bg.canvas)
    }

    @ViewBuilder
    private var indicator: some View {
        switch viewModel.state {
        case .uploading(let progress):
            VStack(spacing: DSSpacing.sm) {
                ProgressView(value: progress)
                    .progressViewStyle(.linear)
                    .tint(DSColor.Accent.primary)
                    .frame(width: 240)
                Text("\(Int(progress * 100))%")
                    .font(DSFont.Mono.body())
                    .foregroundStyle(DSColor.Text.tertiary)
            }
        case .complete:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 36, weight: .semibold))
                .foregroundStyle(DSColor.State.success)
        default:
            ProgressView()
                .controlSize(.large)
        }
    }

    private var headline: String {
        switch viewModel.state {
        case .finalizing: return "Finalizing recording"
        case .uploading: return "Uploading"
        case .complete: return "Uploaded"
        case .failed: return "Upload failed"
        default: return "Finalizing"
        }
    }

    private var subhead: String {
        switch viewModel.state {
        case .finalizing:
            return "Stitching audio, video, and bubble into the final file."
        case .uploading:
            return "Sending to your library. This usually takes a few seconds."
        case .complete(let slug):
            return "Available at /v/\(slug)"
        case .failed(let message):
            return message
        default:
            return ""
        }
    }
}
