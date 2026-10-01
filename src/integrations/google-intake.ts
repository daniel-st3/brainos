import { driveToken } from "./media";
/** Opt-in read-only newsletter intake. It does not alter the pilot source registry. */
export async function listNewsletterMessages(labelId: string) {
  if (process.env.GMAIL_INTAKE_ENABLED !== "true")
    throw new Error("Gmail intake is disabled during the pilot.");
  if (!/^Label_[a-zA-Z0-9_-]+$/.test(labelId))
    throw new Error("Select a dedicated Gmail source label.");
  const token = await driveToken();
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=${encodeURIComponent(labelId)}&maxResults=20`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Gmail read failed (${response.status}); gmail.readonly runtime consent is required.`,
    );
  return {
    discovery_only: true,
    primary_evidence: false,
    data: await response.json(),
  };
}
export interface RecordingCalendarAdapter {
  prepareBlock(input: {
    title: string;
    startsAt: string;
    endsAt: string;
    timezone: "America/Bogota";
    draftIds: string[];
  }): Promise<{ calendarId: string; eventId: string }>;
}
