import { describe, expect, it, vi } from "vitest";
import { apiError, withApiErrorHandling } from "@/lib/api/error";

describe("apiError", () => {
  it("returns the standard shape", async () => {
    const res = apiError(404, "not_found", "Recording not found");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "not_found",
      message: "Recording not found",
    });
  });
});

describe("withApiErrorHandling", () => {
  const req = new Request("http://localhost/api/test");

  it("passes successful responses through untouched", async () => {
    const handler = withApiErrorHandling(async () => Response.json({ ok: true }));
    const res = await handler(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("converts thrown errors to a generic 500 without leaking internals", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withApiErrorHandling(async () => {
      throw new Error("postgres password is hunter2");
    });
    const res = await handler(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(spy).toHaveBeenCalled(); // ...but it IS logged server-side
    spy.mockRestore();
  });

  it("rethrows Next.js control-flow errors (redirect from requireAuth)", async () => {
    const redirectErr = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    const handler = withApiErrorHandling(async () => {
      throw redirectErr;
    });
    await expect(handler(req, { params: Promise.resolve({}) })).rejects.toBe(
      redirectErr
    );
  });
});
