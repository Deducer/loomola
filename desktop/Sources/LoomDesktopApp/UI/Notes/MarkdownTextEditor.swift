import AppKit
import SwiftUI

/// Lightweight live-tokenized markdown editor backed by NSTextView.
///
/// SwiftUI's `TextEditor` is plain-text only; this wraps NSTextView
/// in NSViewRepresentable and runs a small markdown tokenizer on
/// every edit, applying NSAttributedString attributes in-place. The
/// user types raw markdown (`# Heading`, `**bold**`, `*italic*`)
/// and sees the formatting render live without losing the source
/// characters — same model Granola, Notion, and Obsidian use.
///
/// Supported in v1:
///   • `# `, `## `, `### ` heading lines (size + weight scaled)
///   • `- ` and `* ` unordered lists (drawn as bullets)
///   • `**bold**` runs
///   • `*italic*` runs
///   • `` `code` `` mono runs
///
/// Out of scope (deliberately minimal — meeting-note usage):
///   • Links, blockquotes, code blocks, tables. Each adds edge
///     cases (click-through links, fenced multiline regions,
///     editable grids). Generated notes avoid tables and use bullets.
struct MarkdownTextEditor: NSViewRepresentable {
    @Binding var text: String
    @Binding var measuredHeight: CGFloat
    let placeholder: String
    let isFocused: FocusState<Bool>.Binding
    var minimumHeight: CGFloat = 320
    /// False renders the same tokenized markdown read-only — used by the
    /// Enhanced pane, where web remains the editor of record.
    var isEditable: Bool = true

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = MarkdownEditorScrollView()
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = false
        scrollView.borderType = .noBorder
        scrollView.autohidesScrollers = true

        let textView = MarkdownTextView()
        textView.isRichText = false
        textView.allowsUndo = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.smartInsertDeleteEnabled = false
        textView.font = MarkdownStyle.body
        textView.textColor = MarkdownStyle.bodyColor
        textView.insertionPointColor = NSColor(named: "AccentColor")
            ?? NSColor.systemBlue
        textView.backgroundColor = .clear
        textView.drawsBackground = false
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.autoresizingMask = [.width]
        textView.minSize = NSSize(width: 0, height: 0)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(width: scrollView.contentSize.width, height: CGFloat.greatestFiniteMagnitude)
        textView.textContainerInset = NSSize(width: 0, height: 4)
        textView.delegate = context.coordinator
        textView.placeholderString = placeholder
        textView.isEditable = isEditable
        textView.string = text
        context.coordinator.applyAttributes(to: textView)
        context.coordinator.reportHeight(for: textView)

