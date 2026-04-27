"use client";

import { useEffect, useState } from "react";
import type { BubbleShape, BubbleSize } from "@/lib/recording/types";
import type { BubblePositionController } from "@/lib/recording/composite-canvas";

/**
 * Talks to the Chrome extension companion.
 *
 * - On mount: posts `recording-started` to the window so the extension's
 *   loom.dissonance.cloud content script forwards it to the background, which
 *   asks every captured tab's content script to inject the frameless bubble.
 * - On unmount: posts `recording-stopped`.
 * - While mounted: listens for `bubble-position` messages coming back from
 *   the captured tab (via the extension's message bridge) and writes the
 *   fractional position into the existing `BubblePositionController` so the
 *   compositor picks it up next frame.
 *
 * Renders nothing. Safely no-ops when the extension isn't installed (the
 * window messages just go nowhere).
 */
export function ExtensionBridge({
  bubbleShape,
  bubbleSize,
  positionController,
}: {
  bubbleShape: BubbleShape;
  bubbleSize: BubbleSize;
  positionController: BubblePositionController;
}) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    window.postMessage(
      {
        source: "loom-clone",
        type: "recording-started",
        bubbleShape,
        bubbleSize,
      },
      window.location.origin
    );

    function onMessage(event: MessageEvent) {
      const data = event.data;
      if (
        !data ||
        data.source !== "loom-clone-extension" ||
        data.type !== "bubble-position"
      ) {
        return;
      }
      const pos = data.position;
      if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return;
      positionController.current = {
        x: Math.min(1, Math.max(0, pos.x)),
        y: Math.min(1, Math.max(0, pos.y)),
      };
    }
    window.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("message", onMessage);
      window.postMessage(
        { source: "loom-clone", type: "recording-stopped" },
        window.location.origin
      );
    };
  }, [bubbleShape, bubbleSize, positionController]);

  return null;
}

/**
 * True if the extension's content script has signalled `installed`. Used to
 * suppress the in-app docPiP fallback so the user doesn't see two bubbles.
 */
export function useExtensionInstalled(): boolean {
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data;
      if (data?.source === "loom-clone-extension" && data.type === "installed") {
        setInstalled(true);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return installed;
}
