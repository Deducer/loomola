import { requireAuth } from "@/lib/require-auth";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TopNav } from "@/components/nav/top-nav";

export default async function HomePage() {
  const user = await requireAuth();
  return (
    <>
      <TopNav userEmail={user.email ?? "unknown"} activePath="recordings" />
      <EmptyState />
    </>
  );
}
