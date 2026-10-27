import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegMixArgs } from "@/lib/queue/jobs/mix-audio";
import { ACTIVITY_OUTPUT_ARGS, runFfmpegWithActivity } from "@/lib/speaker-profile/track-activity";

// Real-ffmpeg tests for the single-pass mix + activity decode, its hard
// timeout and cancellation. Skipped where ffmpeg isn't installed.
const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
let available = true;
try {
  execFileSync(ffmpeg, ["-version"], { stdio: "ignore" });
} catch {
  available = false;
}

describe.skipIf(!available)("mix_audio activity pipes (real ffmpeg)", () => {
  let dir: string;
  let mic: string;
  let system: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "speaker-activity-"));
    mic = join(dir, "mic.m4a");
    system = join(dir, "system.m4a");
    // Mic: 2 s tone then 2 s silence. System: 2 s silence then 2 s tone.
    execFileSync(ffmpeg, ["-loglevel", "error", "-f", "lavfi", "-i", "sine=f=440:d=2", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-filter_complex", "[1]atrim=0:2[s];[0][s]concat=n=2:v=0:a=1", "-c:a", "aac", "-y", mic]);
    execFileSync(ffmpeg, ["-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-f", "lavfi", "-i", "sine=f=660:d=2", "-filter_complex", "[0]atrim=0:2[s];[s][1]concat=n=2:v=0:a=1", "-c:a", "aac", "-y", system]);
    return () => rmSync(dir, { recursive: true, force: true });
  });

  it("writes the mono mix and both tracks' loudness frames in one ffmpeg pass", async () => {
    const out = join(dir, "mixed.m4a");
    const frames = await runFfmpegWithActivity({
      args: ffmpegMixArgs({ micUrl: mic, systemUrl: system, outputPath: out }),
      timeoutMs: 60_000,
      label: "test mix",
    });
    expect(existsSync(out)).toBe(true);
    expect(frames.mic.length).toBeGreaterThanOrEqual(38);
    expect(frames.system.length).toBeGreaterThanOrEqual(38);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // Tone where expected, silence elsewhere, on each track independently.
    expect(avg(frames.mic.slice(2, 18))).toBeGreaterThan(-30);
    expect(avg(frames.mic.slice(22, 38))).toBeLessThan(-80);
    expect(avg(frames.system.slice(2, 18))).toBeLessThan(-80);
    expect(avg(frames.system.slice(22, 38))).toBeGreaterThan(-30);
  });

  it("kills a decode that exceeds its hard timeout", async () => {
    // -re reads in real time, so a 4 s input can't finish in 300 ms.
    const started = Date.now();
    await expect(
      runFfmpegWithActivity({
        args: ["-loglevel", "error", "-re", "-i", mic, "-re", "-i", system, ...ACTIVITY_OUTPUT_ARGS],
        timeoutMs: 300,
        label: "slow decode",
      })
    ).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("kills a decode when its job is cancelled", async () => {
    const controller = new AbortController();
    const pending = runFfmpegWithActivity({
      args: ["-loglevel", "error", "-re", "-i", mic, "-re", "-i", system, ...ACTIVITY_OUTPUT_ARGS],
      timeoutMs: 60_000,
      signal: controller.signal,
      label: "cancelled decode",
    });
    setTimeout(() => controller.abort(), 200);
    await expect(pending).rejects.toThrow(/aborted/);
  });
});
