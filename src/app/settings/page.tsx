import { redirect } from "next/navigation";
import { getUserPreferences } from "@/db/queries/user-preferences";
import { requireAuth } from "@/lib/require-auth";
import { enableGranola } from "@/lib/feature-flags";
import { TopNav } from "@/components/nav/top-nav";
import { SettingsPreferencesClient } from "./settings-preferences-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireAuth();
  const granolaEnabled = enableGranola();
  if (!granolaEnabled) {
    redirect("/");
  }
  const preferences = await getUserPreferences(user.id);

  return (
    <div className="min-h-screen bg-bg">
      <TopNav
        userEmail={user.email ?? ""}
        activePath="settings"
        granolaEnabled={granolaEnabled}
      />
      <SettingsPreferencesClient
        email={user.email ?? ""}
        preferences={{
          transcriptionLanguage: preferences.transcriptionLanguage,
          summaryLanguage: preferences.summaryLanguage,
          transcriptRetentionDays: preferences.transcriptRetentionDays,
          meetingDetectionEnabled: preferences.meetingDetectionEnabled,
          floatingRecordingIndicatorEnabled:
            preferences.floatingRecordingIndicatorEnabled,
          notifyFirstView: preferences.notifyFirstView,
          notifyComments: preferences.notifyComments,
          notifyMarketing: preferences.notifyMarketing,
        }}
      />
    </div>
  );
}
