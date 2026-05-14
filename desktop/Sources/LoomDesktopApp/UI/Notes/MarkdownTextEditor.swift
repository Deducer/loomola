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

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
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
        textView.string = text
        context.coordinator.applyAttributes(to: textView)
        context.coordinator.reportHeight(for: textView)

        scrollView.documentView = textView
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? MarkdownTextView else { return }
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
                ],
                range: full
            )

            let plain = storage.string as NSString
            applyHeadings(in: plain, storage: storage)
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
            let nextHeight = ceil(max(320, usedHeight + insetHeight + 16))
            guard abs(parent.measuredHeight - nextHeight) > 1 else { return }
            DispatchQueue.main.async {
                self.parent.measuredHeight = nextHeight
            }
        }

        private func applyHeadings(in plain: NSString, storage: NSTextStorage) {
            // Heading lines are `^#{1,3}\s.*$`. We render the whole
            // line at heading size, then collapse the `#…# ` prefix
            // to invisible so the source markers don't clutter the
            // rendered note. Markers stay in the underlying string
            // (still saves as markdown) — they just don't take
            // visual space in the editor.
            guard let regex = try? NSRegularExpression(
                pattern: "^(#{1,3})\\s.*$",
                options: [.anchorsMatchLines]
            ) else { return }
            let full = NSRange(location: 0, length: plain.length)
            regex.enumerateMatches(in: plain as String, range: full) { match, _, _ in
                guard let match = match else { return }
                let levelRange = match.range(at: 1)
                let level = max(1, min(3, levelRange.length))
                let font = MarkdownStyle.heading(level: level)
                storage.addAttribute(.font, value: font, range: match.range)
                storage.addAttribute(.foregroundColor, value: MarkdownStyle.headingColor, range: match.range)
                // Hide the `#…# ` prefix (level + 1 chars including
                // the trailing space).
                let prefix = NSRange(
                    location: match.range.location,
                    length: level + 1
                )
                hideMarker(prefix, in: storage)
            }
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
                let visualIndent = CGFloat(indentLevel) * 10
                let paragraphRange = plain.paragraphRange(for: match.range)

                let paragraphStyle = NSMutableParagraphStyle()
                paragraphStyle.firstLineHeadIndent = visualIndent + 22
                paragraphStyle.headIndent = visualIndent + 22
                paragraphStyle.paragraphSpacing = 4
                paragraphStyle.lineSpacing = 1.5
                storage.addAttribute(.paragraphStyle, value: paragraphStyle, range: paragraphRange)
                hideMarker(match.range, in: storage)
                markers.append(RenderedBulletMarker(range: match.range, indent: visualIndent))
            }
            return markers
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

fileprivate struct RenderedBulletMarker {
    let range: NSRange
    let indent: CGFloat
}

/// NSTextView subclass that draws a placeholder string when empty
/// and routes through coalesced text-storage edits to dodge the
/// SwiftUI-update loop.
final class MarkdownTextView: NSTextView {
    var placeholderString: String = ""
    fileprivate var renderedBulletMarkers: [RenderedBulletMarker] = [] {
        didSet { needsDisplay = true }
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        drawRenderedBulletMarkers()
        if string.isEmpty {
            let insets = textContainerInset
            let origin = NSPoint(x: 5 + insets.width, y: insets.height)
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
        MarkdownStyle.bulletColor.setFill()

        for marker in renderedBulletMarkers {
            guard marker.range.location < textLength else { continue }
            let characterRange = NSRange(location: marker.range.location, length: 1)
            let glyphRange = layoutManager.glyphRange(
                forCharacterRange: characterRange,
                actualCharacterRange: nil
            )
            guard glyphRange.location < layoutManager.numberOfGlyphs else { continue }
            let lineRect = layoutManager.lineFragmentRect(
                forGlyphAt: glyphRange.location,
                effectiveRange: nil
            )
            let bulletSize: CGFloat = 5.5
            let bulletRect = NSRect(
                x: containerOrigin.x + marker.indent + 4,
                y: containerOrigin.y + lineRect.midY - bulletSize / 2,
                width: bulletSize,
                height: bulletSize
            )
            NSBezierPath(ovalIn: bulletRect).fill()
        }
    }
}

private enum MarkdownStyle {
    static let body = NSFont.systemFont(ofSize: 14)
    static let bold = NSFont.boldSystemFont(ofSize: 14)
    static let bodyColor = dynamicColor(
        light: NSColor(red: 0.180, green: 0.184, blue: 0.208, alpha: 1),
        dark: NSColor(red: 0.760, green: 0.760, blue: 0.725, alpha: 1)
    )
    static let headingColor = dynamicColor(
        light: NSColor(red: 0.082, green: 0.086, blue: 0.102, alpha: 1),
        dark: NSColor(red: 0.850, green: 0.850, blue: 0.805, alpha: 1)
    )
    static let placeholderColor = dynamicColor(
        light: NSColor(red: 0.541, green: 0.549, blue: 0.584, alpha: 1),
        dark: NSColor(red: 0.416, green: 0.427, blue: 0.471, alpha: 1)
    )
    static let bulletColor = dynamicColor(
        light: NSColor(red: 0.430, green: 0.438, blue: 0.486, alpha: 1),
        dark: NSColor(red: 0.545, green: 0.552, blue: 0.596, alpha: 1)
    )
    static var italic: NSFont {
        let manager = NSFontManager.shared
        return manager.convert(body, toHaveTrait: .italicFontMask)
    }
    static let mono = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
    static func heading(level: Int) -> NSFont {
        switch level {
        case 1: return NSFont.boldSystemFont(ofSize: 22)
        case 2: return NSFont.boldSystemFont(ofSize: 18)
        case 3: return NSFont.boldSystemFont(ofSize: 16)
        default: return NSFont.boldSystemFont(ofSize: 14)
        }
    }

    private static func dynamicColor(light: NSColor, dark: NSColor) -> NSColor {
        NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return isDark ? dark : light
        }
    }
}
