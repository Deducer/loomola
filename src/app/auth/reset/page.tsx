import { requireAuth } from "@/lib/require-auth";
import { ResetForm } from "./reset-form";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  await requireAuth();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <ResetForm />
    </div>
  );
}
