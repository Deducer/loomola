"use server";

import { requireAuth } from "@/lib/require-auth";
import {
  brandProfileInputSchema,
  type BrandProfileInput,
} from "@/lib/validation/brand-profile";
import {
  createBrandProfile,
  updateBrandProfile,
  deleteBrandProfile,
} from "@/db/queries/brand-profiles";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ZodError } from "zod";

type ActionResult =
  | { ok: true }
  | { ok: false; fieldErrors: Partial<Record<keyof BrandProfileInput, string>> };

function parseFormData(formData: FormData) {
  return brandProfileInputSchema.safeParse({
    name: formData.get("name"),
    accentColor: formData.get("accentColor"),
    logoUrl: formData.get("logoUrl") ?? "",
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

export async function createBrandProfileAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return { ok: false, fieldErrors: formatErrors(parsed.error) };
  }
  await createBrandProfile(user.id, parsed.data);
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
  const updated = await updateBrandProfile(id, user.id, parsed.data);
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
