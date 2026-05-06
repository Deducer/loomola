// Mirror of src/lib/import/granola/schema.ts (server-side Zod). The
// CLI builds a value of this shape per Granola note and POSTs to
// /api/import/granola/note. Server-side Zod validates again — these
// definitions exist purely so the TS compiler keeps the CLI honest
// about field names + types.

export type GranolaSegment = {
  granolaPersonId: string | null;
  text: string;
  startMs: number;
  endMs: number;
};

export type GranolaAttendee = {
  granolaPersonId: string;
  name: string;
  email: string | null;
  isSelf: boolean;
};

export type GranolaList = {
  granolaListId: string;
  name: string;
};

export type GranolaTranscript = {
  segments: GranolaSegment[];
  fullText: string;
};

export type GranolaNoteImportPayload = {
  granolaId: string;
  title: string;
  createdAt: string;
  durationSeconds: number | null;
  notesBody: string;
  aiSummary: string;
  meetingUrl: string | null;
  attendees: GranolaAttendee[];
  lists: GranolaList[];
  transcript: GranolaTranscript | null;
};

export type GranolaNoteImportResult = {
  mediaObjectId: string;
  action: "created" | "updated" | "unchanged";
  warnings: string[];
};
