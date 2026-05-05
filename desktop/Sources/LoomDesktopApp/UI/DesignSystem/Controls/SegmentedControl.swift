import SwiftUI

/// Pill-shaped segmented control with a sliding thumb that animates
/// between segments using `LoomolaMotion.medium`. Generic over any
/// `Hashable & CaseIterable` enum.
///
/// Use:
///   SegmentedControl(selection: $captureMode) { mode in
///       Label(mode.title, systemImage: mode.symbol)
///   }
struct SegmentedControl<Item, Label>: View where
    Item: Hashable & CaseIterable,
    Item.AllCases: RandomAccessCollection,
    Label: View
{
    @Binding var selection: Item
    let label: (Item) -> Label

    @Namespace private var thumbAnimation

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(Item.allCases), id: \.self) { item in
                segment(for: item)
            }
        }
        .padding(DSSpacing.xs)
        .background(
            DSColor.Bg.subtle,
            in: RoundedRectangle(cornerRadius: DSRadius.pill, style: .continuous)
        )
    }

    @ViewBuilder
    private func segment(for item: Item) -> some View {
        let isSelected = selection == item
        Button {
            withAnimation(LoomolaMotion.medium) {
                selection = item
            }
        } label: {
            label(item)
                .font(DSFont.Body.md())
                .foregroundStyle(
                    isSelected ? DSColor.Text.primary : DSColor.Text.secondary
                )
                .padding(.horizontal, DSSpacing.lg)
                .padding(.vertical, DSSpacing.sm)
                .frame(maxWidth: .infinity)
                .background(thumb(isSelected: isSelected))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func thumb(isSelected: Bool) -> some View {
        if isSelected {
            RoundedRectangle(cornerRadius: DSRadius.pill, style: .continuous)
                .fill(DSColor.Bg.surface)
                .matchedGeometryEffect(id: "segmentedThumb", in: thumbAnimation)
                .dsShadow(.subtle)
        } else {
            Color.clear
        }
    }
}
