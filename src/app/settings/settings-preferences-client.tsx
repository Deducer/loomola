"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Bell,
  BookOpen,
  CalendarDays,
  Cloud,
  Database,
  Globe,
  MonitorDot,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import {
  SUMMARY_LANGUAGE_OPTIONS,
  TRANSCRIPTION_LANGUAGE_OPTIONS,
  TRANSCRIPT_RETENTION_OPTIONS,
  type SummaryLanguage,
  type TranscriptionLanguage,
  type UserPreferencesPatch,
} from "@/lib/preferences/user-preferences";
import { cn } from "@/lib/cn";

type PreferencesView = {
  transcriptionLanguage: string;
  summaryLanguage: string;
  transcriptRetentionDays: number | null;
  meetingDetectionEnabled: boolean;
  floatingRecordingIndicatorEnabled: boolean;
  notifyFirstView: boolean;
  notifyComments: boolean;
  notifyMarketing: boolean;
};

type Props = {
  email: string;
  preferences: PreferencesView;
};

const sections = [
  { id: "general", label: "General", icon: MonitorDot },
  { id: "language", label: "Language", icon: BookOpen },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "connectors", label: "Connectors", icon: Cloud },
  { id: "profile", label: "Profile", icon: UserRound },
] as const;

export function SettingsPreferencesClient({ email, preferences }: Props) {
  const [prefs, setPrefs] = useState(preferences);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function patch(next: UserPreferencesPatch) {
    const previous = prefs;
    setPrefs((current) => ({ ...current, ...next }));
    setSavingKey(Object.keys(next)[0] ?? null);

    startTransition(async () => {
      try {
        const res = await fetch("/api/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        if (!res.ok) throw new Error("save_failed");
        const data = (await res.json()) as { preferences: PreferencesView };
        setPrefs({
          transcriptionLanguage: data.preferences.transcriptionLanguage,
          summaryLanguage: data.preferences.summaryLanguage,
          transcriptRetentionDays: data.preferences.transcriptRetentionDays,
          meetingDetectionEnabled: data.preferences.meetingDetectionEnabled,
          floatingRecordingIndicatorEnabled:
            data.preferences.floatingRecordingIndicatorEnabled,
          notifyFirstView: data.preferences.notifyFirstView,
          notifyComments: data.preferences.notifyComments,
          notifyMarketing: data.preferences.notifyMarketing,
        });
      } catch {
        setPrefs(previous);
        toast.error("Could not save that setting.");
      } finally {
        setSavingKey(null);
      }
    });
  }

  const disabled = isPending && savingKey !== null;

  return (
    <main className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[180px_1fr]">
      <aside className="hidden lg:block">
        <nav className="sticky top-24 space-y-1">
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-text-muted transition-colors hover:bg-bg-subtle hover:text-text"
            >
              <section.icon className="h-4 w-4" />
              {section.label}
            </a>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 space-y-10">
        <header className="border-b border-border pb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Settings
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Tune how Loomola records, transcribes, summarizes, and notifies.
          </p>
        </header>

        <SettingsSection id="general" title="General">
          <Row
            title="Theme"
            description="Matches the rest of the web app."
            control={<ThemeToggle />}
          />
          <ToggleRow
            title="Meeting detection"
            description="Watch for Meet, Zoom, Teams, and Webex context in the desktop app."
            checked={prefs.meetingDetectionEnabled}
            disabled={disabled}
            onChange={(checked) => patch({ meetingDetectionEnabled: checked })}
          />
          <ToggleRow
            title="Live recording indicator"
            description="Show the small floating desktop pill while recording audio notes."
            checked={prefs.floatingRecordingIndicatorEnabled}
            disabled={disabled}
            onChange={(checked) =>
              patch({ floatingRecordingIndicatorEnabled: checked })
            }
          />
        </SettingsSection>

        <SettingsSection id="language" title="Language">
          <SelectRow
            title="Transcription language"
            description="Used when new recordings are sent to Deepgram."
            value={prefs.transcriptionLanguage}
            disabled={disabled}
            onChange={(value) =>
              patch({ transcriptionLanguage: value as TranscriptionLanguage })
            }
            options={TRANSCRIPTION_LANGUAGE_OPTIONS}
          />
          <SelectRow
            title="Summary language"
            description="Used for generated titles and notes."
            value={prefs.summaryLanguage}
            disabled={disabled}
            onChange={(value) =>
              patch({ summaryLanguage: value as SummaryLanguage })
            }
            options={SUMMARY_LANGUAGE_OPTIONS}
          />
          <SelectRow
            title="Transcript retention"
            description="Saved as the account policy; cleanup enforcement is next."
            value={String(prefs.transcriptRetentionDays ?? "forever")}
            disabled={disabled}
            onChange={(value) =>
              patch({
                transcriptRetentionDays:
                  value === "forever" ? null : (Number(value) as 30 | 90 | 365),
              })
            }
            options={TRANSCRIPT_RETENTION_OPTIONS.map((option) => ({
              value: option.value === null ? "forever" : String(option.value),
              label: option.label,
            }))}
          />
        </SettingsSection>

        <SettingsSection id="calendar" title="Calendar">
          <ConnectorRow
            title="Google Calendar"
            description="Not connected"
            action="Connect"
            disabled
          />
          <ConnectorRow
            title="Outlook Calendar"
            description="Not connected"
            action="Connect"
            disabled
          />
        </SettingsSection>

        <SettingsSection id="notifications" title="Notifications">
          <ToggleRow
            title="First view emails"
            description="Email when a new visitor opens a shared recording."
            checked={prefs.notifyFirstView}
            disabled={disabled}
            onChange={(checked) => patch({ notifyFirstView: checked })}
          />
          <ToggleRow
            title="Comment emails"
            description="Email when someone comments on a shared recording."
            checked={prefs.notifyComments}
            disabled={disabled}
            onChange={(checked) => patch({ notifyComments: checked })}
          />
          <ToggleRow
            title="Product updates"
            description="Reserved for occasional product notes."
            checked={prefs.notifyMarketing}
            disabled={disabled}
            onChange={(checked) => patch({ notifyMarketing: checked })}
          />
        </SettingsSection>

        <SettingsSection id="connectors" title="Connectors">
          <ConnectorRow
            title="Obsidian"
            description="Desktop sync is configured in the macOS app."
            action="Open desktop"
            disabled
          />
          <ConnectorRow
            title="Chrome bridge"
            description="Installed from the desktop app for meeting detection."
            action="Desktop only"
            disabled
            icon={<Globe className="h-4 w-4" />}
          />
          <ConnectorRow
            title="Granola import"
            description="Bring notes, transcripts, people, and lists into Loomola."
            action="Open"
            href="/settings/migration"
          />
        </SettingsSection>

        <SettingsSection id="profile" title="Profile">
          <Row
            title="Signed in as"
            description={email}
            control={
              <form action="/auth/signout" method="post">
                <Button variant="outline" size="sm" type="submit">
                  Sign out
                </Button>
              </form>
            }
          />
          <ConnectorRow
            title="Workspace"
            description="Single-user workspace"
            action="Team settings"
            disabled
            icon={<Database className="h-4 w-4" />}
          />
        </SettingsSection>
      </div>
    </main>
  );
}

function SettingsSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="mb-3 text-base font-medium text-text">{title}</h2>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-bg-subtle">
        {children}
      </div>
    </section>
  );
}

