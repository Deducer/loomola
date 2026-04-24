"use client";

import { useCallback, useRef, useState } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "./video-player";
import { TranscriptPanel } from "./transcript-panel";
import { ChaptersList } from "./chapters-list";
import { ActionItemsList } from "./action-items-list";
import { Tracking } from "./tracking";
import { CommentsSection } from "./comments-section";
import type { Word } from "@/lib/viewer/paragraphs";

type CommentRow = {
  id: string;
  commenterName: string;
  body: string;
  timestampSec: number;
  createdAt: string;
};

export type ViewerShellProps = {
  slug: string;
  signedVideoUrl: string;
  accentColor: string;
  chapters: Array<{ start_sec: number; title: string }>;
  actionItems: Array<{ timestamp_sec: number; text: string }>;
  words: Word[];
  fullText: string;
  isOwner: boolean;
  comments: CommentRow[];
  trimStartSec: number | null;
  trimEndSec: number | null;
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
  comments,
  trimStartSec,
  trimEndSec,
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

  // Deep-link support: on player ready, if the URL has a #t=<sec> fragment,
  // seek to it once.
  const handleReady = useCallback(() => {
    if (typeof window === "undefined") return;
    const match = window.location.hash.match(/^#t=(\d+(?:\.\d+)?)/);
    if (match) {
      const t = parseFloat(match[1]);
      if (isFinite(t) && t >= 0) {
        playerRef.current?.seek(t);
      }
    }
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
        onReady={handleReady}
        trimStartSec={trimStartSec}
        trimEndSec={trimEndSec}
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
      <CommentsSection
        comments={comments}
        slug={slug}
        isOwner={isOwner}
        onSeek={handleSeek}
        getCurrentTime={getCurrentTime}
      />
    </div>
  );
}
