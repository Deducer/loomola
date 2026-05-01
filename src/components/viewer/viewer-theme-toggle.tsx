"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/**
 * Single icon button on the share page header — flips between light
 * and dark for the visitor and persists the choice in localStorage
 * (next-themes default). Hidden during the pre-mount window so it
 * doesn't render with the wrong icon and then flip on hydration.
 *
 * Distinct from the dashboard's three-segment Light / System / Dark
 * toggle: visitors don't need a "system" knob — their first visit
 * already inherits system (or the brand's defaultTheme via the
 * bootstrap script in /v/<slug>/page.tsx). Once they tap the icon
 * here, their explicit preference takes over.
 */
export function ViewerThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-7 w-7" aria-hidden />;
  }

  const isDark = resolvedTheme === "dark";
  const Icon = isDark ? Sun : Moon;
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-elevated hover:text-text"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
