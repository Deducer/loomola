import SwiftUI

/// Main "signed-in, not recording" surface. Centered capture card,
/// optional meeting prompt, and a Recent strip.
struct IdleHomeView: View {
    @ObservedObject var viewModel: RecorderViewModel
    @ObservedObject var recentService: RecentRecordingsService
    @Binding var captureMode: CaptureMode
    @Binding var folderFilterId: String?
    let topContentPadding: CGFloat
    let onOpenAudioNote: (RecentRecording) -> Void

    /// Notes surface uses Granola's readable column; the video grid
    /// keeps the wide canvas it was built for.
    private var homeContentMaxWidth: CGFloat {
        captureMode == .audio ? WindowChromeLayout.notesHomeMaxWidth : 1080
    }

    private var activeFolderName: String? {
        guard let folderFilterId else { return nil }
        return recentService.folders.first(where: { $0.id == folderFilterId })?.name
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DSSpacing.xl) {
                if let message = homeStatusMessage {
                    homeStatusBanner(message)
                }

                primarySurface

                RecentStrip(
                    service: recentService,
                    captureMode: captureMode,
                    folderFilterId: folderFilterId,
                    activeFolderName: activeFolderName,
                    onClearFolderFilter: { folderFilterId = nil },
                    onOpenAudioNote: onOpenAudioNote
                )
                .padding(.top, DSSpacing.md)
            }
            .padding(.top, topContentPadding)
            .padding(.horizontal, DSSpacing.xxl)
            .padding(.bottom, DSSpacing.xxl)
            .frame(maxWidth: homeContentMaxWidth, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private var homeStatusMessage: String? {
        switch viewModel.state {
        case .failed:
            return viewModel.statusMessage
        default:
            return nil
        }
    }

    private func homeStatusBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: DSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(DSColor.State.warning)
                .padding(.top, 2)
            Text(message)
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: DSSpacing.md)
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DSColor.Bg.surfaceRaised, in: RoundedRectangle(cornerRadius: DSRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.md)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        )
    }

    @ViewBuilder
    private var primarySurface: some View {
        if captureMode == .audio {
            // Granola home: the calendar card leads, the capture button
            // lives in the title bar (`+ New note`).
            ComingUpSection { event in
                viewModel.audioTitle = event.title
                viewModel.startAudioNoteRecording()
            }
        } else {
            heroCard
        }
    }

    private var heroCard: some View {
        VStack(alignment: .leading) {
            HeroCaptureSection(
                viewModel: viewModel,
                captureMode: $captureMode
            )
        }
        .padding(.horizontal, DSSpacing.xl)
        .padding(.vertical, DSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DSColor.Bg.surface, in: RoundedRectangle(cornerRadius: DSRadius.lg))
        .dsShadow(.subtle)
    }

}
