import SwiftUI

/// Branded dropdown that visually matches `Field`. Used for camera
/// + mic device selection.
///
/// Implementation note: SwiftUI's `Picker(.menu)` style brings the
/// system pop-up button chrome with it. We reimplement with a Menu
/// + custom label so the chrome matches the rest of the design
/// system.
struct FieldPicker<Value: Hashable>: View {
    let label: String?
    let placeholder: String
    let icon: String?
    let options: [Option<Value>]
    @Binding var selection: Value?

    struct Option<V: Hashable>: Identifiable {
        let id: V
        let title: String
        var value: V { id }
    }

    init(
        label: String? = nil,
        placeholder: String = "Select…",
        icon: String? = nil,
        options: [Option<Value>],
        selection: Binding<Value?>
    ) {
        self.label = label
        self.placeholder = placeholder
        self.icon = icon
        self.options = options
        self._selection = selection
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            if let label {
                Text(label)
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.secondary)
            }
            Menu {
                Button(placeholder) { selection = nil }
                Divider()
                ForEach(options) { option in
                    Button {
                        selection = option.value
                    } label: {
                        if option.value == selection {
                            Label(option.title, systemImage: "checkmark")
                        } else {
                            Text(option.title)
                        }
                    }
                }
            } label: {
                pillLabel
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
        }
    }

    private var pillLabel: some View {
        HStack(spacing: DSSpacing.sm) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(DSColor.Text.tertiary)
            }
            Text(currentTitle)
                .font(DSFont.Body.md())
                .foregroundStyle(
                    selection == nil ? DSColor.Text.tertiary : DSColor.Text.primary
                )
                .lineLimit(1)
            Spacer()
            Image(systemName: "chevron.down")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(DSColor.Text.tertiary)
        }
        .padding(.horizontal, DSSpacing.lg)
        .padding(.vertical, DSSpacing.md)
        .background(
            DSColor.Bg.subtle,
            in: RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        )
        .contentShape(Rectangle())
    }

    private var currentTitle: String {
        if let selection,
           let option = options.first(where: { $0.value == selection })
        {
            return option.title
        }
        return placeholder
    }
}
