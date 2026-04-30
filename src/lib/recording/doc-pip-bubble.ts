"use client";

import type { BubbleSize, BubbleShape } from "./types";

const SIZE_PX: Record<BubbleSize, number> = {
  small: 160,
  medium: 220,
  large: 280,
};

// docPiP windows include OS chrome (titlebar etc.) so we add ~40 px of
// height for the in-window size picker bar, on top of the camera circle's
// square footprint. Tweakable.
const TOOLBAR_HEIGHT = 40;

export type DocPipBubbleHandle = {
  close: () => void;
  setSize: (size: BubbleSize) => void;
  /** Resolves when the docPiP window is dismissed (manually closed or
   *  programmatically via close()). Lets callers update UI state when
   *  the user closes the window mid-recording. */
  closed: Promise<void>;
};

/**
 * Opens a Document-Picture-in-Picture window rendering the recording's
 * camera stream as a circular bubble + a Loom-style size picker. The
 * docPiP window is system-level — visible across apps, including
 * non-Chrome surfaces (Finder, Terminal, Slack, etc.) — which is the
 * gap the extension iframe can't fill.
 *
 * Throws if docPiP is unsupported (Chrome <114) or if user activation
 * has lapsed by the time we call requestWindow. Callers should catch
 * and fall back to extension-iframe-only behavior.
 */
export async function openDocPipBubble({
  cameraStream,
  initialSize,
  initialShape,
  onSizeChange,
}: {
  cameraStream: MediaStream;
  initialSize: BubbleSize;
  initialShape: BubbleShape;
  onSizeChange?: (size: BubbleSize) => void;
}): Promise<DocPipBubbleHandle> {
  type DocPipApi = {
    requestWindow: (opts: { width: number; height: number }) => Promise<Window>;
  };
  const dp = (window as unknown as { documentPictureInPicture?: DocPipApi })
    .documentPictureInPicture;
  if (!dp || typeof dp.requestWindow !== "function") {
    throw new Error("Document Picture-in-Picture not supported in this browser");
  }

  let activeSize = initialSize;
  const sizePx = SIZE_PX[activeSize];

  const pipWindow = await dp.requestWindow({
    width: sizePx,
    height: sizePx + TOOLBAR_HEIGHT,
  });

  const doc = pipWindow.document;
  doc.documentElement.style.cssText = "margin:0;padding:0;width:100%;height:100%;";
  doc.body.style.cssText =
    "margin:0;padding:0;background:#0b0b0c;color:#fff;" +
    "font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;" +
    "overflow:hidden;display:flex;flex-direction:column;align-items:center;" +
    "justify-content:center;";

  // Camera video (clipped to the requested shape).
  const videoWrap = doc.createElement("div");
  videoWrap.style.cssText = `flex:1 0 auto;display:flex;align-items:center;justify-content:center;width:100%;`;
  const video = doc.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.srcObject = cameraStream;
  applyVideoStyle(video, activeSize, initialShape);
  videoWrap.appendChild(video);

  // Size picker — three dots, click to switch. Mirrors extension/bubble.html
  // visually so the affordance is consistent across docPiP and iframe.
  const toolbar = doc.createElement("div");
  toolbar.style.cssText = `
    flex:0 0 auto;display:flex;align-items:center;justify-content:center;
    gap:6px;padding:8px;width:100%;background:rgba(0,0,0,0.85);
  `;
  const sizes: BubbleSize[] = ["small", "medium", "large"];
  const dotPx: Record<BubbleSize, number> = { small: 7, medium: 10, large: 13 };
  const dots: Record<BubbleSize, HTMLElement> = {} as Record<BubbleSize, HTMLElement>;
  for (const size of sizes) {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", `${size} bubble`);
    btn.style.cssText =
      "cursor:pointer;border:none;background:transparent;padding:4px;" +
      "border-radius:50%;display:flex;align-items:center;justify-content:center;";
    const dot = doc.createElement("span");
    dot.style.cssText = `
      width:${dotPx[size]}px;height:${dotPx[size]}px;border-radius:50%;
      background:${size === activeSize ? "#fff" : "rgba(255,255,255,0.6)"};
      transition:background 100ms;
    `;
    dots[size] = dot;
    btn.appendChild(dot);
    btn.addEventListener("click", () => {
      if (size === activeSize) return;
      setSize(size);
      onSizeChange?.(size);
    });
    toolbar.appendChild(btn);
  }

  doc.body.appendChild(videoWrap);
  doc.body.appendChild(toolbar);

  function setSize(size: BubbleSize) {
    activeSize = size;
    const px = SIZE_PX[size];
    applyVideoStyle(video, size, initialShape);
    try {
      pipWindow.resizeTo(px, px + TOOLBAR_HEIGHT);
    } catch {
      // Some platforms restrict programmatic resize; the camera still
      // updates inside the existing window.
    }
    for (const s of sizes) {
      dots[s].style.background =
        s === activeSize ? "#fff" : "rgba(255,255,255,0.6)";
    }
  }

  let closed = false;
  let resolveClosed: () => void = () => {};
  const closedPromise = new Promise<void>((r) => (resolveClosed = r));

  const onPageHide = () => {
    if (closed) return;
    closed = true;
    resolveClosed();
  };
  pipWindow.addEventListener("pagehide", onPageHide);

  return {
    close: () => {
      if (closed) return;
      try {
        pipWindow.close();
      } catch {
        /* ignore */
      }
      closed = true;
      resolveClosed();
    },
    setSize,
    closed: closedPromise,
  };
}

function applyVideoStyle(
  video: HTMLVideoElement,
  size: BubbleSize,
  shape: BubbleShape
) {
  const px = SIZE_PX[size];
  const radius =
    shape === "circle"
      ? "50%"
      : shape === "rounded-square"
        ? "18%"
        : shape === "rectangle"
          ? "8%"
          : "0";
  const clip =
    shape === "hexagon"
      ? "polygon(25% 6.7%, 75% 6.7%, 100% 50%, 75% 93.3%, 25% 93.3%, 0% 50%)"
      : "none";
  Object.assign(video.style, {
    width: `${px}px`,
    height: `${px}px`,
    objectFit: "cover" as const,
    borderRadius: radius,
    clipPath: clip,
    border: "2px solid rgba(255,255,255,0.7)",
    boxSizing: "border-box" as const,
    display: "block",
    background: "transparent",
  });
}
