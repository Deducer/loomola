import type { ReactNode } from "react";

/**
 * The /bubble route is rendered inside an iframe by the Chrome extension.
 * Everything outside the camera circle must be transparent so the page
 * being recorded shows through the iframe's "corners". globals.css sets
 * `html, body { background: var(--bg) }` for the rest of the app — we
 * override at multiple layers (html, body, #__next, [data-nextjs-scroll-focus-boundary])
 * with !important to defeat anything Tailwind / Next.js might paint behind us.
 */
export default function BubbleLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        html, body, #__next, [data-nextjs-scroll-focus-boundary] {
          background: transparent !important;
          background-color: transparent !important;
          background-image: none !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        html, body {
          overflow: hidden !important;
          width: 100% !important;
          height: 100% !important;
        }
        ::-webkit-scrollbar { display: none !important; }
      `}</style>
      {children}
    </>
  );
}
