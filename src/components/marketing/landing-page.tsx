import { Instrument_Serif } from "next/font/google";
import Link from "next/link";
import { ContactForm } from "./contact-form";

// Italic-leaning display serif. Free, on Google Fonts, gives the page
// the magazine/manifesto feel that separates this from the standard
// SaaS landing template. Loaded only on this route.
const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-display",
});

const GITHUB = "https://github.com/Deducer/loomola";
const X_HANDLE = "https://x.com/theiancross";

// Page palette. Lives in a CSS variable scope so this page is paper +
// ink regardless of next-themes state on the rest of the app.
const PAPER = "#f6f1e8";
const INK = "#1a1612";
const RULE = "#d4c9b3";
const ACCENT = "#7a2e1f"; // oxblood
const SOFT_INK = "#3a342d";

export function LandingPage() {
  return (
    <div
      className={`${instrument.variable} min-h-screen`}
      style={{
        backgroundColor: PAPER,
        color: INK,
        // Subtle paper grain via SVG noise. Very low opacity so it
        // reads as texture, not pattern.
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.05 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        backgroundSize: "240px 240px",
      }}
    >
      <Masthead />
      <Article />
      <Colophon />
    </div>
  );
}

/* ─────────────── Masthead ─────────────── */

function Masthead() {
  return (
    <header
      className="border-b"
      style={{ borderColor: RULE }}
    >
      <div className="mx-auto flex max-w-[68rem] items-end justify-between gap-8 px-6 py-5 sm:py-6">
        <div className="flex items-baseline gap-4">
          <span
            className="font-[family-name:var(--font-display)] text-[2.1rem] leading-none tracking-[-0.01em] sm:text-[2.4rem]"
            style={{ color: INK }}
          >
            Loomola
          </span>
          <span
            className="hidden font-mono text-[10px] uppercase tracking-[0.22em] sm:inline"
            style={{ color: SOFT_INK }}
          >
            Vol. I · No. 1 · May 2026
          </span>
        </div>
        <nav className="flex items-center gap-5 font-mono text-[11px] uppercase tracking-[0.18em]">
          <a
            href={GITHUB}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
            style={{ color: SOFT_INK, textUnderlineOffset: "4px" }}
          >
            GitHub
          </a>
          <a
            href={X_HANDLE}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
            style={{ color: SOFT_INK, textUnderlineOffset: "4px" }}
          >
            X
          </a>
          <Link
            href="/login"
            className="hover:underline"
            style={{ color: INK, textUnderlineOffset: "4px" }}
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}

/* ─────────────── Article body ─────────────── */

function Article() {
  return (
    <main className="mx-auto max-w-[42rem] px-6 pb-32 pt-16 sm:pt-24">
      {/* Tagline sits OVER the hero like a department label */}
      <p
        className="font-mono text-[11px] uppercase tracking-[0.32em]"
        style={{ color: ACCENT }}
      >
        Capture you own.
      </p>

      <h1
        className="font-[family-name:var(--font-display)] mt-6 text-[3.4rem] leading-[1.02] tracking-[-0.015em] sm:text-[4.6rem]"
        style={{ color: INK }}
      >
        An open-source{" "}
        <span style={{ fontStyle: "italic" }}>Loom + Granola</span> in one
        self-hosted package.
      </h1>

      <p
        className="mt-8 max-w-[36rem] text-[1.05rem] leading-[1.65] sm:text-[1.15rem]"
        style={{ color: SOFT_INK }}
      >
        Screen recordings with branded share pages. AI meeting notes with live
        transcription. Same Postgres, same R2, same Deepgram, same Claude.
        Run the whole thing on a $7&thinsp;VPS. Free, AGPL-3.0, single-user
        today.
      </p>

      <ByLine />

      <PullCallout />

      <Section number="01" title="Why this exists">
        <p className="text-[1.0625rem] leading-[1.7]">
          <span
            className="font-[family-name:var(--font-display)] float-left mr-2 mt-1 text-[4.5rem] leading-[0.85]"
            style={{ color: ACCENT, fontStyle: "italic" }}
          >
            I
          </span>
          got excited the day I found Cap. Spent a few hours trying to get the
          transcription path working on real meeting audio, submitted findings
          to the repo, others chimed in seeing the same thing. No fix arrived.
          Solo OSS with finite time, totally fair. Real respect for what
          Richie has built.
        </p>
        <p className="mt-5 text-[1.0625rem] leading-[1.7]">
          But I needed something that worked, and I also wanted Granola-shape
          meeting notes living alongside the screen recordings. That
          combination didn&apos;t exist anywhere I could find on the OSS side,
          so I started building Loomola. It&apos;s been my daily driver for a
          couple of months now.
        </p>
      </Section>

      <Section number="02" title="Specimen">
        <SpecimenTable />
      </Section>

      <Section number="03" title="Get it">
        <p className="text-[1.0625rem] leading-[1.7]">
          Loomola is single-tenant today. The fastest way in is to clone the
          repo and stand up your own instance. A pre-recorded setup
          walkthrough is on the way; live setup help is available paid.
        </p>
        <p className="mt-5 text-[1.0625rem] leading-[1.7]">
          <span style={{ color: ACCENT, fontWeight: 600 }}>
            Already shipped:
          </span>{" "}
          a Granola-to-Loomola CLI that imports your full Granola backlog
          (notes, transcripts, summaries, attendees, folders, speaker
          attribution). It uses Granola&apos;s official Business-tier API,
          so it requires a Granola Business subscription on the source side
          for now. I imported a couple hundred of my own notes with it last
          week.{" "}
          <span style={{ color: ACCENT, fontWeight: 600 }}>
            Coming next:
          </span>{" "}
          a Loom-to-Loomola CLI on the same shape. If you have a backlog you
          want to escape, send a note via the form below and I&apos;ll
          prioritize accordingly.
        </p>
        <div className="mt-7 flex flex-wrap items-stretch gap-3">
          <a
            href={GITHUB}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 font-mono text-[12px] uppercase tracking-[0.18em] transition"
            style={{
              backgroundColor: ACCENT,
              color: PAPER,
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="currentColor"
              aria-hidden
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Read it on GitHub
          </a>
          <a
            href={X_HANDLE}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-5 py-3 font-mono text-[12px] uppercase tracking-[0.18em]"
            style={{
              backgroundColor: "transparent",
              color: INK,
              border: `1px solid ${INK}`,
            }}
          >
            DM @theiancross
          </a>
        </div>
      </Section>

      <Section number="04" title="Get in touch">
        <p className="text-[1.0625rem] leading-[1.7]">
          Send a question, a feature request, or a war story. I read everything
          and tend to reply within a day.
        </p>
        <ul
          className="mt-4 space-y-1 text-[1rem] leading-[1.7]"
          style={{ color: SOFT_INK }}
        >
          <li>
            <span style={{ color: INK, fontWeight: 500 }}>
              Setup help.
            </span>{" "}
            Got stuck somewhere between Cloudflare R2 and the first
            recording? I do paid one-on-one walkthroughs.
          </li>
          <li>
            <span style={{ color: INK, fontWeight: 500 }}>
              Migration help.
            </span>{" "}
            Granola today, Loom soon. If you have a backlog to import, tell
            me what you have and how much.
          </li>
          <li>
            <span style={{ color: INK, fontWeight: 500 }}>
              New to self-hosting or open source?
            </span>{" "}
            Happy to help you find your footing. The whole point is that
            you own your stuff; I'll point you at the right docs and
            answer the dumb questions.
          </li>
          <li>
            <span style={{ color: INK, fontWeight: 500 }}>
              Feedback, feature requests, or just hi.
            </span>{" "}
            Especially welcome. Loomola is opinionated by design but the
            opinions aren't permanent.
          </li>
        </ul>
        <div className="mt-10">
          <ContactForm />
        </div>
        <p
          className="mt-6 font-mono text-[10px] uppercase tracking-[0.22em]"
          style={{ color: SOFT_INK }}
        >
          Prefer X?{" "}
          <a
            href={X_HANDLE}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
            style={{ color: INK, textUnderlineOffset: "3px" }}
          >
            DM @theiancross
          </a>
        </p>
      </Section>
    </main>
  );
}

/* ─────────────── Atoms ─────────────── */

function ByLine() {
  return (
    <div
      className="mt-10 flex items-center gap-3 border-t border-b py-3 font-mono text-[11px] uppercase tracking-[0.22em]"
      style={{ borderColor: RULE, color: SOFT_INK }}
    >
      <span style={{ color: INK }}>By Ian Cross</span>
      <Dot />
      <span>solo builder</span>
      <Dot />
      <a
        href="https://loom.dissonance.cloud"
        className="hover:underline"
        style={{ textUnderlineOffset: "3px" }}
      >
        loom.dissonance.cloud
      </a>
    </div>
  );
}

function Dot() {
  return (
    <span aria-hidden style={{ color: RULE }}>
      ◦
    </span>
  );
}

function PullCallout() {
  return (
    <blockquote
      className="my-16 border-l-2 pl-6 font-[family-name:var(--font-display)] text-[1.85rem] leading-[1.25] tracking-[-0.01em] sm:text-[2.15rem]"
      style={{ borderColor: ACCENT, color: INK, fontStyle: "italic" }}
    >
      <span
        className="mr-2"
        style={{ color: ACCENT, fontStyle: "normal" }}
        aria-hidden
      >
        “
      </span>
      Atlassian raised Loom prices roughly a hundred-fold in February. A solo
      founder in Liverpool made the screen-recording half free the same year.
      The meeting-notes half is what&apos;s missing.
    </blockquote>
  );
}

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-20">
      <header
        className="mb-7 flex items-baseline gap-4 border-b pb-3"
        style={{ borderColor: RULE }}
      >
        <span
          className="font-mono text-[11px] tracking-[0.22em]"
          style={{ color: ACCENT }}
        >
          §&nbsp;{number}
        </span>
        <h2
          className="font-[family-name:var(--font-display)] text-[1.7rem] leading-none tracking-[-0.01em]"
          style={{ color: INK }}
        >
          {title}
        </h2>
      </header>
      <div style={{ color: SOFT_INK }}>{children}</div>
    </section>
  );
}

/* ─────────────── Specimen table ─────────────── */

function SpecimenTable() {
  const rows: Array<{ label: string; cells: [string, string, string, string] }> = [
    {
      label: "Screen recording",
      cells: ["●", "—", "●", "●"],
    },
    {
      label: "AI meeting notes",
      cells: ["—", "●", "—", "●"],
    },
    {
      label: "Self-host",
      cells: ["—", "—", "●", "●"],
    },
    {
      label: "You pay / month",
      cells: ["$12.50–$20", "$20", "Free + paid host", "Just your infra"],
    },
    {
      label: "Transcription",
      cells: ["proprietary", "proprietary", "local Whisper", "Deepgram"],
    },
    {
      label: "Branded share pages",
      cells: ["enterprise tier", "—", "—", "yes"],
    },
    {
      label: "License",
      cells: ["proprietary", "proprietary", "AGPL-3.0", "AGPL-3.0"],
    },
  ];

  return (
    <div
      className="mt-2 overflow-x-auto border-t border-b"
      style={{ borderColor: INK }}
    >
      <table className="w-full min-w-[36rem] border-collapse">
        <thead>
          <tr style={{ borderBottom: `1px solid ${RULE}` }}>
            <th className="px-3 py-3 text-left font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: SOFT_INK }}>
              Capability
            </th>
            <Th>Loom</Th>
            <Th>Granola</Th>
            <Th>Cap</Th>
            <Th highlight>Loomola</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={row.label}
              style={{
                borderBottom:
                  idx === rows.length - 1 ? "none" : `1px solid ${RULE}`,
              }}
            >
              <td
                className="px-3 py-3 text-[0.95rem]"
                style={{ color: INK }}
              >
                {row.label}
              </td>
              {row.cells.map((c, i) => (
                <Td key={i} highlight={i === 3} accent={c === "●" && i === 3}>
                  {c}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  highlight,
}: {
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <th
      className="px-3 py-3 text-left font-mono text-[10px] uppercase tracking-[0.22em]"
      style={{
        color: highlight ? INK : SOFT_INK,
        fontWeight: highlight ? 600 : 400,
        // Vertical rule before the Loomola column so it reads as the
        // hero of the table without needing a fill color.
        borderLeft: highlight ? `1px solid ${INK}` : undefined,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  highlight,
  accent,
}: {
  children: React.ReactNode;
  highlight?: boolean;
  accent?: boolean;
}) {
  return (
    <td
      className="px-3 py-3 text-[0.95rem]"
      style={{
        color: accent ? ACCENT : highlight ? INK : SOFT_INK,
        fontWeight: highlight ? 500 : 400,
        borderLeft: highlight ? `1px solid ${INK}` : undefined,
      }}
    >
      {children}
    </td>
  );
}

/* ─────────────── Colophon (footer) ─────────────── */

function Colophon() {
  return (
    <footer
      className="border-t"
      style={{ borderColor: RULE }}
    >
      <div className="mx-auto grid max-w-[68rem] gap-8 px-6 py-12 sm:grid-cols-3">
        <div>
          <div
            className="font-mono text-[10px] uppercase tracking-[0.22em]"
            style={{ color: ACCENT }}
          >
            Type
          </div>
          <p className="mt-2 text-[0.95rem]" style={{ color: SOFT_INK }}>
            Instrument Serif. Geist. Geist Mono.
          </p>
        </div>
        <div>
          <div
            className="font-mono text-[10px] uppercase tracking-[0.22em]"
            style={{ color: ACCENT }}
          >
            Stack
          </div>
          <p className="mt-2 text-[0.95rem]" style={{ color: SOFT_INK }}>
            Next.js, Postgres, R2, Deepgram, Claude.
          </p>
        </div>
        <div>
          <div
            className="font-mono text-[10px] uppercase tracking-[0.22em]"
            style={{ color: ACCENT }}
          >
            Set in
          </div>
          <p className="mt-2 text-[0.95rem]" style={{ color: SOFT_INK }}>
            Boulder, Colorado &middot; deployed on a Hostinger VPS via Coolify
            &middot; not affiliated with Loom, Atlassian, Granola, or Cap.
          </p>
        </div>
      </div>
      <div
        className="border-t py-4"
        style={{ borderColor: RULE }}
      >
        <p
          className="mx-auto max-w-[68rem] px-6 font-mono text-[10px] uppercase tracking-[0.22em]"
          style={{ color: SOFT_INK }}
        >
          © {new Date().getFullYear()} Ian Cross &middot; AGPL-3.0 &middot;{" "}
          <a
            href={GITHUB}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
            style={{ textUnderlineOffset: "3px" }}
          >
            github.com/Deducer/loomola
          </a>
        </p>
      </div>
    </footer>
  );
}
