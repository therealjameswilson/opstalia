import { describe, expect, it } from "vitest";
import {
  readBoundedJsonResponse,
  readBoundedUtf8Body
} from "../../worker/src/adapters/http";

describe("bounded Worker body readers", () => {
  it("parses a bounded JSON response and rejects oversized streamed content", async () => {
    await expect(
      readBoundedJsonResponse(
        new Response('{"ok":true}', {
          headers: { "Content-Type": "application/json" }
        }),
        "Fixture API",
        100
      )
    ).resolves.toEqual({ ok: true });

    await expect(
      readBoundedUtf8Body(
        new Response("x".repeat(101)).body,
        100,
        "Fixture body"
      )
    ).rejects.toThrow(/100-byte limit/);
  });

  it("rejects non-JSON and declared oversized API responses before parsing", async () => {
    await expect(
      readBoundedJsonResponse(
        new Response("plain text", {
          headers: { "Content-Type": "text/plain" }
        }),
        "Fixture API",
        100
      )
    ).rejects.toThrow(/did not return JSON/);

    await expect(
      readBoundedJsonResponse(
        new Response("{}", {
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "101"
          }
        }),
        "Fixture API",
        100
      )
    ).rejects.toThrow(/exceeds/);
  });
});
