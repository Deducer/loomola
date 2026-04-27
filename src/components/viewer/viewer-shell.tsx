"use client";

import { useCallback, useRef, useState } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "./video-player";
import { TranscriptPanel } from "./transcript-panel";
import { ChaptersList } from "./chapters-list";
import { SummaryBlock } from "./summary-block";
import { ActionItemsBlock } from "./action-items-block";
import { ContentTabs } from "./content-tabs";
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
  summary: string | null | undefined;
  chapters: Array<{ start_sec: number; title: string }>;
  actionItems: Array<{ timestamp_sec: number; text: string }>;
  words: Word[];
  fullText: string;
  isOwner: boolean;
  comments: CommentRow[];
  trimStartSec: number | null;
  trimEndSec: number | null;
  durationSec: number | null;
  previewThumbnailsVttUrl: string | null;
};

export function ViewerShell({
  slug,
  signedVideoUrl,
  accentColor,
  summary,
  chapters,
  actionItems,
  words,
  fullText,
  isOwner,
  comments,
  trimStartSec,
  trimEndSec,
  durationSec,
  previewThumbnailsVttUrl,
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
        durationSec={durationSec}
        previewThumbnailsVttUrl={previewThumbnailsVttUrl}
      />
      {!isOwner && (
        <Tracking
          slug={slug}
          isPlaying={isPlaying}
          getCurrentTime={getCurrentTime}
        />
      )}

      <SummaryBlock summary={summary} />
      <ActionItemsBlock actionItems={actionItems} onSeek={handleSeek} />
      <ChaptersList chapters={chapters} onSeek={handleSeek} />

      <ContentTabs
        transcript={
          <TranscriptPanel
            words={words}
            fullText={fullText}
            currentTime={currentTime}
            onSeek={handleSeek}
          />
        }
        comments={
          <CommentsSection
            comments={comments}
            slug={slug}
            isOwner={isOwner}
            onSeek={handleSeek}
            getCurrentTime={getCurrentTime}
          />
        }
      />
    </div>
  );
}
