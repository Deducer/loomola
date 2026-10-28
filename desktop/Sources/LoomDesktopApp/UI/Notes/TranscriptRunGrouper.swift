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
        if let source = run.source, let other = bubble.source { return source == other }
        return (run.speaker ?? "") == (bubble.speaker ?? "")
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
        if run.source == .systemAudio { return 1 }
        // Named speakers without a diarization index (legacy
        // transcripts): a stable hash of the name picks the colour so
        // two people never share one by accident of ordering.
        if let name = run.speaker, !name.isEmpty {
            let hash = name.unicodeScalars.reduce(5381) { ($0 << 5) &+ $0 &+ Int($1.value) }
            return (abs(hash) % 5) + 1
        }
        return 5
    }
}