        scrollView.documentView = textView
        scrollView.onContentWidthChange = { [weak textView] width in
            guard let textView else { return }
            textView.textContainer?.containerSize = NSSize(
                width: width,
                height: CGFloat.greatestFiniteMagnitude
            )
            context.coordinator.reportHeight(for: textView)
        }
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? MarkdownTextView else { return }
        textView.isEditable = isEditable
        textView.textContainer?.containerSize = NSSize(width: scrollView.contentSize.width, height: CGFloat.greatestFiniteMagnitude)
        if textView.string != text {
            // External update (e.g., body fetched from server) —
            // replace the whole text, then re-tokenize.
            let savedRange = textView.selectedRange()
            textView.string = text
            let length = (text as NSString).length
            let safeLocation = min(savedRange.location, length)
            let safeLength = min(savedRange.length, length - safeLocation)
            textView.setSelectedRange(NSRange(location: safeLocation, length: safeLength))
            context.coordinator.applyAttributes(to: textView)
        }
        context.coordinator.reportHeight(for: textView)
        // Push focus state into the responder chain when the view
        // becomes focused via FocusState. SwiftUI's @FocusState
        // doesn't auto-bridge to NSView focus.
        if isFocused.wrappedValue, textView.window?.firstResponder !== textView {
            textView.window?.makeFirstResponder(textView)
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        let parent: MarkdownTextEditor
        private var applying = false

        init(_ parent: MarkdownTextEditor) {
            self.parent = parent
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? MarkdownTextView else { return }
            parent.text = textView.string
            applyAttributes(to: textView)
            reportHeight(for: textView)
        }

        /// Re-runs the full tokenizer over the storage. Cheap for
        /// the few-thousand-char meeting notes we expect; if it
        /// ever shows up in profiling, switch to range-based
        /// incremental updates via NSTextStorageDelegate.
        func applyAttributes(to textView: MarkdownTextView) {
            guard !applying, let storage = textView.textStorage else { return }
            applying = true
            defer { applying = false }

            let full = NSRange(location: 0, length: storage.length)
            let baseFont = MarkdownStyle.body
            storage.beginEditing()
            storage.setAttributes(
                [
                    .font: baseFont,
                    .foregroundColor: MarkdownStyle.bodyColor,
                    .paragraphStyle: MarkdownStyle.bodyParagraphStyle(),
                ],
                range: full
            )

            let plain = storage.string as NSString
            textView.renderedHeadingMarkers = applyHeadings(in: plain, storage: storage)
            textView.renderedBulletMarkers = applyUnorderedLists(in: plain, storage: storage)
            applyInlineRuns(
                pattern: "(?<!\\*)\\*\\*([^*\\n]+)\\*\\*(?!\\*)",
                markerLength: 2,
                in: plain,
                storage: storage,
                font: MarkdownStyle.bold
            )
            applyInlineRuns(
                pattern: "(?<![*\\w])\\*([^*\\n]+)\\*(?![*\\w])",
                markerLength: 1,
                in: plain,
                storage: storage,
                font: MarkdownStyle.italic
            )
            applyInlineRuns(
                pattern: "`([^`\\n]+)`",
                markerLength: 1,
                in: plain,
                storage: storage,
                font: MarkdownStyle.mono
            )
            storage.endEditing()
            reportHeight(for: textView)
        }

        func reportHeight(for textView: MarkdownTextView) {
            guard let layoutManager = textView.layoutManager,
                  let textContainer = textView.textContainer
            else { return }
            guard textContainer.containerSize.width > 24 else { return }
            layoutManager.ensureLayout(for: textContainer)
            let usedHeight = layoutManager.usedRect(for: textContainer).height
            let insetHeight = textView.textContainerInset.height * 2
            let nextHeight = ceil(max(parent.minimumHeight, usedHeight + insetHeight + 16))
            // The container is inset on both sides by the gutter; the
            // frame has to include it or each pass narrows the view.
            let nextWidth = max(1, textContainer.containerSize.width + textView.textContainerInset.width * 2)
            if abs(textView.frame.width - nextWidth) > 1 || abs(textView.frame.height - nextHeight) > 1 {
                textView.setFrameSize(NSSize(width: nextWidth, height: nextHeight))
            }
            textView.needsDisplay = true
            guard abs(parent.measuredHeight - nextHeight) > 1 else { return }
            DispatchQueue.main.async {
                self.parent.measuredHeight = nextHeight
            }
        }

        private func applyHeadings(in plain: NSString, storage: NSTextStorage) -> [RenderedHeadingMarker] {
            // Heading lines are `^#{1,3}\s.*$`. We render the whole
            // line at heading size, then collapse the `#…# ` prefix
            // to invisible so the source markers don't clutter the
            // rendered note. Markers stay in the underlying string
            // (still saves as markdown) — they just don't take
            // visual space in the editor. A single faint `#` is
            // drawn in the gutter instead (Granola pattern).
            guard let regex = try? NSRegularExpression(
                pattern: "^(#{1,3})\\s.*$",
                options: [.anchorsMatchLines]
            ) else { return [] }
            let full = NSRange(location: 0, length: plain.length)
            var markers: [RenderedHeadingMarker] = []
            regex.enumerateMatches(in: plain as String, range: full) { match, _, _ in
                guard let match = match else { return }
                let levelRange = match.range(at: 1)
                let level = max(1, min(3, levelRange.length))
                markers.append(
                    RenderedHeadingMarker(
                        anchorLocation: min(match.range.location + level + 1, plain.length - 1),
                        level: level
                    )
                )
                let font = MarkdownStyle.heading(level: level)
                storage.addAttribute(.font, value: font, range: match.range)
                storage.addAttribute(.foregroundColor, value: MarkdownStyle.headingColor, range: match.range)
                storage.addAttribute(
                    .paragraphStyle,
                    value: MarkdownStyle.headingParagraphStyle(
                        level: level,
                        isFirstBlock: match.range.location == 0
                    ),
                    range: plain.paragraphRange(for: match.range)
                )
                // Granola keeps one faint `#` in the gutter: style the
                // first marker small + grey and kern it out to the gutter
                // width, then hide the remaining `#`s and the space.
                storage.addAttributes(
                    [
                        .font: MarkdownStyle.headingMarkerFont,
                        .foregroundColor: MarkdownStyle.bulletColor,
                        .kern: MarkdownStyle.headingMarkerKern,
                    ],
                    range: NSRange(location: match.range.location, length: 1)
                )
                hideMarker(
                    NSRange(location: match.range.location + 1, length: level),
                    in: storage
                )
            }
            return markers
        }

        private func applyUnorderedLists(
            in plain: NSString,
            storage: NSTextStorage
        ) -> [RenderedBulletMarker] {
            guard let regex = try? NSRegularExpression(
                pattern: "^(\\s{0,12})([-*])\\s+",
                options: [.anchorsMatchLines]
            ) else { return [] }

            let full = NSRange(location: 0, length: plain.length)
            var markers: [RenderedBulletMarker] = []
            regex.enumerateMatches(in: plain as String, range: full) { match, _, _ in
                guard let match = match else { return }
                let leadingWhitespace = plain.substring(with: match.range(at: 1))
                let indentLevel = leadingWhitespace.reduce(0) { total, char in
                    total + (char == "\t" ? 2 : 1)
                }
                let nestingLevel = min(3, max(0, (indentLevel + 1) / 2))
                let visualIndent = CGFloat(nestingLevel) * MarkdownStyle.nestedListIndent
                let paragraphRange = plain.paragraphRange(for: match.range)

                let paragraphStyle = NSMutableParagraphStyle()
                paragraphStyle.firstLineHeadIndent = MarkdownStyle.gutterWidth + visualIndent + MarkdownStyle.listTextIndent
                paragraphStyle.headIndent = MarkdownStyle.gutterWidth + visualIndent + MarkdownStyle.listTextIndent
                paragraphStyle.paragraphSpacing = nestingLevel == 0 ? 7 : 6
                paragraphStyle.lineSpacing = MarkdownStyle.bodyLineSpacing
                storage.addAttribute(.paragraphStyle, value: paragraphStyle, range: paragraphRange)
                hideMarker(match.range, in: storage)
                let anchorLocation = firstVisibleListContentLocation(
                    in: plain,
                    markerRange: match.range,
                    paragraphRange: paragraphRange
                )
                markers.append(
                    RenderedBulletMarker(
                        anchorLocation: anchorLocation,
                        indent: visualIndent,
                        kind: nestingLevel == 0 ? .filled : .hollow
                    )
                )
            }
            return markers
        }

        private func firstVisibleListContentLocation(
            in plain: NSString,
            markerRange: NSRange,
            paragraphRange: NSRange
        ) -> Int {
            let start = min(NSMaxRange(markerRange), plain.length)
            let end = min(NSMaxRange(paragraphRange), plain.length)
            var location = start

            while location < end {
                let value = plain.character(at: location)
                if let scalar = UnicodeScalar(UInt32(value)),
                   !CharacterSet.whitespacesAndNewlines.contains(scalar) {
                    return location
                }
                location += 1
            }

            return markerRange.location
        }

        private func applyInlineRuns(
            pattern: String,
            markerLength: Int,
            in plain: NSString,
            storage: NSTextStorage,
            font: NSFont
        ) {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { return }
            let full = NSRange(location: 0, length: plain.length)
            regex.enumerateMatches(in: plain as String, range: full) { match, _, _ in
                guard let match = match else { return }
                // Style the inner content (between markers) as
                // bold / italic / mono, and hide both leading +
                // trailing markers so the rendered text reads as a
                // word, not as a `**word**`.
                let inner = NSRange(
                    location: match.range.location + markerLength,
                    length: match.range.length - markerLength * 2
                )
                if inner.length > 0 {
                    storage.addAttribute(.font, value: font, range: inner)
                }
                let leading = NSRange(
                    location: match.range.location,
                    length: markerLength
                )
                let trailing = NSRange(
                    location: match.range.location + match.range.length - markerLength,
                    length: markerLength
                )
                hideMarker(leading, in: storage)
                hideMarker(trailing, in: storage)
            }
        }

        /// Make a run of characters visually disappear without
        /// removing them from the underlying string. Tiny font + 0
        /// kerning collapses horizontal width to ~0; clear color
        /// hides any residual glyph. The chars stay in
        /// `textStorage.string` so the markdown source persists,
        /// undo-redo works, and saves to the server are still valid
        /// markdown.
        private func hideMarker(_ range: NSRange, in storage: NSTextStorage) {
            guard range.length > 0,
                  range.location >= 0,
                  range.location + range.length <= storage.length else { return }
            storage.addAttributes(
                [
                    .font: NSFont.systemFont(ofSize: 0.01),
                    .foregroundColor: NSColor.clear,
                    .kern: 0,
                ],
                range: range
            )
        }
    }
}

