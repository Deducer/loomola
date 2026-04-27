"use client";

import { useEffect, useState } from "react";

/**
 * Tiny visible pill in the corner of /record that tells the user whether
 * the Chrome extension is detected. Saves a DevTools round-trip when
 * something's off.
 */
export function ExtensionStatusPill() {
  const [installed, setInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;

    function check() {
      if (document.documentElement.dataset.loomCloneExtension === "1") {
        setInstalled(true);
        return true;
      }
      return false;
    }
    if (check()) return;

    setInstalled(false);

    function onMessage(event: MessageEvent) {
      const data = event.data;
      if (data?.source === "loom-clone-extension" && data.type === "installed") {
        setInstalled(true);
      }
    }
    window.addEventListener("message", onMessage);

    // Ping in case the content script is already loaded.
    window.postMessage(
      { source: "loom-clone", type: "ping-extension" },
      window.location.origin
    );

    // Re-check the dataset a few times (the content script runs at
    // document_idle, which can be after this hook attaches if the page is
    // slow to load).
    const checks = [200, 500, 1000, 2000].map((ms) =>
      window.setTimeout(check, ms)
    );

    return () => {
      window.removeEventListener("message", onMessage);
      checks.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  if (installed === null) return null;

  return (
    <div
      className={
        "fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs " +
        (installed
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-border-strong bg-bg-elevated text-text-muted")
      }
      title={
        installed
          ? "Chrome extension detected — frameless bubble will be used during recording."
          : "Chrome extension NOT detected — falling back to documentPictureInPicture bubble. If you installed the extension, reload it at chrome://extensions and hard-refresh this page."
      }
    >
      <span
        aria-hidden="true"
        className={
          "h-1.5 w-1.5 rounded-full " +
          (installed ? "bg-emerald-400" : "bg-text-subtle")
        }
      />
      {installed
        ? "Frameless bubble extension detected"
        : "Frameless bubble extension not detected"}
    </div>
  );
}
