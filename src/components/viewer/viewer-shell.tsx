"use client";

import { useCallback, useRef, useState } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "./video-player";
import { TranscriptPanel } from "./transcript-panel";
import { ChaptersList } from "./chapters-list";
import { ActionItemsList } from "./action-items-list";
import type { Word } from "@/lib/viewer/paragraphs";

export type ViewerShellProps = {
  slug: string;
  signedVideoUrl: string;
  accentColor: string;
  chapters: Array<{ start_sec: number; title: string }>;
  actionItems: Array<{ timestamp_sec: number; text: string }>;
  words: Word[];
  fullText: string;
};

export function ViewerShell({
  slug,
  signedVideoUrl,
  accentColor,
  chapters,
  actionItems,
  words,
  fullText,
}: ViewerShellProps) {
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const handleSeek = useCallback((sec: number) => {
    playerRef.current?.seek(sec);
  }, []);

  return (
    <div>
      <VideoPlayer
        ref={playerRef}
        slug={slug}
        initialSignedUrl={signedVideoUrl}
        chapters={chapters}
        accentColor={accentColor}
        onTimeUpdate={setCurrentTime}
      />
      <TranscriptPanel
        words={words}
        fullText={fullText}
        currentTime={currentTime}
        onSeek={handleSeek}
      />
      <ChaptersList chapters={chapters} onSeek={handleSeek} />
      <ActionItemsList actionItems={actionItems} onSeek={handleSeek} />
    </div>
  );
}