/// Reports the editor's real laid-out width after SwiftUI/AppKit completes
/// each resize. The initial `updateNSView` can run while the scroll view is
/// still zero-width; without this callback the height remains stuck at its
/// minimum and the long note becomes a small nested scrolling viewport.
final class MarkdownEditorScrollView: NSScrollView {
    var onContentWidthChange: ((CGFloat) -> Void)?
    private var lastReportedContentWidth: CGFloat = 0

    override func layout() {
        super.layout()
        let width = contentSize.width
        guard width > 24, abs(width - lastReportedContentWidth) > 1 else { return }
        lastReportedContentWidth = width
        onContentWidthChange?(width)
    }
}

fileprivate enum RenderedBulletKind: Equatable {
    case filled
    case hollow
}

fileprivate struct RenderedBulletMarker {
    let anchorLocation: Int
    let indent: CGFloat
    let kind: RenderedBulletKind
}

/// A heading line whose `#` marker is drawn in the gutter.
fileprivate struct RenderedHeadingMarker {
    let anchorLocation: Int
    let level: Int
}

/// NSTextView subclass that draws a placeholder string when empty
/// and routes through coalesced text-storage edits to dodge the
/// SwiftUI-update loop.
final class MarkdownTextView: NSTextView {
    var placeholderString: String = ""
    /// Width of the drawn-marker gutter; the hosting SwiftUI view
    /// offsets by this so body text lines up with the title.
    static let gutterWidth: CGFloat = MarkdownStyle.gutterWidth
    fileprivate var renderedBulletMarkers: [RenderedBulletMarker] = [] {
        didSet { needsDisplay = true }
    }
    fileprivate var renderedHeadingMarkers: [RenderedHeadingMarker] = [] {
        didSet { needsDisplay = true }
    }
    /// Test hooks: how many drawn markers the last tokenizer pass produced.
    var renderedHeadingMarkerCount: Int { renderedHeadingMarkers.count }
    var renderedBulletMarkerCount: Int { renderedBulletMarkers.count }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        drawRenderedBulletMarkers()
        if string.isEmpty {
            let insets = textContainerInset
            let origin = NSPoint(x: 5 + insets.width + MarkdownStyle.gutterWidth, y: insets.height)
            let attrs: [NSAttributedString.Key: Any] = [
                .font: MarkdownStyle.body,
                .foregroundColor: MarkdownStyle.placeholderColor,
            ]
            (placeholderString as NSString).draw(at: origin, withAttributes: attrs)
        }
    }

    private func drawRenderedBulletMarkers() {
        guard !renderedBulletMarkers.isEmpty,
              let layoutManager,
              let textContainer
        else { return }
        layoutManager.ensureLayout(for: textContainer)

        let textLength = (string as NSString).length
        guard textLength > 0 else { return }
        let containerOrigin = textContainerOrigin
        for marker in renderedBulletMarkers {
            guard marker.anchorLocation < textLength else { continue }
            let characterRange = NSRange(location: marker.anchorLocation, length: 1)
            let glyphRange = layoutManager.glyphRange(
                forCharacterRange: characterRange,
                actualCharacterRange: nil
            )
            guard glyphRange.location < layoutManager.numberOfGlyphs else { continue }
            let lineRect = layoutManager.lineFragmentRect(
                forGlyphAt: glyphRange.location,
                effectiveRange: nil
            )
            let bulletSize: CGFloat = marker.kind == .filled ? 4.8 : 4.4
            let bulletRect = NSRect(
                x: containerOrigin.x + MarkdownStyle.gutterWidth + marker.indent + MarkdownStyle.listBulletX,
                y: containerOrigin.y + lineRect.midY - bulletSize / 2,
                width: bulletSize,
                height: bulletSize
            )
            let path = NSBezierPath(ovalIn: bulletRect)
            switch marker.kind {
            case .filled:
                MarkdownStyle.bulletColor.setFill()
                path.fill()
            case .hollow:
                MarkdownStyle.bulletColor.setStroke()
                path.lineWidth = 1.1
                path.stroke()
            }
        }
    }
}

