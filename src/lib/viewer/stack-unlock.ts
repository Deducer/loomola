import { cookies } from "next/headers";
import { cookieName, verifyUnlockToken } from "@/lib/viewer/unlock-cookie";
import { stackSlugsSharingPassword } from "@/db/queries/versions";

/**
 * Has this visitor unlocked `slug`? Versions in a stack share one password,
 * so an unlock cookie for any version with the same password hash counts:
 * one unlock covers the whole stack. The cookie still binds slug + hash, so
 * changing the password (applied stack-wide) invalidates every cookie.
 */
export async function isUnlockedForStack(
  slug: string,
  rec: { id: string; ownerId: string; versionGroupId: string | null; passwordHash: string | null }
): Promise<boolean> {
  if (!rec.passwordHash) return true;
  const jar = await cookies();
  const own = jar.get(cookieName(slug))?.value ?? "";
  if (verifyUnlockToken({ slug, passwordHash: rec.passwordHash, token: own })) return true;
  if (!rec.versionGroupId) return false;
  const others = await stackSlugsSharingPassword(rec);
  return others.some((other) =>
    verifyUnlockToken({
      slug: other,
      passwordHash: rec.passwordHash!,
      token: jar.get(cookieName(other))?.value ?? "",
    })
  );
}
