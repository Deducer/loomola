import { describe, it, expect } from "vitest";
import { acceptSuggestion } from "@/lib/folder-suggestion/classify";

const FOLDER_A = "11111111-1111-1111-1111-111111111111";
const FOLDER_B = "22222222-2222-2222-2222-222222222222";
const candidates = [FOLDER_A, FOLDER_B];

describe("acceptSuggestion (server-side gating)", () => {
  it("accepts a high-confidence match against a candidate folder", () => {
    const r = acceptSuggestion(
      { folderId: FOLDER_A, confidence: "high", reason: "fits the project" },
      candidates
    );
    expect(r).toEqual({ folderId: FOLDER_A });
  });

  it("rejects a medium-confidence match (HIGH-only policy for v1)", () => {
    const r = acceptSuggestion(
      { folderId: FOLDER_A, confidence: "medium", reason: "maybe" },
      candidates
    );
    expect(r).toBeNull();
  });

  it("rejects a low-confidence match", () => {
    const r = acceptSuggestion(
      { folderId: FOLDER_A, confidence: "low", reason: "guess" },
      candidates
    );
    expect(r).toBeNull();
  });

  it("rejects a null folderId regardless of confidence", () => {
    const r = acceptSuggestion(
      { folderId: null, confidence: "high", reason: "no fit" },
      candidates
    );
    expect(r).toBeNull();
  });

  it("rejects a hallucinated folder id (not in candidates)", () => {
    const r = acceptSuggestion(
      {
        folderId: "99999999-9999-9999-9999-999999999999",
        confidence: "high",
        reason: "very confident but invented",
      },
      candidates
    );
    expect(r).toBeNull();
  });

  it("rejects when candidates are empty", () => {
    const r = acceptSuggestion(
      { folderId: FOLDER_A, confidence: "high", reason: "x" },
      []
    );
    expect(r).toBeNull();
  });
});
