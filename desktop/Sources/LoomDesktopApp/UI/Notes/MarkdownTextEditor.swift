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
///   • `**bold**` runs
///   • `*italic*` runs
///   • `` `code` `` mono runs
///
/// Out of scope (deliberately minimal — meeting-note usage):
///   • Lists, links, blockquotes, code blocks, tables. Each adds
///     edge cases (line-prefix continuations, click-through links,
///     fenced multiline regions). When a real meeting note needs
///     them, port a proper parser; v1 doesn't need it.
struct MarkdownTextEditor: NSViewRepresentable {
    @Binding var text: String
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
        textView.textColor = NSColor.labelColor
        textView.insertionPointColor = NSColor(named: "AccentColor")
            ?? NSColor.systemBlue
        textView.backgroundColor = .clear
        textView.drawsBackground = false
        textView.textContainerInset = NSSize(width: 0, height: 4)
        textView.delegate = context.coordinator
        textView.placeholderString = placeholder
        textView.string = text
        context.coordinator.applyAttributes(to: textView)

        scrollView.documentView = textView
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? MarkdownTextView else { return }
        if textView.string != text {
            // External update (e.g., body fetched from server) —
            // replace the whole text, then re-tokenize.
            let savedRange = textView.selectedRange()
            textView.string = text
            textView.setSelectedRange(savedRange)
            context.coordinator.applyAttributes(to: textView)
        }
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
                    .foregroundColor: NSColor.labelColor,
                ],
                range: full
            )

            let plain = storage.string as NSString
            applyHeadings(in: plain, storage: storage)
            applyInlineRuns(
                pattern: "(?<!\\*)\\*\\*([^*\\n]+)\\*\\*(?!\\*)",
                in: plain,
                storage: storage,
                attribute: .font,
                value: MarkdownStyle.bold
            )
            applyInlineRuns(
                pattern: "(?<![*\\w])\\*([^*\\n]+)\\*(?![*\\w])",
                in: plain,
                storage: storage,
                attribute: .font,
                value: MarkdownStyle.italic
            )
            applyInlineRuns(
                pattern: "`([^`\\n]+)`",
                in: plain,
                storage: storage,
                attribute: .font,
                value: MarkdownStyle.mono
            )
            storage.endEditing()
        }

        private func applyHeadings(in plain: NSString, storage: NSTextStorage) {
            // Heading is `^#{1,3}\s.*$` per line. Apply font+color
            // to the entire line including the `#` markers (so the
            // user sees the line as a heading visually, but can
            // still see and edit the source markers).
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
            }
        }

        private func applyInlineRuns(
            pattern: String,
            in plain: NSString,
            storage: NSTextStorage,
            attribute: NSAttributedString.Key,
            value: NSFont
        ) {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { return }
            let full = NSRange(location: 0, length: plain.length)
            regex.enumerateMatches(in: plain as String, range: full) { match, _, _ in
                guard let match = match else { return }
                // Apply to the whole match (including markers) so
                // the user sees the formatted text in place. Markers
                // remain visible — feels like Bear/Obsidian rather
                // than fully WYSIWYG.
                storage.addAttribute(attribute, value: value, range: match.range)
            }
        }
    }
}

/// NSTextView subclass that draws a placeholder string when empty
/// and routes through coalesced text-storage edits to dodge the
/// SwiftUI-update loop.
final class MarkdownTextView: NSTextView {
    var placeholderString: String = ""

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        if string.isEmpty {
            let insets = textContainerInset
            let origin = NSPoint(x: 5 + insets.width, y: insets.height)
            let attrs: [NSAttributedString.Key: Any] = [
                .font: MarkdownStyle.body,
                .foregroundColor: NSColor.tertiaryLabelColor,
            ]
            (placeholderString as NSString).draw(at: origin, withAttributes: attrs)
        }
    }
}

private enum MarkdownStyle {
    static let body = NSFont.systemFont(ofSize: 14)
    static let bold = NSFont.boldSystemFont(ofSize: 14)
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
}
