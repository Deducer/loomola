/**
 * Mic / system-audio loudness frames — the capture evidence behind "Me"
 * detection (speaker recognition v2). One int8 dB value per 100 ms per
 * track, ~72 KB per hour for both tracks, stored next to mixed.m4a as
 * activity.bin so profiles never have to decode audio again.
 *
 * Layout (little-endian):
 *   0..3   magic "LACT"
 *   4      format version (1)
 *   5..6   frame length in ms (uint16)
 *   7..10  mic frame count (uint32)
 *   11..14 system frame count (uint32)
 *   15..   mic frames (int8 dB), then system frames (int8 dB)
 *
 * Track lengths are kept independent on purpose: a mic that died
 * mid-call yields fewer mic frames, and that truncation is evidence.
 */

export const ACTIVITY_FRAME_MS = 100;
export const SILENCE_DB = -120;

export type ActivityFrames = {
  frameMs: number;
  mic: number[];
  system: number[];
};

const MAGIC = "LACT";
const HEADER_BYTES = 15;

function clampDb(db: number): number {
  if (!Number.isFinite(db)) return SILENCE_DB;
  return Math.max(SILENCE_DB, Math.min(0, Math.round(db)));
}

export function encodeActivity(frames: ActivityFrames): Buffer {
  const buf = Buffer.alloc(HEADER_BYTES + frames.mic.length + frames.system.length);
  buf.write(MAGIC, 0, "ascii");
  buf.writeUInt8(1, 4);
  buf.writeUInt16LE(frames.frameMs, 5);
  buf.writeUInt32LE(frames.mic.length, 7);
  buf.writeUInt32LE(frames.system.length, 11);
  let offset = HEADER_BYTES;
  for (const v of frames.mic) buf.writeInt8(clampDb(v), offset++);
  for (const v of frames.system) buf.writeInt8(clampDb(v), offset++);
  return buf;
}

export function decodeActivity(buf: Uint8Array): ActivityFrames | null {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length < HEADER_BYTES || b.toString("ascii", 0, 4) !== MAGIC) return null;
  if (b.readUInt8(4) !== 1) return null;
  const frameMs = b.readUInt16LE(5);
  const micCount = b.readUInt32LE(7);
  const systemCount = b.readUInt32LE(11);
  if (b.length !== HEADER_BYTES + micCount + systemCount) return null;
  const mic: number[] = new Array(micCount);
  const system: number[] = new Array(systemCount);
  let offset = HEADER_BYTES;
  for (let i = 0; i < micCount; i++) mic[i] = b.readInt8(offset++);
  for (let i = 0; i < systemCount; i++) system[i] = b.readInt8(offset++);
  return { frameMs, mic, system };
}

/**
 * Streaming RMS → dB framer over 16-bit little-endian mono PCM (what
 * `ffmpeg -ac 1 -f s16le` emits). Chunks may split a sample; the odd
 * byte is carried into the next push.
 */
export class PcmFrameAccumulator {
  private readonly samplesPerFrame: number;
  private carry: Buffer = Buffer.alloc(0);
  private sumSquares = 0;
  private count = 0;
  readonly frames: number[] = [];

  constructor(sampleRate: number, frameMs: number = ACTIVITY_FRAME_MS) {
    this.samplesPerFrame = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  }

  push(chunk: Uint8Array): void {
    const incoming = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const buf = this.carry.length > 0 ? Buffer.concat([this.carry, incoming]) : incoming;
    const usable = buf.length - (buf.length % 2);
    for (let i = 0; i < usable; i += 2) {
      const v = buf.readInt16LE(i) / 32768;
      this.sumSquares += v * v;
      this.count++;
      if (this.count === this.samplesPerFrame) this.flushFrame();
    }
    this.carry = Buffer.from(buf.subarray(usable));
  }

  /** Emits the trailing partial frame (if any) and returns all frames. */
  finish(): number[] {
    if (this.count > 0) this.flushFrame();
    return this.frames;
  }

  private flushFrame() {
    const meanSquare = this.sumSquares / this.count;
    this.frames.push(clampDb(10 * Math.log10(meanSquare + 1e-12)));
    this.sumSquares = 0;
    this.count = 0;
  }
}
