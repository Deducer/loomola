"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Chrome's Document Picture-in-Picture API: opens a small "always on top
 * of other apps" window we can render arbitrary HTML into. Lets us put
 * recording controls in front of whatever the user is screen-sharing
 * without having to alt-tab back to the loom-clone tab.
 *
 * Chrome 116+; Safari/Firefox have nothing equivalent yet. The feature
 * silently degrades to "no floating window" on unsupported browsers and
 * the in-tab recording HUD remains the fallback.
 */
declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(opts?: {
        width?: number;
        height?: number;
        disallowReturnToOpener?: boolean;
      }): Promise<Window>;
      window: Window | null;
    };
  }
}

export function isDocPiPAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.documentPictureInPicture !== "undefined"
  );
}

type Props = {
  children: ReactNode;
  width?: number;
  height?: number;
  /** Called when the user closes the floating window manually. */
  onClose?: () => void;
};

/**
 * Opens a documentPictureInPicture window and portals its `children` into
 * that window's `<body>`. Copies the host page's stylesheets into the
 * pip document so Tailwind classes (and CSS variables / fonts) render
 * the same way.
 *
 * The window closes automatically when this component unmounts.
 */
export function PipWindow({ children, width = 360, height = 360, onClose }: Props) {
  const [pip, setPip] = useState<Window | null>(null);

  useEffect(() => {
    if (!isDocPiPAvailable()) return;

    let win: Window | null = null;
    let cancelled = false;

    (async () => {
      try {
        win = await window.documentPictureInPicture!.requestWindow({
          width,
          height,
        });
        if (cancelled) {
          win.close();
          return;
        }

        // Copy ALL host stylesheets + inline styles into the pip document
        // so Tailwind classes resolve identically. New CSS files added
        // by Next.js after mount won't propagate, but the app shell is
        // stable by the time we open the pip window.
        for (const node of Array.from(
          document.querySelectorAll("link[rel='stylesheet'], style")
        )) {
          win.document.head.appendChild(node.cloneNode(true));
        }

        // Inherit theme tokens so accent / text / bg colours match.
        win.document.documentElement.className = document.documentElement.className;
        win.document.body.className = document.body.className;

        win.addEventListener("pagehide", () => {
          onClose?.();
        });

        setPip(win);
      } catch (err) {
        console.warn("[docPiP] requestWindow failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      if (win) {
        try {
          win.close();
        } catch {
          /* ignore — already closed */
        }
      }
    };
  }, [width, height, onClose]);

  if (!pip) return null;
  return createPortal(children, pip.document.body);
}