function Row({
  title,
  description,
  control,
}: {
  title: string;
  description: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-5 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-text">{title}</div>
        <div className="mt-0.5 text-sm text-text-muted">{description}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Row
      title={title}
      description={description}
      control={
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={cn(
            "relative h-6 w-10 rounded-full border transition-colors disabled:opacity-60",
            checked
              ? "border-accent bg-accent"
              : "border-border-strong bg-bg-elevated"
          )}
        >
          <span
            className={cn(
              "absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform",
              checked ? "translate-x-[18px]" : "translate-x-1"
            )}
          />
        </button>
      }
    />
  );
}

function SelectRow({
  title,
  description,
  value,
  disabled,
  options,
  onChange,
}: {
  title: string;
  description: string;
  value: string;
  disabled: boolean;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <Row
      title={title}
      description={description}
      control={
        <Select
          className="w-[190px]"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      }
    />
  );
}

function ConnectorRow({
  title,
  description,
  action,
  href,
  disabled = false,
  icon,
}: {
  title: string;
  description: string;
  action: string;
  href?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  const control = href ? (
    <Link href={href}>
      <Button variant="outline" size="sm">
        {action}
      </Button>
    </Link>
  ) : (
    <Button variant="outline" size="sm" disabled={disabled}>
      {action}
    </Button>
  );

  return (
    <Row
      title={title}
      description={description}
      control={
        <div className="flex items-center gap-2">
          {icon}
          {control}
        </div>
      }
    />
  );
}
