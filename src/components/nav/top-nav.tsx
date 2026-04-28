import Link from "next/link";
import Image from "next/image";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/cn";

type Props = {
  userEmail: string;
  activePath: "recordings" | "brands" | "record";
};

export function TopNav({ userEmail, activePath }: Props) {
  const items = [
    { href: "/", label: "Recordings", key: "recordings" as const },
    { href: "/brands", label: "Brands", key: "brands" as const },
  ];

  const linkClass = (active: boolean) =>
    cn(
      "text-sm transition-colors",
      active ? "text-text font-medium" : "text-text-muted hover:text-text"
    );

  return (
    <nav className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-6">
        <Link
          href="/"
          className="flex items-center"
          aria-label="loomola home"
        >
          <Image
            src="/branding/loomola-logo-inline.png"
            alt="loomola"
            width={120}
            height={32}
            priority
            className="h-8 w-auto"
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
        </div>
      </div>
    </nav>
  );
}
