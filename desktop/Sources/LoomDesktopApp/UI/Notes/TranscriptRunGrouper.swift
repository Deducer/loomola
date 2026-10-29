import Foundation

/// One bubble in the transcript tab. Internal so the run grouper and
/// its tests can build them; the workspace fills them from live
/// segments or the saved transcript's paragraphs.
struct TranscriptDisplayBubble: Identifiable, Equatable {
    let id: String
    let source: LiveTranscriptAudioSource?
    let speaker: String?
    let text: String
    let isInterim: Bool
    let startSec: Double
    let endSec: Double
    /// Diarized index for batch transcripts — nil for live/full-text
    /// bubbles. Drives the "who is this?" manual-identify fallback.
    var speakerIdx: Int? = nil
}

/// A run of consecutive bubbles by the same speaker (Granola groups
/// paragraphs under one speaker label with a timestamp in the gutter).
struct TranscriptRun: Identifiable, Equatable {
    let id: String
    let speaker: String?
    let speakerIdx: Int?
    let source: LiveTranscriptAudioSource?
    let startSec: Double
    let paragraphs: [TranscriptDisplayBubble]
    /// False for legacy full-text transcripts that carry no offsets;
    /// the gutter then stays empty instead of repeating the start time.
    var hasTiming: Bool { paragraphs.contains { $0.endSec > 0 } }
}

enum TranscriptRunGrouper {
    /// Merge consecutive bubbles with the same speaker when the gap
    /// between them is under `gapSeconds`; a longer silence starts a
    /// new run (and a new timestamp).
    static func runs(
        from bubbles: [TranscriptDisplayBubble],
        gapSeconds: Double = 8
    ) -> [TranscriptRun] {
        var runs: [TranscriptRun] = []
        for bubble in bubbles {
            if let last = runs.last,
               sameSpeaker(last, bubble),
               bubble.startSec - (last.paragraphs.last?.endSec ?? last.startSec) < gapSeconds {
                runs[runs.count - 1] = TranscriptRun(
                    id: last.id,
                    speaker: last.speaker,
                    speakerIdx: last.speakerIdx,
                    source: last.source,
                    startSec: last.startSec,
                    paragraphs: last.paragraphs + [bubble]
                )
            } else {
                runs.append(
                    TranscriptRun(
                        id: "run-\(bubble.id)",
                        speaker: bubble.speaker,
                        speakerIdx: bubble.speakerIdx,
                        source: bubble.source,
                        startSec: bubble.startSec,
                        paragraphs: [bubble]
                    )
                )
            }
        }
        return runs
    }

    private static func sameSpeaker(_ run: TranscriptRun, _ bubble: TranscriptDisplayBubble) -> Bool {
        if let idx = run.speakerIdx, let other = bubble.speakerIdx { return idx == other }
        if let source = run.source, let other = bubble.source {
            // Call audio carries several diarized voices under one
            // source; only the same labelled voice continues a run.
            return source == other && (run.speaker ?? "") == (bubble.speaker ?? "")
        }
        return (run.speaker ?? "") == (bubble.speaker ?? "")
    }

    /// Longest a live paragraph may grow before the next segment starts
    /// a fresh bubble, so a talkative call never becomes one wall.
    static let liveParagraphMaxSeconds: Double = 30
    static let liveParagraphMaxWords = 70
    /// Consecutive same-voice segments closer than this merge into one
    /// paragraph; a longer pause reads as a new thought.
    static let liveParagraphGapSeconds: Double = 2.5

    /// Bubbles for the live transcript tab: consecutive final segments
    /// from the same voice merge into a paragraph until a pause, a
    /// voice change, or the size cap (ideally at a sentence end), and
    /// each stream's interim text trails as a dimmed bubble.
    static func liveBubbles(
        segments: [LiveTranscriptSegment],
        interimBySource: [LiveTranscriptAudioSource: String]
    ) -> [TranscriptDisplayBubble] {
        var bubbles: [TranscriptDisplayBubble] = []
        for segment in segments {
            let text = segment.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }
            let label = segment.displayLabel
            if let last = bubbles.last,
               !last.isInterim,
               last.source == segment.source,
               last.speaker == label,
               segment.startSec - last.endSec < liveParagraphGapSeconds,
               !isFull(last, adding: text, endingAt: segment.endSec) {
                bubbles[bubbles.count - 1] = TranscriptDisplayBubble(
                    id: last.id,
                    source: last.source,
                    speaker: last.speaker,
                    text: [last.text, text].joined(separator: " "),
                    isInterim: false,
                    startSec: last.startSec,
                    endSec: segment.endSec
                )
            } else {
                bubbles.append(
                    TranscriptDisplayBubble(
                        id: segment.id.uuidString,
                        source: segment.source,
                        speaker: label,
                        text: text,
                        isInterim: false,
                        startSec: segment.startSec,
                        endSec: segment.endSec
                    )
                )
            }
        }

