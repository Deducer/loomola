import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
  {
    variants: {
      variant: {
        neutral: "bg-bg-elevated text-text-muted",
        ready: "bg-emerald-500/15 text-emerald-400",
        processing: "bg-amber-500/15 text-amber-400",
        transcribing: "bg-amber-500/15 text-amber-400",
        uploading: "bg-blue-500/15 text-blue-400",
        failed: "bg-red-500/15 text-red-400",
        accent: "bg-accent/15 text-accent",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
