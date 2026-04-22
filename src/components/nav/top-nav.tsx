import Link from "next/link";

type Props = {
  userEmail: string;
  activePath: "recordings" | "brands";
};

export function TopNav({ userEmail, activePath }: Props) {
  const items = [
    { href: "/", label: "Recordings", key: "recordings" as const },
    { href: "/brands", label: "Brands", key: "brands" as const },
  ];

  return (
    <nav className="flex items-center justify-between border-b border-white/10 px-6 py-3">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-sm font-semibold">
          Loom Clone
        </Link>
        <ul className="flex items-center gap-4">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className={
                  item.key === activePath
                    ? "text-sm font-medium"
                    : "text-sm opacity-60 hover:opacity-100"
                }
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs opacity-60">{userEmail}</span>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded border border-white/20 px-2.5 py-1 text-xs hover:bg-white/5"
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
