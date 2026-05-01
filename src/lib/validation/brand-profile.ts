import { z } from "zod";

// Accept 3 or 6-digit hex with the leading #
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const optionalUrl = z
  .string()
  .url("Must be a valid URL")
  .max(2048, "URL too long")
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalText = (max: number, label = "Field") =>
  z
    .string()
    .max(max, `${label} too long`)
    .optional()
    .or(z.literal("").transform(() => undefined));

export const brandProfileInputSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(60, "Name must be 60 characters or fewer")
    .trim(),
  accentColor: z
    .string()
    .regex(HEX_COLOR, "Accent color must be a hex code like #FF6B35"),
  logoUrl: optionalUrl,
  // Layer 2 — full-page theming on share pages.
  tagline: optionalText(140, "Tagline"),
  fontFamily: optionalText(60, "Font family"),
  ctaLabel: optionalText(40, "CTA label"),
  ctaUrl: optionalUrl,
  footerText: optionalText(280, "Footer"),
  // null = visitor's OS / their last toggle wins. 'light' / 'dark' =
  // applied on first visit when the visitor has no stored preference.
  defaultTheme: z
    .enum(["light", "dark"])
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
});

export type BrandProfileInput = z.infer<typeof brandProfileInputSchema>;

export const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const LOGO_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);
export const LOGO_MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};
