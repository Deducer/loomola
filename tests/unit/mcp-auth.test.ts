import { describe, expect, it } from "vitest";
import {
  isLoopbackRequest,
  isTailnetSourceRequest,
  isTrustedNetworkRequest,
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
          "x-forwarded-for": "100.96.0.1",
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
          "x-real-ip": "100.100.0.1",
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

  describe("trusted-proxy-hop gate (Coolify/Docker NAT shape)", () => {
    it("trusts a private/RFC1918 last hop (real prod shape after Docker NAT)", () => {
      // Docker MASQUERADEs every inbound client to the bridge gateway
      // before Traefik sees it, so the container receives a private IP.
      expect(isTrustedNetworkRequest(request({ "x-forwarded-for": "10.0.1.1" }))).toBe(true);
      expect(isTrustedNetworkRequest(request({ "x-forwarded-for": "172.18.0.5" }))).toBe(true);
    });

    it("still trusts genuine tailnet IPs (v4 and v6) for the upgrade path", () => {
      expect(isTrustedNetworkRequest(request({ "x-forwarded-for": "100.94.207.47" }))).toBe(true);
      expect(
        isTrustedNetworkRequest(request({ "x-forwarded-for": "fd7a:115c:a1e0::a537:cf2f" }))
      ).toBe(true);
    });

    it("falls back to X-Real-IP", () => {
      expect(isTrustedNetworkRequest(request({ "x-real-ip": "10.0.1.1" }))).toBe(true);
    });

    it("fails closed on a public last hop", () => {
      expect(isTrustedNetworkRequest(request({ "x-forwarded-for": "203.0.113.7" }))).toBe(false);
    });

    it("ignores an attacker-controllable leftmost entry, reads the last hop", () => {
      expect(
        isTrustedNetworkRequest(request({ "x-forwarded-for": "10.0.1.1, 203.0.113.7" }))
      ).toBe(false);
    });

    it("accepts the real prod request end-to-end (private hop + valid token)", () => {
      expect(
        verifyMcpRequest(
          request({
            authorization: "Bearer secret",
            host: "loom.dissonance.cloud",
            "x-forwarded-for": "10.0.1.1",
          }),
          { MCP_TOKEN: "secret" }
        )
      ).toEqual({ ok: true });
    });

    it("returns 401 for the prod shape with a bad token", () => {
      expect(
        verifyMcpRequest(
          request({
            authorization: "Bearer nope",
            host: "loom.dissonance.cloud",
            "x-forwarded-for": "10.0.1.1",
          }),
          { MCP_TOKEN: "secret" }
        )
      ).toEqual({ ok: false, status: 401 });
    });

    it("still 403s a public last hop even with a valid token", () => {
      expect(
        verifyMcpRequest(
          request({
            authorization: "Bearer secret",
            host: "loom.dissonance.cloud",
            "x-forwarded-for": "203.0.113.7",
          }),
          { MCP_TOKEN: "secret" }
        )
      ).toEqual({ ok: false, status: 403 });
    });
  });
});
