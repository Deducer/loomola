import { spawn } from "node:child_process";
import { parseFrameRate } from "./frames";

const ffprobePath = process.env.FFPROBE_PATH ?? "ffprobe";

/**
 * Frame rate of the first video stream for frame-accurate review timecodes.
 * r_frame_rate (the stream's base rate) is preferred: for a constant-rate
 * film draft it equals avg_frame_rate, and for variable-rate screen captures
 * it's the capture rate (60) where the average (say 23.4) matches no real
 * frame. MediaRecorder webms report 1000/1 there, which sanitizeFps rejects,
 * so those fall back to the average, then to null.
 */
export function probeFps(url: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=avg_frame_rate,r_frame_rate",
      "-of",
      "json",
      url,
    ];
    const proc = spawn(ffprobePath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.on("error", reject);
    const timer = setTimeout(() => proc.kill("SIGKILL"), 60_000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`ffprobe exited with ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          streams?: Array<{ avg_frame_rate?: string; r_frame_rate?: string }>;
        };
        const stream = parsed.streams?.[0];
        resolve(parseFrameRate(stream?.r_frame_rate) ?? parseFrameRate(stream?.avg_frame_rate));
      } catch (err) {
        reject(err);
      }
    });
  });
}
