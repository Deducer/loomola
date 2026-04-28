"use server";

import { requireAuth } from "@/lib/require-auth";
import {
  brandProfileInputSchema,
  LOGO_ALLOWED_MIME,
  LOGO_MAX_BYTES,
  LOGO_MIME_TO_EXT,
  type BrandProfileInput,
} from "@/lib/validation/brand-profile";
import {
  createBrandProfile,
  updateBrandProfile,
  deleteBrandProfile,
} from "@/db/queries/brand-profiles";
import { uploadBytes } from "@/lib/r2/upload-bytes";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { nanoid } from "nanoid";
import type { ZodError } from "zod";

type ActionResult =
  | { ok: true }
  | { ok: false; fieldErrors: Partial<Record<keyof BrandProfileInput | "logo", string>> };

function parseFormData(formData: FormData) {
  return brandProfileInputSchema.safeParse({
    name: formData.get("name"),
    accentColor: formData.get("accentColor"),
    // Form no longer accepts a direct URL — keep the field optional in the
    // schema for backwards compat with rows that still have logo_url set.
    logoUrl: undefined,
    tagline: formData.get("tagline") ?? "",
    fontFamily: formData.get("fontFamily") ?? "",
    ctaLabel: formData.get("ctaLabel") ?? "",
    ctaUrl: formData.get("ctaUrl") ?? "",
    footerText: formData.get("footerText") ?? "",
  });
}

function formatErrors(
  error: ZodError
): Partial<Record<keyof BrandProfileInput, string>> {
  const fieldErrors: Partial<Record<keyof BrandProfileInput, string>> = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as keyof BrandProfileInput | undefined;
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

/**
 * If a non-empty logo file was uploaded, validates and uploads it to R2.
 * Returns the R2 key on success, an error string for the form on failure,
 * or undefined when no file was attached (caller should preserve the
 * existing logoR2Key).
 */
async function uploadLogoIfPresent(
  formData: FormData,
  ownerId: string,
  fieldName: string
): Promise<{ key: string } | { error: string } | undefined> {
  const file = formData.get(fieldName);
  if (!(file instanceof File) || file.size === 0) return undefined;

  if (!LOGO_ALLOWED_MIME.has(file.type)) {
    return { error: "Use PNG, JPG, WebP, or SVG." };
  }
  if (file.size > LOGO_MAX_BYTES) {
    return { error: "Logo must be 2 MB or smaller." };
  }
  const ext = LOGO_MIME_TO_EXT[file.type] ?? "bin";
  const key = `brand-logos/${ownerId}/${nanoid(12)}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await uploadBytes(key, bytes, file.type);
  return { key };
}

export async function createBrandProfileAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return { ok: false, fieldErrors: formatErrors(parsed.error) };
  }
  const light = await uploadLogoIfPresent(formData, user.id, "logoFile");
  if (light && "error" in light) {
    return { ok: false, fieldErrors: { logo: light.error } };
  }
  const dark = await uploadLogoIfPresent(formData, user.id, "logoFileDark");
  if (dark && "error" in dark) {
    return { ok: false, fieldErrors: { logo: dark.error } };
  }
  await createBrandProfile(user.id, {
    ...parsed.data,
    logoR2Key: light?.key,
    logoR2KeyDark: dark?.key,
  });
  revalidatePath("/brands");
  redirect("/brands");
}

export async function updateBrandProfileAction(
  id: string,
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return { ok: false, fieldErrors: formatErrors(parsed.error) };
  }
  const light = await uploadLogoIfPresent(formData, user.id, "logoFile");
  if (light && "error" in light) {
    return { ok: false, fieldErrors: { logo: light.error } };
  }
  const dark = await uploadLogoIfPresent(formData, user.id, "logoFileDark");
  if (dark && "error" in dark) {
    return { ok: false, fieldErrors: { logo: dark.error } };
  }
  const updated = await updateBrandProfile(id, user.id, {
    ...parsed.data,
    // undefined → preserve existing key on this column; string → set.
    logoR2Key: light ? light.key : undefined,
    logoR2KeyDark: dark ? dark.key : undefined,
  });
  if (!updated) {
    return {
      ok: false,
      fieldErrors: { name: "Brand profile not found or access denied" },
    };
  }
  revalidatePath("/brands");
  revalidatePath(`/brands/${id}`);
  redirect("/brands");
}

export async function deleteBrandProfileAction(id: string): Promise<void> {
  const user = await requireAuth();
  await deleteBrandProfile(id, user.id);
  revalidatePath("/brands");
  redirect("/brands");
}
