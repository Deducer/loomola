import { describe, expect, it } from "vitest";
import {
  isLoopbackRequest,
  isTailnetSourceRequest,
  verifyMcpRequest,
} from "@/app/api/mcp/auth";

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

  describe("tailnet source detection", () => {
    it("accepts request whose X-Forwarded-For ends in a tailnet IP", () => {
      const result = verifyMcpRequest(
        request({
          authorization: "Bearer secret",
          host: "loom.dissonance.cloud",
          "x-forwarded-for": "100.94.207.47",
        }),
        { MCP_TOKEN: "secret" }
      );
      expect(result).toEqual({ ok: true });
    });

    it("accepts when only X-Real-IP carries the tailnet source", () => {
      const result = verifyMcpRequest(
        request({
          authorization: "Bearer secret",
          host: "loom.dissonance.cloud",
          "x-real-ip": "100.116.165.9",
        }),
        { MCP_TOKEN: "secret" }
      );
      expect(result).toEqual({ ok: true });
    });

    it("ignores a forged tailnet IP earlier in the XFF chain", () => {
      // Attacker tries to spoof X-Forwarded-For. Traefik appends the
      // real public source, so the LAST entry is what we read.
      const blocked = verifyMcpRequest(
        request({
          authorization: "Bearer secret",
          host: "loom.dissonance.cloud",
          "x-forwarded-for": "100.64.0.1, 203.0.113.42",
        }),
        { MCP_TOKEN: "secret" }
      );
      expect(blocked).toEqual({ ok: false, status: 403 });
    });

    it("recognizes the full tailnet CGNAT range edges", () => {
      expect(
        isTailnetSourceRequest(
          request({ "x-forwarded-for": "100.64.0.0" })
        )
      ).toBe(true);
      expect(
        isTailnetSourceRequest(
          request({ "x-forwarded-for": "100.127.255.255" })
        )
      ).toBe(true);
      expect(
        isTailnetSourceRequest(
          request({ "x-forwarded-for": "100.63.255.255" })
        )
      ).toBe(false);
      expect(
        isTailnetSourceRequest(
          request({ "x-forwarded-for": "100.128.0.0" })
        )
      ).toBe(false);
    });

    it("does not match non-tailnet 100.x addresses or other ranges", () => {
      expect(
        isTailnetSourceRequest(
          request({ "x-forwarded-for": "100.0.0.1" })
        )
      ).toBe(false);
      expect(
        isTailnetSourceRequest(
          request({ "x-forwarded-for": "192.168.1.1" })
        )
      ).toBe(false);
      expect(
        isTailnetSourceRequest(
          request({ "x-forwarded-for": "203.0.113.42" })
        )
      ).toBe(false);
    });

    it("returns false when no X-Forwarded-For or X-Real-IP present", () => {
      expect(isTailnetSourceRequest(request({}))).toBe(false);
    });
  });
});
