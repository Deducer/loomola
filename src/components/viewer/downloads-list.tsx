"use client";

export type DownloadLink = {
  kind: string;
  href: string;
};

export function DownloadsList({ links }: { links: DownloadLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="mt-4 rounded-lg border border-white/10 p-3 text-sm">
      <span className="opacity-60">Downloads:</span>
      <ul className="mt-2 space-y-1">
        {links.map((l) => (
          <li key={l.kind}>
            <a
              href={l.href}
              download
              className="inline-block rounded bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
            >
              {l.kind}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
