import SwiftUI

/// Surface shown between Stop click and upload completion. Replaces
/// the recording surface immediately on Stop so the user knows
/// their click was received — without this, the recording surface
/// stayed up while the upload ran in the background and the user
/// re-clicked Stop thinking the first click missed.
///
/// Three sub-states drive the copy + indicator:
///   - .finalizing → finalizing copy with indeterminate spinner
///   - .uploading(progress) → staged upload/processing copy with a determinate progress bar
///   - .complete → brief success state before the
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
        case .finalizing:
            switch recordingKind {
            case .some(.audio): return "Finalizing audio note"
            case .some(.video): return "Finalizing recording"
            case nil: return "Finalizing"
            }
        case .uploading(let progress):
            if progress >= 0.89 {
                switch recordingKind {
                case .some(.audio): return "Processing audio note"
                case .some(.video): return "Processing recording"
                case nil: return "Processing"
                }
            }
            switch recordingKind {
            case .some(.audio): return "Uploading audio note"
            case .some(.video): return "Uploading video"
            case nil: return "Uploading"
            }
        case .complete:
            switch recordingKind {
            case .some(.audio): return "Audio note uploaded"
            case .some(.video), nil: return "Uploaded"
            }
        case .failed: return "Upload failed"
        default: return "Finalizing"
        }
    }

    private var subhead: String {
        switch viewModel.state {
        case .finalizing:
            switch recordingKind {
            case .some(.audio): return "Preparing your audio note for upload."
            case .some(.video): return "Stitching audio, video, and bubble into the final file."
            case nil: return "Preparing your recording for upload."
            }
        case .uploading:
            if !viewModel.statusMessage.isEmpty {
                return "\(viewModel.statusMessage) \(longUploadSuffix)"
            }
            return "Sending to your library. \(longUploadSuffix)"
        case .complete(let slug):
            switch recordingKind {
            case .some(.audio):
                return "Saved as an audio note. Transcript and AI notes continue in the background."
            case .some(.video):
                return "Saved at /v/\(slug). Transcript and AI notes continue in the background."
            case nil:
                return "Saved. Transcript and AI notes continue in the background."
            }
        case .failed(let message):
            return message
        default:
            return ""
        }
    }

    private var recordingKind: DesktopRecordingKind? {
        viewModel.finalizingRecordingKind
    }

    private var longUploadSuffix: String {
        switch recordingKind {
        case .some(.audio): return "Long audio notes can take a few minutes."
        case .some(.video): return "Long recordings can take a few minutes."
        case nil: return "Long uploads can take a few minutes."
        }
    }
}
