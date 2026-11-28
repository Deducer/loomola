"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { VideoPlayer, type VideoPlayerHandle } from "./video-player";
import { TranscriptPanel } from "./transcript-panel";
import { ChaptersList } from "./chapters-list";
import { SummaryBlock } from "./summary-block";
import { ActionItemsBlock } from "./action-items-block";
import { ContentTabs } from "./content-tabs";
import { Tracking } from "./tracking";
import { CommentsSection } from "./comments-section";
import { AnnotationOverlay, type DrawTool } from "./annotation-overlay";
import { EMPTY_DRAFT, type ReviewDraft } from "./review-draft";
import type { Word } from "@/lib/viewer/paragraphs";
import { toast } from "sonner";
import {
  MAX_ANNOTATION_BYTES,
  MAX_STROKES,
  annotationBytes,
  isEmptyAnnotation,
} from "@/lib/review/annotation";
import { effectiveFps, snapToFrame } from "@/lib/review/frames";
import {
  annotationAnchor,
  buildThreads,
  filterThreads,
  threadsNearTime,
  type CommentFilter,
  type CommentThread,
  type ReviewComment,
} from "@/lib/review/comments";

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
  comments: ReviewComment[];
  trimStartSec: number | null;
  trimEndSec: number | null;
  durationSec: number | null;
  previewThumbnailsVttUrl: string | null;
  /** Probed frame rate (null = unknown). */
  fps?: number | null;
  afterPlayer?: ReactNode;
  stickyPlayer?: boolean;
  showCommentForm?: boolean;
  /** "split": at xl (>=1280px) the Transcript/Comments tabs move into a
   *  sticky, viewport-height column beside the player (share page).
   *  Below xl, and for "stacked", they sit under the chapters. */
  layout?: "stacked" | "split";
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
  comments: serverComments,
  trimStartSec,
  trimEndSec,
  durationSec,
  previewThumbnailsVttUrl,
  fps = null,
  afterPlayer,
  stickyPlayer = false,
  showCommentForm = true,
  layout = "stacked",
}: ViewerShellProps) {
  const split = layout === "split";
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const fpsEff = effectiveFps(fps);

  // Local comments seeded from the server render. The form adds the new row
  // immediately; router.refresh() later re-seeds with the same ids.
  const [comments, setComments] = useState(serverComments);
  useEffect(() => {
    setComments(serverComments);
  }, [serverComments]);

  const threads = useMemo(() => buildThreads(comments), [comments]);
  const [filter, setFilter] = useState<CommentFilter>("all");
  // Resolved comments leave the seek bar unless you're looking at them.
  const markerThreads = useMemo(
    () => filterThreads(threads, filter === "resolved" ? "resolved" : "open"),
    [threads, filter]
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeThread = threads.find((t) => t.id === activeId) ?? null;
  const [draft, setDraft] = useState<ReviewDraft>(EMPTY_DRAFT);
  const [tabRequest, setTabRequest] = useState<{ tab: "comments"; nonce: number } | null>(null);

  const addComment = useCallback((c: ReviewComment) => {
    setComments((prev) => (prev.some((p) => p.id === c.id) ? prev : [...prev, c]));
  }, []);
  const replaceComment = useCallback((c: ReviewComment) => {
    setComments((prev) => prev.map((p) => (p.id === c.id ? c : p)));
  }, []);

  const handleSeek = useCallback((sec: number) => {
    playerRef.current?.seek(sec);
  }, []);

  const getCurrentTime = useCallback(() => {
    return playerRef.current?.getCurrentTime() ?? 0;
  }, []);

  const handlePlayState = useCallback((playing: boolean) => {
    setIsPlaying(playing);
    if (playing) {
      // The frame overlay clears on play.
      setActiveId(null);
      setDraft((d) => (d.tool ? { ...d, tool: null } : d));
    }
  }, []);

  const selectThread = useCallback(
    (t: CommentThread) => {
      playerRef.current?.pause();
      playerRef.current?.seek(snapToFrame(t.timestampSec, fpsEff));
      setActiveId(t.id);
      setDraft((d) => (d.tool ? { ...d, tool: null } : d));
      setTabRequest({ tab: "comments", nonce: Date.now() });
    },
    [fpsEff]
  );

  const selectThreadById = useCallback(
    (id: string) => {
      const t = threads.find((x) => x.id === id);
      if (t) selectThread(t);
    },
    [threads, selectThread]
  );

  const changeTool = useCallback(
    (tool: DrawTool | null) => {
      if (tool) playerRef.current?.pause();
      setActiveId(null);
      setDraft((d) => ({
        ...d,
        tool,
        anchorSec:
          tool && d.anchorSec === null
            ? snapToFrame(playerRef.current?.getCurrentTime() ?? 0, fpsEff)
            : d.anchorSec,
      }));
    },
    [fpsEff]
  );

  const changeAnnotation = useCallback(
    (annotation: ReviewDraft["annotation"]) => {
      // Refuse the mark here rather than fail the post after typing.
      if (annotationBytes(annotation) > MAX_ANNOTATION_BYTES - 512) {
        toast.error("That drawing is as detailed as a comment can hold. Post it, or undo a stroke.");
        return;
      }
      if ((annotation.strokes?.length ?? 0) >= MAX_STROKES) {
        toast.message(`${MAX_STROKES} marks is the most one comment can hold.`);
      }
      setDraft((d) => ({
        ...d,
        annotation,
        // The first mark pins the comment to the frame it was drawn on.
        anchorSec: isEmptyAnnotation(d.annotation)
          ? snapToFrame(playerRef.current?.getCurrentTime() ?? 0, fpsEff)
          : d.anchorSec,
      }));
    },
    [fpsEff]
  );

  const showDraft = useCallback(() => {
    if (draft.anchorSec === null) return;
    playerRef.current?.pause();
    playerRef.current?.seek(draft.anchorSec);
    setActiveId(null);
  }, [draft.anchorSec]);

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

  const atDraftFrame =
    draft.anchorSec !== null && Math.abs(currentTime - draft.anchorSec) < 0.75 / fpsEff;
  const renderOverlay = (video: HTMLVideoElement) => {
    if (draft.tool || (!isPlaying && atDraftFrame && !isEmptyAnnotation(draft.annotation))) {
      return (
        <AnnotationOverlay
          videoEl={video}
          annotation={draft.annotation}
          label={null}
          tool={draft.tool}
          color={draft.color}
          accentColor={accentColor}
          onChange={changeAnnotation}
        />
      );
    }
    if (!isPlaying && activeThread?.annotation) {
      return (
        <AnnotationOverlay
          videoEl={video}
          annotation={activeThread.annotation}
          label={activeThread.number}
          tool={null}
          color={draft.color}
          accentColor={accentColor}
        />
      );
    }
    if (isPlaying) {
      const pins = threadsNearTime(markerThreads, currentTime).flatMap((t) => {
        const a = annotationAnchor(t.annotation);
        return a ? [{ id: t.id, number: t.number, x: a.x, y: a.y }] : [];
      });
      if (pins.length === 0) return null;
      return (
        <AnnotationOverlay
          videoEl={video}
          annotation={null}
          tool={null}
          color={draft.color}
          accentColor={accentColor}
          pins={pins}
          onPinClick={selectThreadById}
        />
      );
    }
    return null;
  };

  const playerBlock = (
    <>
      <VideoPlayer
        ref={playerRef}
        slug={slug}
        initialSignedUrl={signedVideoUrl}
        chapters={chapters}
        accentColor={accentColor}
        onTimeUpdate={setCurrentTime}
        onPlayStateChange={handlePlayState}
        onReady={handleReady}
        trimStartSec={trimStartSec}
        trimEndSec={trimEndSec}
        durationSec={durationSec}
        previewThumbnailsVttUrl={previewThumbnailsVttUrl}
        threads={markerThreads}
        onSelectThread={selectThread}
        fps={fps}
        renderOverlay={renderOverlay}
        drawing={draft.tool !== null}
        // Once something is drawn it belongs to this frame: no stepping
        // away from it while the tool is out.
        lockFrame={draft.tool !== null && !isEmptyAnnotation(draft.annotation)}
      />
      {!isOwner && (
        <Tracking
          slug={slug}
          isPlaying={isPlaying}
          getCurrentTime={getCurrentTime}
        />
      )}
      {afterPlayer}
    </>
  );

  const tabs = (
    <ContentTabs
      panelOnXl={split}
      request={tabRequest}
      transcript={
        <TranscriptPanel
          words={words}
          wordsEndpoint={`/api/v/${slug}/transcript-words`}
          fullText={fullText}
          currentTime={currentTime}
          onSeek={handleSeek}
          showTimestamps
          fillHeightOnXl={split}
        />
      }
      comments={
        <CommentsSection
          threads={threads}
          slug={slug}
          fps={fps}
          isOwner={isOwner}
          filter={filter}
          onFilterChange={setFilter}
          activeId={activeId}
          onSelect={selectThread}
          currentTime={currentTime}
          getCurrentTime={getCurrentTime}
          onCommentAdded={addComment}
          onCommentChanged={replaceComment}
          draft={draft}
          onDraftChange={setDraft}
          onToolChange={changeTool}
          onShowDraft={showDraft}
          showForm={showCommentForm}
        />
      }
      commentCount={threads.length}
    />
  );

  const mainColumn = (
    <>
      {stickyPlayer ? (
        <div className="lg:sticky lg:top-6 lg:z-20">{playerBlock}</div>
      ) : (
        playerBlock
      )}

      <SummaryBlock summary={summary} />
      <ActionItemsBlock actionItems={actionItems} onSeek={handleSeek} />
      <ChaptersList chapters={chapters} onSeek={handleSeek} />
    </>
  );

  if (!split) {
    return (
      <div>
        {mainColumn}
        {tabs}
      </div>
    );
  }

  // One ContentTabs instance at every width (so the transcript is fetched
  // once and there is one comment form): the grid moves it into a sticky
  // right column at xl; below xl, block flow leaves it under the chapters.
  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] xl:gap-8">
      <div className="min-w-0">{mainColumn}</div>
      <aside aria-label="Transcript and comments" className="min-w-0">
        <div className="xl:sticky xl:top-6 xl:h-[calc(100dvh-3rem)]">{tabs}</div>
      </aside>
    </div>
  );
}
