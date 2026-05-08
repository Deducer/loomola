import { z } from "zod";

export const TRANSCRIPTION_LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "hi", label: "Hindi" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
] as const;

export const SUMMARY_LANGUAGE_OPTIONS = [
  { value: "same-as-transcript", label: "Same as transcript" },
  ...TRANSCRIPTION_LANGUAGE_OPTIONS.filter((option) => option.value !== "auto"),
] as const;

export const TRANSCRIPT_RETENTION_OPTIONS = [
  { value: null, label: "Forever" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
] as const;

export const DEFAULT_USER_PREFERENCES = {
  transcriptionLanguage: "en",
  summaryLanguage: "same-as-transcript",
  transcriptRetentionDays: null,
  meetingDetectionEnabled: true,
  floatingRecordingIndicatorEnabled: true,
  notifyFirstView: true,
  notifyComments: true,
  notifyMarketing: false,
} as const;

export const transcriptionLanguageSchema = z.enum(
  TRANSCRIPTION_LANGUAGE_OPTIONS.map((option) => option.value) as [
    TranscriptionLanguage,
    ...TranscriptionLanguage[],
  ]
);
export const summaryLanguageSchema = z.enum(
  SUMMARY_LANGUAGE_OPTIONS.map((option) => option.value) as [
    SummaryLanguage,
    ...SummaryLanguage[],
  ]
);
export const transcriptRetentionDaysSchema = z
  .union([z.literal(30), z.literal(90), z.literal(365), z.null()])
  .optional();

export const userPreferencesPatchSchema = z
  .object({
    transcriptionLanguage: transcriptionLanguageSchema.optional(),
    summaryLanguage: summaryLanguageSchema.optional(),
    transcriptRetentionDays: transcriptRetentionDaysSchema,
    meetingDetectionEnabled: z.boolean().optional(),
    floatingRecordingIndicatorEnabled: z.boolean().optional(),
    notifyFirstView: z.boolean().optional(),
    notifyComments: z.boolean().optional(),
    notifyMarketing: z.boolean().optional(),
  })
  .strict();

export type TranscriptionLanguage =
  (typeof TRANSCRIPTION_LANGUAGE_OPTIONS)[number]["value"];
export type SummaryLanguage = (typeof SUMMARY_LANGUAGE_OPTIONS)[number]["value"];
export type UserPreferencesPatch = z.infer<typeof userPreferencesPatchSchema>;

export function deepgramLanguageOption(
  language: TranscriptionLanguage | string | null | undefined
): string | undefined {
  return language === "auto" ? undefined : language || "en";
}

export function languageLabel(value: string | null | undefined): string {
  return (
    [...SUMMARY_LANGUAGE_OPTIONS, ...TRANSCRIPTION_LANGUAGE_OPTIONS].find(
      (option) => option.value === value
    )?.label ?? "English"
  );
}

export function buildSummaryLanguageInstruction(params: {
  summaryLanguage: SummaryLanguage | string | null | undefined;
  transcriptLanguage?: string | null;
}): string {
  if (!params.summaryLanguage || params.summaryLanguage === "same-as-transcript") {
    return `Output language: match the transcript language${
      params.transcriptLanguage ? ` (${params.transcriptLanguage})` : ""
    }.`;
  }

  return `Output language: ${languageLabel(params.summaryLanguage)}.`;
}
