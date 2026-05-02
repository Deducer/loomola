import { describe, expect, it } from "vitest";
import { createZip } from "@/lib/export/zip";

describe("zip export writer", () => {
  it("creates a valid zip with utf-8 entry names", () => {
    const zip = createZip([
      { path: "audio/hello.md", data: "# Hello\n" },
      { path: "video/cafe-☕.md", data: "Coffee\n" },
    ]);

    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zipEntryNames(zip)).toEqual(["audio/hello.md", "video/cafe-☕.md"]);
  });
});

function zipEntryNames(zip: Uint8Array): string[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocdOffset = -1;
  for (let index = zip.byteLength - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocdOffset = index;
      break;
    }
  }
  expect(eocdOffset).toBeGreaterThanOrEqual(0);

  const count = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder();
  const names: string[] = [];

  for (let index = 0; index < count; index += 1) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    names.push(decoder.decode(zip.slice(offset + 46, offset + 46 + nameLength)));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return names;
}