private enum MarkdownStyle {
    /// Body copy in the bundled Inter face (Granola sets notes in a
    /// grotesk); system font when the bundle is missing.
    static let body = NSFont(name: FontLoader.interFamilyName, size: 16)
        ?? NSFont.systemFont(ofSize: 16, weight: .regular)
    static let bold = interWeighted(size: 16, weight: .semibold)
    static let bodyLineSpacing: CGFloat = 5.5
    /// Gutter to the left of the text column where `#` heading
    /// markers and bullets are drawn.
    static let gutterWidth: CGFloat = 22
    static let headingGutterMarker = "#"
    static let headingMarkerFont = interWeighted(size: 13, weight: .medium)
    /// Kerning after the visible `#` so heading text starts at the
    /// same x as body text (gutter width minus the glyph's advance).
    static var headingMarkerKern: CGFloat {
        let advance = (headingGutterMarker as NSString).size(withAttributes: [.font: headingMarkerFont]).width
        return max(0, gutterWidth - advance)
    }
    static let nestedListIndent: CGFloat = 24
    static let listTextIndent: CGFloat = 28
    static let listBulletX: CGFloat = 6
    // Granola body greys (parity rank 1): #C8C8C6 body, #E8E8E6
    // headings, #8E8E8C placeholder + bullets on the #252525 canvas.
    static let bodyColor = dynamicColor(
        light: NSColor(red: 0.180, green: 0.184, blue: 0.208, alpha: 1),
        dark: NSColor(red: 0.784, green: 0.784, blue: 0.776, alpha: 1)
    )
    static let headingColor = dynamicColor(
        light: NSColor(red: 0.122, green: 0.122, blue: 0.114, alpha: 1),
        dark: NSColor(red: 0.910, green: 0.910, blue: 0.902, alpha: 1)
    )
    static let placeholderColor = dynamicColor(
        light: NSColor(red: 0.478, green: 0.478, blue: 0.463, alpha: 1),
        dark: NSColor(red: 0.557, green: 0.557, blue: 0.549, alpha: 1)
    )
    static let bulletColor = dynamicColor(
        light: NSColor(red: 0.478, green: 0.478, blue: 0.463, alpha: 1),
        dark: NSColor(red: 0.557, green: 0.557, blue: 0.549, alpha: 1)
    )
    static var italic: NSFont {
        let manager = NSFontManager.shared
        return manager.convert(body, toHaveTrait: .italicFontMask)
    }
    static let mono = NSFont.monospacedSystemFont(ofSize: 15, weight: .regular)
    static func heading(level: Int) -> NSFont {
        switch level {
        case 1: return interWeighted(size: 18, weight: .semibold)
        case 2: return interWeighted(size: 17, weight: .semibold)
        default: return interWeighted(size: 16, weight: .semibold)
        }
    }

