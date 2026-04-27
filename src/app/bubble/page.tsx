import { BubbleClient } from "./bubble-client";
import type { BubbleShape, BubbleSize } from "@/lib/recording/types";

/**
 * Iframe target for the Chrome extension's frameless bubble.
 *
 * The extension's content script injects this page as an <iframe> into the
 * tab being recorded. Because the iframe is loom.dissonance.cloud origin,
 * it inherits the camera permission the user already granted — no
 * cross-origin re-prompt.
 *
 * Render is fully transparent (no chrome) so the camera-clipped circle
 * sits naturally on the page being recorded. Drag events post out via
 * cross-origin postMessage to the parent window; the extension routes them
 * back to the recording tab.
 */
export const metadata = {
  robots: { index: false, follow: false },
};

export default async function BubbleIframePage({
  searchParams,
}: {
  searchParams: Promise<{ shape?: string; size?: string }>;
}) {
  const sp = await searchParams;
  const shape = (sp.shape as BubbleShape) || "circle";
  const size = (sp.size as BubbleSize) || "medium";
  return <BubbleClient shape={shape} size={size} />;
}
