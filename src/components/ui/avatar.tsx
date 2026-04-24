import * as React from "react";
import { cn } from "@/lib/cn";

function initialsFrom(str: string): string {
  const parts = str.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

export function Avatar({
  name,
  size = 28,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-accent/20 font-medium text-accent",
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initialsFrom(name)}
    </div>
  );
}