        for source in LiveTranscriptAudioSource.allCases {
            guard let interim = interimBySource[source]?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !interim.isEmpty
            else { continue }
            // Interim text has no speaker yet; keep it under the voice
            // this stream last used so it doesn't open a stray run.
            let label = bubbles.last(where: { $0.source == source })?.speaker ?? source.displayName
            bubbles.append(
                TranscriptDisplayBubble(
                    id: "interim-\(source.rawValue)",
                    source: source,
                    speaker: label,
                    text: interim,
                    isInterim: true,
                    startSec: bubbles.last?.endSec ?? 0,
                    endSec: bubbles.last?.endSec ?? 0
                )
            )
        }
        return bubbles
    }

    /// A paragraph is full once it has run past the duration or word
    /// cap and the text so far ends a sentence; past double the cap it
    /// breaks regardless, so an unpunctuated ramble still wraps.
    private static func isFull(_ bubble: TranscriptDisplayBubble, adding text: String, endingAt end: Double) -> Bool {
        let duration = bubble.endSec - bubble.startSec
        let words = bubble.text.split(separator: " ").count
        let overCap = duration >= liveParagraphMaxSeconds || words >= liveParagraphMaxWords
        guard overCap else { return false }
        let hardCap = duration >= liveParagraphMaxSeconds * 2 || words >= liveParagraphMaxWords * 2
        return hardCap || endsSentence(bubble.text)
    }

    private static func endsSentence(_ text: String) -> Bool {
        guard let last = text.last else { return false }
        return ".?!".contains(last)
    }

    /// Legacy transcripts arrive as one text block with inline
    /// "Name: words" lines (imports, pre-diarization notes). Split them
    /// into one bubble per line so the run layout still applies.
    static func bubbles(fromFullText text: String) -> [TranscriptDisplayBubble] {
        let lines = text
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        return lines.enumerated().map { index, line in
            var speaker: String? = nil
            var body = line
            if let colon = line.firstIndex(of: ":") {
                let candidate = String(line[..<colon])
                let rest = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                let wordCount = candidate.split(separator: " ").count
                if (1...4).contains(wordCount),
                   candidate.count <= 40,
                   candidate.first?.isUppercase == true,
                   !rest.isEmpty {
                    speaker = candidate
                    body = String(rest)
                }
            }
            return TranscriptDisplayBubble(
                id: "full-\(index)",
                source: nil,
                speaker: speaker,
                text: body,
                isInterim: false,
                startSec: 0,
                endSec: 0
            )
        }
    }

    /// Some saved transcripts arrive as one paragraph holding many
    /// "Name: words" lines. Expand those in place so the run layout
    /// can group them; paragraphs with real timing are left alone.
    static func expandingInlineSpeakerLines(_ paragraphs: [TranscriptDisplayBubble]) -> [TranscriptDisplayBubble] {
        paragraphs.flatMap { bubble -> [TranscriptDisplayBubble] in
            guard bubble.endSec == 0, bubble.text.contains("\n") else { return [bubble] }
            let split = Self.bubbles(fromFullText: bubble.text)
            guard split.count > 1, split.contains(where: { $0.speaker != nil }) else { return [bubble] }
            return split.enumerated().map { index, line in
                TranscriptDisplayBubble(
                    id: "\(bubble.id)-\(index)",
                    source: line.source,
                    speaker: line.speaker ?? bubble.speaker,
                    text: line.text,
                    isInterim: false,
                    startSec: 0,
                    endSec: 0
                )
            }
        }
    }

    /// Wall-clock label for the gutter: the recording's start plus the
    /// run's offset, "h:mm".
    static func gutterLabel(
        startSec: Double,
        recordingStart: Date,
        calendar: Calendar = .current
    ) -> String {
        RecentDateGrouping.formatter(format: "h:mm", calendar: calendar)
            .string(from: recordingStart.addingTimeInterval(startSec))
    }

    /// Stable per-speaker colour slot (0…5); "me" voices take slot 0.
    static func colorSlot(for run: TranscriptRun) -> Int {
        if run.source == .microphone { return 0 }
        if let idx = run.speakerIdx { return (idx % 5) + 1 }
        if run.source == .systemAudio {
            // Live call voices are "Speaker N"; give each its own slot.
            if let number = liveSpeakerNumber(run.speaker) { return ((number - 1) % 5) + 1 }
            return 1
        }
        // Named speakers without a diarization index (legacy
        // transcripts): a stable hash of the name picks the colour so
        // two people never share one by accident of ordering.
        if let name = run.speaker, !name.isEmpty {
            let hash = name.unicodeScalars.reduce(5381) { ($0 << 5) &+ $0 &+ Int($1.value) }
            return (abs(hash) % 5) + 1
        }
        return 5
    }

    /// 2 for "Speaker 2"; nil for any other label.
    static func liveSpeakerNumber(_ speaker: String?) -> Int? {
        guard let speaker, speaker.hasPrefix("Speaker ") else { return nil }
        return Int(speaker.dropFirst("Speaker ".count))
    }
}
