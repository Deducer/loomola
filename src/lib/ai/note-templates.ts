export type NoteTemplateSection = {
  title: string;
  prompt: string;
};

export type NoteTemplate = {
  id: string;
  name: string;
  category: string;
  description: string;
  meetingContext: string;
  sections: NoteTemplateSection[];
};

export const DEFAULT_NOTE_TEMPLATE_ID = "general-meeting";

export const SYSTEM_NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: "general-meeting",
    name: "General meeting",
    category: "General",
    description: "A balanced structure for most calls and working sessions.",
    meetingContext:
      "Capture the meeting in a concise, useful format. Preserve concrete decisions, context, risks, and follow-up work.",
    sections: [
      { title: "Summary", prompt: "What happened, why it mattered, and the overall outcome." },
      { title: "Key points", prompt: "The most important discussion points, grouped by theme." },
      { title: "Decisions", prompt: "Decisions that were actually made, including tradeoffs where clear." },
      { title: "Action items", prompt: "Who owns what next, with dates or dependencies when stated." },
    ],
  },
  {
    id: "one-to-one",
    name: "1 to 1",
    category: "Management",
    description: "Priorities, progress, blockers, feedback, and next steps.",
    meetingContext:
      "This is a 1:1 meeting. Focus on immediate priorities, progress, challenges, personal feedback, and clear follow-up.",
    sections: [
      { title: "Top of mind", prompt: "The most pressing issues, priorities, or concerns raised." },
      { title: "Updates and wins", prompt: "Recent progress, achievements, and momentum." },
      { title: "Challenges and blockers", prompt: "Obstacles, unresolved questions, or support needed." },
      { title: "Mutual feedback", prompt: "Feedback given in either direction, including team or process feedback." },
      { title: "Next milestone", prompt: "Clear next steps and accountability." },
    ],
  },
  {
    id: "customer-discovery",
    name: "Customer discovery",
    category: "Commercial",
    description: "Pain, workflow, buying context, objections, and follow-up.",
    meetingContext:
      "This is a customer discovery call. Extract the customer's real workflow, pain, priorities, objections, language, and buying context.",
    sections: [
      { title: "Customer context", prompt: "Who they are, their role, company context, and current workflow." },
      { title: "Pain and urgency", prompt: "Problems, stakes, frequency, and why this matters now." },
      { title: "Current process", prompt: "Tools, workarounds, owners, handoffs, and gaps." },
      { title: "Decision criteria", prompt: "What would make a solution compelling or unacceptable." },
      { title: "Follow-up", prompt: "Next steps, promised materials, and open questions." },
    ],
  },
  {
    id: "product-demo",
    name: "Product demo",
    category: "Commercial",
    description: "Demo flow, reactions, questions, objections, and next steps.",
    meetingContext:
      "This is a product demo or walkthrough. Capture what was shown, how people reacted, questions asked, objections, and follow-up work.",
    sections: [
      { title: "Demo flow", prompt: "Features, screens, or workflows shown in order." },
      { title: "Reactions", prompt: "Positive signals, confusion, friction, and moments of interest." },
      { title: "Questions and objections", prompt: "Questions asked, concerns raised, and how they were answered." },
      { title: "Opportunities", prompt: "Use cases, expansion ideas, or product feedback revealed." },
      { title: "Next steps", prompt: "Follow-ups, owners, and timing." },
    ],
  },
  {
    id: "hiring-interview",
    name: "Hiring interview",
    category: "Recruiting",
    description: "Candidate signal, strengths, concerns, and recommendation.",
    meetingContext:
      "This is a hiring interview. Capture evidence-backed signal, not generic impressions. Separate what the candidate said from the interviewer's assessment.",
    sections: [
      { title: "Candidate snapshot", prompt: "Role fit, background, motivations, and relevant experience." },
      { title: "Strengths", prompt: "Concrete strengths with supporting evidence from the conversation." },
      { title: "Concerns", prompt: "Risks, gaps, unclear areas, and follow-up probes." },
      { title: "Notable answers", prompt: "Specific answers, stories, or examples worth remembering." },
      { title: "Recommendation", prompt: "Suggested next step and rationale, only if supported." },
    ],
  },
  {
    id: "stand-up",
    name: "Stand-up",
    category: "Team",
    description: "Progress, blockers, priorities, and ownership.",
    meetingContext:
      "This is a team stand-up. Keep the notes brief and operational. Focus on progress, blockers, priorities, and ownership.",
    sections: [
      { title: "Progress", prompt: "What moved forward since the last check-in." },
      { title: "Today", prompt: "Current priorities and intended work." },
      { title: "Blockers", prompt: "Anything slowing people down or needing escalation." },
      { title: "Follow-up", prompt: "Decisions, owners, and next actions." },
    ],
  },
  {
    id: "weekly-team-meeting",
    name: "Weekly team meeting",
    category: "Team",
    description: "Updates, decisions, blockers, metrics, and next priorities.",
    meetingContext:
      "This is a recurring team meeting. Capture weekly progress, decisions, blockers, metrics, and what the team should focus on next.",
    sections: [
      { title: "Highlights", prompt: "Important wins, updates, and changes since the last meeting." },
      { title: "Metrics and signals", prompt: "Numbers, customer signals, risks, or trend changes discussed." },
      { title: "Decisions", prompt: "Decisions made and the reasoning behind them." },
      { title: "Risks and blockers", prompt: "Problems that need attention or escalation." },
      { title: "Next week", prompt: "Priorities, owners, and follow-up work." },
    ],
  },
  {
    id: "requirements-gathering",
    name: "Requirements gathering",
    category: "Product",
    description: "Problem, users, constraints, scope, and acceptance criteria.",
    meetingContext:
      "This is a requirements gathering session. Turn the conversation into practical product requirements without inventing scope.",
    sections: [
      { title: "Problem", prompt: "The user or business problem being solved." },
      { title: "Users and jobs", prompt: "Who this is for and what they need to accomplish." },
      { title: "Requirements", prompt: "Functional requirements stated or clearly implied by the conversation." },
      { title: "Constraints", prompt: "Technical, operational, timing, privacy, or design constraints." },
      { title: "Open questions", prompt: "Unknowns that need follow-up before implementation." },
    ],
  },
  {
    id: "investor-board-update",
    name: "Investor or board update",
    category: "Leadership",
    description: "Narrative, metrics, risks, asks, and decisions.",
    meetingContext:
      "This is an investor, advisor, or board-style update. Capture the narrative, metrics, strategic questions, risks, asks, and decisions.",
    sections: [
      { title: "Executive summary", prompt: "The concise board-level story of the meeting." },
      { title: "Metrics and traction", prompt: "Numbers, milestones, customer proof, and trend changes." },
      { title: "Strategic discussion", prompt: "Key strategic topics, tradeoffs, and advice." },
      { title: "Risks and concerns", prompt: "Concerns raised and how they were addressed." },
      { title: "Asks and next steps", prompt: "Requests, commitments, owners, and timing." },
    ],
  },
  {
    id: "content-summary",
    name: "Content summary",
    category: "Research",
    description: "For webinars, podcasts, videos, or long-form content capture.",
    meetingContext:
      "This recording is likely a webinar, podcast, lecture, interview, or other content rather than a live meeting. Summarize the material as durable research notes.",
    sections: [
      { title: "Core ideas", prompt: "The central arguments, concepts, or claims." },
      { title: "Useful details", prompt: "Examples, methods, frameworks, or evidence worth retaining." },
      { title: "Implications", prompt: "What this means for the user's work, decisions, or research." },
      { title: "Quotes and memorable phrasing", prompt: "Short, important phrasing only when present in the notes or transcript." },
      { title: "Follow-up", prompt: "Questions to investigate, ideas to try, or references to find." },
    ],
  },
  {
    id: "living-flow-next-level-group-call",
    name: "Living Flow Next Level group call",
    category: "Spiritual practice",
    description: "Weekly meditation group with teaching, group Q&A, and integration.",
    meetingContext:
      "This is a Living Flow Next Level weekly meditation and spiritual group call. The call usually includes an opening meditation, a teaching from Javier, group questions and answers, and a closing meditation. Capture the lived teaching, practical guidance, questions, practices, and integration themes. Respect the spiritual language used in the call, but do not invent mystical claims or summarize silent meditation periods unless guidance was spoken.",
    sections: [
      { title: "Session arc", prompt: "The overall flow of the call, including meditation, teaching, Q&A, and closing integration when present." },
      { title: "Opening meditation", prompt: "Guidance, themes, instructions, or experiential cues from the opening meditation; omit silent portions with no spoken content." },
      { title: "Javier's teaching", prompt: "Core teaching, stories, distinctions, metaphors, practices, and spiritual principles Javier emphasized." },
      { title: "Group Q&A", prompt: "Questions from participants and Javier's answers, grouped by topic or person when names are clear." },
      { title: "Practices and invitations", prompt: "Exercises, contemplations, homework, ways of practicing during the week, and concrete integration guidance." },
      { title: "Closing meditation and takeaways", prompt: "Closing practice guidance, final reminders, and the most important takeaways to carry forward." },
    ],
  },
  {
    id: "project-win-weekly-sync",
    name: "Project Win weekly sync",
    category: "Project Win",
    description: "Ian and Abb's weekly founder sync for Project Win LLC.",
    meetingContext:
      "This is the weekly Project Win LLC founder sync between Ian Cross and Abb Kapoor. Default speaker mapping: Ian is the user, self, microphone, or Me channel; Abb is the remote call audio, Them, or Call audio channel. Use Ian and Abb by name when attributing viewpoints, task ownership, decisions, and uncertainty. Turn the call into an operating record for the Project Win OS: capture founder context, key topics, actual decisions, singular-owner action items, new or updated venture ideas, open questions, and parking-lot items. Be generous about ideas, strict about decisions, and never invent owners, due dates, or commitments.",
    sections: [
      { title: "Summary", prompt: "A concise operating summary of what happened, what changed, and what matters before the next sync." },
      { title: "Founder context", prompt: "Personal, professional, capacity, or relationship context that materially affects Project Win execution." },
      { title: "Key topics", prompt: "Main discussion threads, grouped by project, venture, operating-system topic, or strategic question." },
      { title: "Decisions made", prompt: "Only actual agreements or explicit commitments, with rationale and who the decision belongs to when clear." },
      { title: "Action items", prompt: "Specific next actions with a single owner, due dates or dependencies when stated, and unclear fields marked rather than invented." },
      { title: "Ideas and opportunities", prompt: "New venture ideas, product angles, distribution plays, validation paths, or updates to existing Project Win ideas." },
      { title: "Open questions and parking lot", prompt: "Unresolved questions, deferred topics, risks, and items to revisit in a future sync." },
    ],
  },
];

const TEMPLATE_BY_ID = new Map(
  SYSTEM_NOTE_TEMPLATES.map((template) => [template.id, template])
);

export function getNoteTemplate(templateId: string | null | undefined): NoteTemplate {
  return (
    TEMPLATE_BY_ID.get(templateId ?? "") ??
    TEMPLATE_BY_ID.get(DEFAULT_NOTE_TEMPLATE_ID)!
  );
}

export function isSystemNoteTemplateId(value: string): boolean {
  return TEMPLATE_BY_ID.has(value);
}

export function listNoteTemplates(): NoteTemplate[] {
  return SYSTEM_NOTE_TEMPLATES;
}

export function buildTemplateInstruction(template: NoteTemplate): string {
  const sections = template.sections
    .map((section) => `- ${section.title}: ${section.prompt}`)
    .join("\n");

  return [
    `Template: ${template.name}`,
    `Meeting context: ${template.meetingContext}`,
    "",
    "Preferred sections:",
    sections,
    "",
    "Use these sections as a target shape. Omit a section when the notes and transcript do not support it. Add a better heading when the meeting clearly needs one.",
  ].join("\n");
}
