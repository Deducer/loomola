import type { ReactNode } from "react";

/**
 * The /bubble route is rendered inside an iframe by the Chrome extension.
 * It must be transparent everywhere except the camera circle so the page
 * being recorded shows through the iframe's "corners". globals.css sets
 * `html, body { background: var(--bg) }` for the rest of the app — override
 * with !important here so the iframe area outside the circle is invisible.
 */
export default function BubbleLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`html, body {
        background: transparent !important;
        background-color: transparent !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
      }`}</style>
      {children}
    </>
  );
}
