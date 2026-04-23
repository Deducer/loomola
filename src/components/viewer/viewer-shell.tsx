"use client";

import { useCallback, useRef, useState } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "./video-player";
import { TranscriptPanel } from "./transcript-panel";
import { ChaptersList } from "./chapters-list";
import { ActionItemsList } from "./action-items-list";
import { Tracking } from "./tracking";
import type { Word } from "@/lib/viewer/paragraphs";

export type ViewerShellProps = {
  slug: string;
  signedVideoUrl: string;
  accentColor: string;
  chapters: Array<{ start_sec: number; title: string }>;
  actionItems: Array<{ timestamp_sec: number; text: string }>;
  words: Word[];
  fullText: string;
  isOwner: boolean;
};

export function ViewerShell({
  slug,
  signedVideoUrl,
  accentColor,
  chapters,
  actionItems,
  words,
  fullText,
  isOwner,
}: ViewerShellProps) {
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const handleSeek = useCallback((sec: number) => {
    playerRef.current?.seek(sec);
  }, []);

  const getCurrentTime = useCallback(() => {
    return playerRef.current?.getCurrentTime() ?? 0;
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
        onPlayStateChange={setIsPlaying}
      />
      {!isOwner && (
        <Tracking
          slug={slug}
          isPlaying={isPlaying}
          getCurrentTime={getCurrentTime}
        />
      )}
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
