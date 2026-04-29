"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * App-level error boundary. Catches anything that escapes a route's own
 * try/catch and prevents the white-screen "Application error" default.
 *
 * Special-cases the Next.js Server-Actions-after-deploy error: when a
 * tab was open during a deploy, its bundle still references the
 * old action ID; submitting throws UnrecognizedActionError because
 * the server's new build doesn't know that ID. Tell the user to
 * refresh — that's the only fix.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app error boundary]", error);
  }, [error]);

  const isStaleAction =
    error.name === "UnrecognizedActionError" ||
    /Server Action.*was not found on the server/i.test(error.message);

  if (isStaleAction) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <h1 className="text-xl font-semibold text-text">The app was updated</h1>
        <p className="text-sm text-text-muted">
          This page loaded before the latest deploy and the action you tried
          to use no longer exists by that ID. A refresh will pull the current
          version.
        </p>
        <Button onClick={() => window.location.reload()}>Refresh page</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <h1 className="text-xl font-semibold text-text">Something went wrong</h1>
      <p className="text-sm text-text-muted break-words">
        {error.message || "An unexpected error occurred."}
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-text-subtle">Ref: {error.digest}</p>
      )}
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button
          variant="outline"
          onClick={() => (window.location.href = "/")}
        >
          Back to dashboard
        </Button>
      </div>
    </div>
  );
}
