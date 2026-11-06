import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { db } from "@/db";
import { brandProfiles } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { updateRecordingBrand } from "@/db/queries/recordings";
import { mediaShareUrl } from "@/lib/recordings/queries";
import { getMcpOwnerId } from "./owner";
import { brandPickError, findOwnedMedia, resolveBrand } from "./lookup";
import { errorContent, jsonContent } from "./shared";

export function registerBrandTools(server: McpServer): void {
  server.registerTool(
    "loomola_list_brands",
    {
      title: "List Loomola brand profiles",
      description:
        "List the brand profiles (logo, accent colour, tagline, CTA) that can theme a share page. Use a brand's name or id with loomola_set_brand or the upload tools.",
      inputSchema: z.object({}),
    },
    async () => {
      const ownerId = await getMcpOwnerId();
      const rows = await db
        .select({
          id: brandProfiles.id,
          name: brandProfiles.name,
          accentColor: brandProfiles.accentColor,
          tagline: brandProfiles.tagline,
          ctaLabel: brandProfiles.ctaLabel,
          ctaUrl: brandProfiles.ctaUrl,
          hasLogo: brandProfiles.logoR2Key,
          legacyLogo: brandProfiles.logoUrl,
        })
        .from(brandProfiles)
        .where(eq(brandProfiles.ownerId, ownerId))
        .orderBy(desc(brandProfiles.createdAt));
      return jsonContent({
        brands: rows.map(({ hasLogo, legacyLogo, ...b }) => ({
          ...b,
          hasLogo: Boolean(hasLogo || legacyLogo),
        })),
      });
    }
  );

  server.registerTool(
    "loomola_set_brand",
    {
      title: "Set a recording's brand",
      description:
        "Set or change the brand profile on an existing recording, or clear it with brand=null. `recording` takes an id, slug or share URL; `brand` takes a brand name (case-insensitive, unique fragment ok) or id.",
      inputSchema: z.object({
        recording: z.string().min(3),
        brand: z.string().min(1).nullable(),
      }),
    },
    async (input) => {
      const ownerId = await getMcpOwnerId();
      const media = await findOwnedMedia(ownerId, input.recording);
      if (!media) return errorContent("not_found", `No recording matches "${input.recording}".`);

      let brand: { id: string; name: string } | null = null;
      if (input.brand !== null) {
        const pick = await resolveBrand(ownerId, input.brand);
        if (!pick.ok) {
          const e = brandPickError(input.brand, pick);
          return errorContent(e.error, e.message, { brands: e.brands });
        }
        brand = pick.brand;
      }

      await updateRecordingBrand({ id: media.id, ownerId, brandProfileId: brand?.id ?? null });
      return jsonContent({
        ok: true,
        recordingId: media.id,
        brand,
        shareUrl: mediaShareUrl(media),
      });
    }
  );
}
