# Granola settings and templates parity audit

**Date:** 2026-05-06
**Status:** Recommendation pass, no product code changed
**Source screenshots:** `docs/Granola UI Screenshots/`

## Glossary

- **API**: Application Programming Interface. A controlled way for software or AI tools to access Loomola data.
- **LLM**: Large Language Model. The AI model that turns transcript plus raw notes into polished meeting notes.
- **MCP**: Model Context Protocol. A standard that lets AI tools, such as Claude Desktop or Claude Code, securely query an app's data.
- **EventKit**: Apple's macOS calendar framework. It lets a native Mac app read the user's local calendar after permission is granted.
- **OAuth**: A sign-in/permission flow used by services like Google Calendar, Slack, Notion, and Gmail.

## Screenshot Coverage

The screenshot folder has been renamed in capture order with descriptive filenames. The set covers:

- Preferences: meeting indicator, login launch, meeting window behavior, theme, app icon, sharing defaults, desktop link handling, model-training opt-in, transcript retention, transcription language, summary language, internal jargon.
- Labs: chat enter behavior, call-detection disable toggle, automatic gain compensation, invite heads-up, meeting-chat auto-post, beta enrollment.
- Profile: personal identity, role, LinkedIn, company context, account transfer, CSV export, delete account.
- Calendar: upcoming meeting display in menu bar, no-participant event handling, visible calendars.
- Notifications: scheduled and auto-detected meeting notifications, per-app mute list, sharing notification channels, marketing emails.
- Connectors: Slack, Notion, Zapier, Affinity, Gmail, HubSpot, Salesforce, Attio, Pipedrive, API keys, MCP instructions.
- Workspace/admin: workspace name/logo, discoverability, auto-join, invite links, SSO, directory sync, export permissions, team list, analytics paywall, billing, referrals.
- Feedback: in-app bug/feature form with screenshot/video attachment.
- Templates: note-template library with left category list, "New template", template ownership labels, meeting-context prompt, and reusable section prompts.

## Current Loomola Coverage

Loomola already covers more of the hard Granola architecture than the settings UI suggests:

- Desktop audio capture, meeting detection, one-window note workspace, floating recording indicator, recent rows, folder picker, image attachments, and "Generate notes" are shipped.
- Notes already use the polymorphic backend: `media_objects.type = 'audio' | 'video'`.
- The AI pipeline already stores `ai_outputs.template_id`, but the template is always `"default"` and there is no template library, picker, or prompt routing yet.
- The enhancement prompt is hard-coded in `src/lib/queue/jobs/generate-title-summary.ts`.
- Shared dictionary exists at `/dictionary` and feeds Deepgram keywords, but Preferences has no "internal jargon" affordance.
- People and speaker assignment infrastructure exist at `/people` and in the transcript card.
- Obsidian sync and export endpoints exist. The API exists through `INTEGRATION_API_TOKEN`, but there is no self-serve API key screen and no MCP server yet.
- Desktop Settings currently cover Sources, Permissions, Chrome bridge, Obsidian, Account, and Diagnostics. They do not yet cover Granola-style Preferences, Calendar, Notifications, Language, Retention, or Templates.
- Deepgram transcription language is currently hard-coded to `"en"` in `src/lib/queue/jobs/transcribe.ts`.
- Calendar-aware pre-meeting behavior is not shipped. Meeting-window detection exists, but EventKit-based upcoming meetings, visible calendars, and one-minute reminders do not.
- Multi-folder Phase 1 is shipped. Read-side multi-folder UI, folder colors, and folder icons are still open.

## Priority List

Lower priority number means "do this sooner."

### Priority 0: Note templates

This is the highest-value gap. Templates change the actual quality and shape of the generated notes, not just the settings surface.

Recommended v1:

- Add a template picker to desktop `NoteWorkspaceView` and web `/notes/:id`.
- Seed 8 to 10 first-party templates: General meeting, 1 to 1, Customer discovery, Product demo, Hiring interview, Stand-up, Weekly team meeting, Requirements gathering, Investor/board update, Content summary.
- Store the selected template before generation and copy it onto `ai_outputs.template_id` when "Generate notes" runs.
- Route the AI prompt through the selected template's meeting-context and section instructions.
- Keep v1 simple: no post-meeting automations, no Slack/Gmail actions, no complex editor.

Best data shape:

- Add `note_templates` for editable custom templates.
- Add a selected-template field on the note or media object, because `ai_outputs.template_id` records what was used for an output but does not say what should be used on the next generation.
- Later add `brand_profiles.default_template_id` so a project/folder can suggest the right template by default.

Granola pattern to emulate nearly exactly:

- Modal or sheet with a left template/category list and a right detail pane.
- "Meeting Context" field plus a list of named sections.
- System templates are visible but not directly edited; users duplicate or create their own.

### Priority 1: Preferences/settings parity pass

The current desktop Settings sheet is functional, but it does not yet feel like Granola. This should be an additive redesign, not a rewrite of Loom or the note workspace.

Recommended sections:

- Preferences: launch at login, show floating recording indicator, meeting detection toggle, move Loomola aside during meetings if feasible.
- Appearance: System/Light/Dark. App icon variants are optional and mostly fun; do later.
- Language: transcription language, summary language, and an "Internal jargon" row that opens the existing Dictionary screen.
- Data: transcript retention setting. This matters for privacy and storage hygiene.
- Calendar: visible calendars, include events with no participants, show upcoming meetings in menu bar.
- Notifications: one-minute calendar reminders, auto-detected meeting notifications, muted apps.
- Connectors: Obsidian status, Chrome bridge, API key, MCP status.

Implementation note: settings that affect the server, such as language and retention, need a small user/preferences table. Mac-only behavior, such as launch at login, can live in `UserDefaults` unless the web app also needs to know.

