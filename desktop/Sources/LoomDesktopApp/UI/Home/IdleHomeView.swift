import SwiftUI

/// Main "signed-in, not recording" surface. Big "Capture" headline,
/// hero CTA card, optional meeting prompt, and a Recent strip.
struct IdleHomeView: View {
    @ObservedObject var viewModel: RecorderViewModel
    @ObservedObject var recentService: RecentRecordingsService
    @Binding var captureMode: CaptureMode

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DSSpacing.xl) {
                Text("Capture")
                    .font(DSFont.Display.xl())
                    .foregroundStyle(DSColor.Text.primary)
                    .padding(.top, DSSpacing.lg)

                heroCard

                if let context = viewModel.meetingPromptContext {
                    meetingPromptCard(context: context)
                }

                RecentStrip(service: recentService)
                    .padding(.top, DSSpacing.lg)
            }
            .padding(.horizontal, DSSpacing.xxl)
            .padding(.bottom, DSSpacing.xxl)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var heroCard: some View {
        VStack(alignment: .leading) {
            HeroCaptureSection(viewModel: viewModel, captureMode: $captureMode)
        }
        .padding(.horizontal, DSSpacing.xl)
        .padding(.vertical, DSSpacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DSColor.Bg.surface, in: RoundedRectangle(cornerRadius: DSRadius.lg))
        .dsShadow(.subtle)
    }

    private func meetingPromptCard(context: MeetingContext) -> some View {
        HStack(alignment: .center, spacing: DSSpacing.lg) {
            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(DSColor.State.success)
            VStack(alignment: .leading, spacing: 2) {
                Text("Meeting ready")
                    .font(DSFont.Body.lg())
                    .foregroundStyle(DSColor.Text.primary)
                Text(context.suggestedTitle)
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.secondary)
                    .lineLimit(1)
                Text(context.sourceContextHint)
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.tertiary)
                    .lineLimit(1)
            }
            Spacer()
            HStack(spacing: DSSpacing.sm) {
                PrimaryButton("Start audio") {
                    viewModel.startDetectedMeetingAudioNote()
                }
                SecondaryButton("Dismiss") {
                    viewModel.dismissMeetingPrompt()
                }
            }
        }
        .padding(.horizontal, DSSpacing.xl)
        .padding(.vertical, DSSpacing.lg)
        .background(DSColor.Bg.surface, in: RoundedRectangle(cornerRadius: DSRadius.lg))
        .dsShadow(.subtle)
    }
}
