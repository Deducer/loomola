"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className={cn("h-8 w-[84px]", className)} aria-hidden />;
  }

  const Option = ({
    value,
    Icon,
    label,
  }: {
    value: "light" | "dark" | "system";
    Icon: React.ComponentType<{ className?: string }>;
    label: string;
  }) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={theme === value}
      onClick={() => setTheme(value)}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors",
        theme === value
          ? "bg-bg-elevated text-text"
          : "text-text-subtle hover:text-text-muted"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <div
      className={cn(
        "inline-flex h-8 items-center gap-0.5 rounded-md border border-border p-0.5",
        className
      )}
    >
      <Option value="light" Icon={Sun} label="Light" />
      <Option value="system" Icon={Monitor} label="System" />
      <Option value="dark" Icon={Moon} label="Dark" />
    </div>
  );
}
