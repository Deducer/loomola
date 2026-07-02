"use client";

import { useTheme } from "next-themes";
import { Toaster } from "sonner";

/** Sonner Toaster that follows the next-themes toggle instead of a
 *  hardcoded theme — toasts were rendering dark-on-light for light-mode
 *  users. Defaults dark while the theme is still resolving (matches the
 *  app's defaultTheme). */
export function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === "light" ? "light" : "dark"}
      position="bottom-right"
    />
  );
}
