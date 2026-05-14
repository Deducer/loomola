import { describe, expect, it } from "vitest";
import { parseAttendeeIds } from "@/lib/recordings/queries";

describe("parseAttendeeIds", () => {
  it("keeps only UUID-backed attendee ids", () => {
    expect(
      parseAttendeeIds([
        "3541b953-2b90-4e3f-8594-5b4e54a005c4",
        "Ian",
        "Bhaskar",
        "",
        null,
        { displayName: "Harsha" },
      ])
    ).toEqual(["3541b953-2b90-4e3f-8594-5b4e54a005c4"]);
  });
});
