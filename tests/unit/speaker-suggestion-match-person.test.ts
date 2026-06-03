import { describe, it, expect } from "vitest";
import { matchPerson } from "@/lib/speaker-suggestion/match-person";

const PEOPLE = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    displayName: "Sarah Chen",
    email: "sarah@example.com",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    displayName: "Alex Park",
    email: "alex@example.com",
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    displayName: "Jordan Wright",
    email: null,
  },
];

describe("matchPerson", () => {
  it("returns high confidence on exact person id match", () => {
    const r = matchPerson({
      candidates: PEOPLE,
      attendee: {
        personId: PEOPLE[1].id,
        displayName: null,
        email: null,
      },
    });
    expect(r.confidence).toBe("high");
    expect(r.personId).toBe(PEOPLE[1].id);
    expect(r.reason).toBe("person_id_exact");
  });

  it("returns high confidence on exact lowercased email match", () => {
    const r = matchPerson({
      candidates: PEOPLE,
      attendee: { displayName: null, email: "sarah@example.com" },
    });
    expect(r.confidence).toBe("high");
    expect(r.personId).toBe(PEOPLE[0].id);
  });

  it("normalizes email case for matching", () => {
    const r = matchPerson({
      candidates: PEOPLE,
      attendee: { displayName: null, email: "Sarah@Example.COM" },
    });
    expect(r.confidence).toBe("high");
  });

  it("returns medium confidence on full token-set name match", () => {
    const r = matchPerson({
      candidates: PEOPLE,
      attendee: { displayName: "Sarah Chen", email: null },
    });
    expect(r.confidence).toBe("medium");
    expect(r.personId).toBe(PEOPLE[0].id);
  });

  it("returns medium when token order differs", () => {
    const r = matchPerson({
      candidates: PEOPLE,
      attendee: { displayName: "Chen, Sarah", email: null },
    });
    expect(r.confidence).toBe("medium");
    expect(r.personId).toBe(PEOPLE[0].id);
  });

  it("rejects partial single-token match without email", () => {
    // Just "Sarah" alone is too thin (could be someone else)
    const r = matchPerson({
      candidates: PEOPLE,
      attendee: { displayName: "Sarah", email: null },
    });
    expect(r.confidence).toBe("none");
  });

  it("returns none when no candidates match", () => {
    const r = matchPerson({
      candidates: PEOPLE,
      attendee: { displayName: "Marcus Bell", email: "marcus@example.com" },
    });
    expect(r.confidence).toBe("none");
    expect(r.personId).toBeNull();
  });

  it("returns none when candidates is empty", () => {
    const r = matchPerson({
      candidates: [],
      attendee: { displayName: "Sarah Chen", email: "sarah@example.com" },
    });
    expect(r.confidence).toBe("none");
  });

  it("prefers email match over name match when both are possible", () => {
    const candidates = [
      { id: "name-match", displayName: "Sarah Chen", email: "different@x.com" },
      {
        id: "email-match",
        displayName: "Different Person",
        email: "sarah@example.com",
      },
    ];
    const r = matchPerson({
      candidates,
      attendee: {
        displayName: "Sarah Chen",
        email: "sarah@example.com",
      },
    });
    expect(r.personId).toBe("email-match");
    expect(r.confidence).toBe("high");
  });

  it("matches a person whose row has no email via name match", () => {
    const r = matchPerson({
      candidates: PEOPLE,
      attendee: { displayName: "Jordan Wright", email: "jordan@y.com" },
    });
    expect(r.personId).toBe(PEOPLE[2].id);
    expect(r.confidence).toBe("medium");
  });
});