### Priority 1: Calendar-aware meeting flow

Granola's calendar settings point to a bigger product behavior: the app knows what is coming up before the meeting window appears.

Recommended scope:

- Use EventKit first because this is a single-user native Mac app and avoids Google OAuth complexity.
- Show a compact "Coming up" section on desktop home.
- Fire a notification one minute before meetings with a video link.
- Pre-fill note title and attendees from the matched calendar event.
- Respect visible calendars and "show events with no participants."

This will improve speaker suggestion quality because attendees become known before the recording starts.

### Priority 1: Live transcription drawer

This is already specced in `2026-05-06-live-transcription-drawer-design.md` and remains one of the most felt Granola gaps during an active call.

Keep it because it creates two important moments:

- The user can look back at what was just said.
- The user gets visible proof that Loomola is capturing and transcribing correctly.

Settings tie-in: add a live transcription toggle once the drawer ships.

### Priority 2: AI tools connector page

Granola's Connectors page is broad, but Loomola's most useful connector lane is narrower: make the note corpus easy for AI tools to read.

Recommended scope:

- Add API key reveal/rotate UI for the existing `INTEGRATION_API_TOKEN` model, or move to per-user scoped keys if you want a cleaner long-term security story.
- Add an MCP server as the polished version of the existing export endpoints.
- Keep Obsidian prominent because it is already built and fits your workflow.

Defer Slack, Salesforce, HubSpot, Affinity, Attio, Pipedrive, and Pipedrive-style sales tools until a real workflow asks for them.

### Priority 2: Folder polish

This continues the Granola visual language already started in Stage 7 and Stage 8.

Recommended scope:

- Finish multi-folder Phase 2.
- Add folder icon and color fields.
- Show those icons/colors in sidebar, picker, note rows, and dashboard.

### Priority 3: Notifications and feedback

Notifications are worth doing after calendar because they become meaningful when tied to actual upcoming meetings.

Feedback form is low risk and pleasant, but for a solo self-hosted app it can simply create a local markdown issue draft or open GitHub Issues. Do not overbuild it.

## What Not To Emulate Yet

Do not spend time on these until the product's scope changes:

- Billing, plan comparison, referrals, and enterprise paywalls. Loomola is self-hosted and single-user.
- Team invites, workspace discoverability, auto-join, SSO, directory sync, and admin controls. These are multi-tenant features, which the project explicitly keeps out of scope.
- Model-improvement opt-in. Loomola is not using customer data to train shared models. If telemetry is ever added, make it a clear privacy setting then.
- Broad CRM connectors. Nice for Granola's business market, low value for your personal Loomola instance.
- Custom app icons before templates/calendar/live transcript. App icon variants are delightful but not leverage.
- Full Granola clone of account transfer/export admin. Loomola already has export endpoints and local ownership of the database.

## Template Details From The Screenshots

Visible Granola template categories and names:

- My templates: 1 to 1, Customer Discovery, Hiring, Stand-Up, Untitled template, Weekly Team Meeting.
- Commercial: Account Management, Customer Existing, Pipeline Review.
- Leadership: Advisory.
- Fundraising/investor: Investor Current, Investor Prospective, Networking.
- Product: Customer Onboarding, Product Demo, Requirements Gathering, Troubleshooting, User Interview.
- Recruiting: Hiring Advanced.
- Team: All Hands Meeting, Brainstorm, Project Kick-off, Project Sync, Sprint Planning.
- VC: Catch-up investor, Catch-up portfolio company, LP prospective, VC Board Meeting, VC Pitch.
- Other: Consideration research.

The 1 to 1 template structure shown:

- Meeting Context: "I am having a 1:1 meeting with someone in my team..." with emphasis on priorities, progress, challenges, personal feedback, clarity, efficiency, and follow-up.
- Sections: Top of mind, Updates and wins, Challenges and blockers, Mutual feedback, Next Milestone.

Recommended Loomola starter templates:

- Keep the Granola section structure where it is broadly useful.
- Rename and adapt only where Loomola's combined Loom plus Granola product changes the use case, especially Content summary for YouTube/webinar/podcast capture and Product demo for screen-recorded Loom-style work.

## Suggested Next Spec

Create a focused implementation spec for:

`2026-05-06-note-templates-v1-design.md`

Suggested milestones:

1. Template data model and seed library.
2. Prompt builder refactor so templates drive the output.
3. Web note template picker.
4. Desktop note workspace template picker.
5. Tests with one real imported Granola note and one native Loomola recording.

Do not combine templates with the entire settings redesign. Templates are valuable enough to ship independently.

## Implementation Status: codex/granola-parity

Built in this branch:

- Note templates v1: system template library, authenticated template API, web note picker, desktop note picker, and prompt wiring for enhanced meeting notes.
- Settings/preferences v1: `user_preferences` table, authenticated preferences API, web `/settings` page, desktop Settings sheet controls, and persisted notification/language preferences.
- Real behavior wired from preferences:
  - New Deepgram jobs use the selected transcription language, or omit the language when Auto-detect is selected.
  - Generated titles/summaries/enhanced notes include the selected summary-language instruction.
  - First-view and comment emails respect their notification toggles.
  - Desktop meeting detection can be disabled without leaving the watcher running.
  - Desktop floating audio-recording indicator can be disabled and re-enabled.

Explicitly not completed yet:

- Calendar integration and visible calendars.
- Transcript-retention cleanup enforcement. The policy is persisted now; the cleanup job is intentionally left for a follow-up.
- Custom templates. This branch ships a Granola-like system library and per-note selection only.
- Team/workspace/billing/referrals, still intentionally out of scope.
