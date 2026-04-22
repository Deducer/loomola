import { z } from "zod";

// Accept 3 or 6-digit hex with the leading #
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const brandProfileInputSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(60, "Name must be 60 characters or fewer")
    .trim(),
  accentColor: z
    .string()
    .regex(HEX_COLOR, "Accent color must be a hex code like #FF6B35"),
  logoUrl: z
    .string()
    .url("Logo URL must be a valid URL")
    .max(2048, "Logo URL too long")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type BrandProfileInput = z.infer<typeof brandProfileInputSchema>;