    /// Inter at a given weight via the variable font's weight axis;
    /// falls back to the system font at the same weight.
    static func interWeighted(size: CGFloat, weight: NSFont.Weight) -> NSFont {
        let descriptor = NSFontDescriptor(fontAttributes: [
            .family: FontLoader.interFamilyName,
            .traits: [NSFontDescriptor.TraitKey.weight: weight.rawValue],
        ])
        if let font = NSFont(descriptor: descriptor, size: size),
           font.familyName == FontLoader.interFamilyName {
            return font
        }
        return NSFont.systemFont(ofSize: size, weight: weight)
    }

    static func bodyParagraphStyle() -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.lineSpacing = bodyLineSpacing
        style.paragraphSpacing = 8
        style.firstLineHeadIndent = gutterWidth
        style.headIndent = gutterWidth
        return style
    }

    static func headingParagraphStyle(level: Int, isFirstBlock: Bool) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.lineSpacing = 3
        // The visible `#` occupies the gutter; wrapped heading lines
        // align with body text.
        style.firstLineHeadIndent = 0
        style.headIndent = gutterWidth
        style.paragraphSpacingBefore = isFirstBlock ? 0 : (level == 1 ? 22 : 20)
        style.paragraphSpacing = level == 1 ? 10 : 8
        return style
    }

    private static func dynamicColor(light: NSColor, dark: NSColor) -> NSColor {
        NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return isDark ? dark : light
        }
    }
}
