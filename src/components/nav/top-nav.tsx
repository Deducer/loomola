import Link from "next/link";
import Image from "next/image";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BuildStamp } from "@/components/nav/build-stamp";
import { cn } from "@/lib/cn";

type Props = {
  userEmail: string;
  activePath: "recordings" | "brands" | "record" | "people" | "dictionary";
  granolaEnabled?: boolean;
};

export function TopNav({ userEmail, activePath, granolaEnabled = false }: Props) {
  const items = [
    { href: "/", label: "Recordings", key: "recordings" as const },
    { href: "/brands", label: "Brands", key: "brands" as const },
    ...(granolaEnabled
      ? [
          { href: "/people", label: "People", key: "people" as const },
          { href: "/dictionary", label: "Dictionary", key: "dictionary" as const },
        ]
      : []),
  ];

  const linkClass = (active: boolean) =>
    cn(
      "text-sm transition-colors",
      active ? "text-text font-medium" : "text-text-muted hover:text-text"
    );

  return (
    <nav className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4 sm:gap-6 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center"
          aria-label="loomola home"
        >
          {/* Mark-only logo on narrow widths so the full wordmark
              doesn't get squeezed off-screen by the nav links + right
              group on phones. The mark is the colorful sun on its own
              (no dark-gray wordmark to fight the dark theme), so it
              renders as-is in both themes. The inline wordmark from
              sm: up still needs the dark-mode silhouette flattening. */}
          <Image
            src="/branding/loomola-logo-mark.png"
            alt="loomola"
            width={32}
            height={32}
            priority
            className="h-8 w-8 sm:hidden"
          />
          <Image
            src="/branding/loomola-logo-inline.png"
            alt="loomola"
            width={120}
            height={32}
            priority
            // Source asset is a colorful sun + dark-gray "loomola" wordmark
            // — reads great on light, illegible on dark. Until we have a
            // proper dark-mode variant, flatten to a white silhouette in
            // dark mode so the wordmark stays readable. Loses the colors
            // of the sun mark but keeps the shape recognizable.
            className="hidden h-8 w-auto sm:inline dark:brightness-0 dark:invert"
          />
        </Link>
        <ul className="flex items-center gap-5">
          {items.map((item) => (
            <li key={item.key}>
              <Link href={item.href} className={linkClass(item.key === activePath)}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Avatar name={userEmail} size={24} />
            <span className="hidden sm:inline">{userEmail}</span>
          </div>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
          <BuildStamp />
        </div>
      </div>
    </nav>
  );
}
