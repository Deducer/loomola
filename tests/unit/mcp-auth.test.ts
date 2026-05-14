import { describe, expect, it } from "vitest";
import { isLoopbackRequest, verifyMcpRequest } from "@/app/api/mcp/auth";

function request(headers: Record<string, string> = {}, url = "http://localhost:3000/api/mcp") {
  return new Request(url, { headers });
}

describe("MCP auth", () => {
  it("accepts a valid bearer token from loopback", () => {
    const result = verifyMcpRequest(
      request({ authorization: "Bearer secret", host: "127.0.0.1:3000" }),
      { MCP_TOKEN: "secret" }
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects a missing authorization header", () => {
    const result = verifyMcpRequest(request({ host: "localhost:3000" }), {
      MCP_TOKEN: "secret",
    });
    expect(result).toEqual({ ok: false, status: 401 });
  });

  it("rejects a wrong token", () => {
    const result = verifyMcpRequest(
      request({ authorization: "Bearer nope", host: "localhost:3000" }),
      { MCP_TOKEN: "secret" }
    );
    expect(result).toEqual({ ok: false, status: 401 });
  });

  it("rejects when MCP_TOKEN is unset", () => {
    const result = verifyMcpRequest(
      request({ authorization: "Bearer secret", host: "localhost:3000" }),
      {}
    );
    expect(result).toEqual({ ok: false, status: 401 });
  });

  it("rejects non-loopback hosts unless explicitly allowed", () => {
    const blocked = verifyMcpRequest(
      request({ authorization: "Bearer secret", host: "loom.dissonance.cloud" }),
      { MCP_TOKEN: "secret" }
    );
    expect(blocked).toEqual({ ok: false, status: 403 });

    const allowed = verifyMcpRequest(
      request({ authorization: "Bearer secret", host: "loom.dissonance.cloud" }),
      { MCP_TOKEN: "secret", MCP_ALLOW_PUBLIC: "true" }
    );
    expect(allowed).toEqual({ ok: true });
  });

  it("recognizes IPv6 loopback", () => {
    expect(isLoopbackRequest(request({ host: "[::1]:3000" }))).toBe(true);
  });
});
