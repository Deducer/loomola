export type TrimError = "start_negative" | "end_out_of_bounds" | "start_ge_end";

export type TrimValidationResult =
  | { ok: true }
  | { ok: false; error: TrimError };

const END_TOLERANCE_SEC = 0.5;

/**
 * Validates a trim range against a recording duration. Start must be >= 0,
 * end must be <= duration + 0.5s (tolerance for timestamp imprecision),
 * and start must be strictly less than end.
 */
export function validateTrim(params: {
  startSec: number;
  endSec: number;
  durationSec: number;
}): TrimValidationResult {
  if (params.startSec < 0) return { ok: false, error: "start_negative" };
  if (params.endSec > params.durationSec + END_TOLERANCE_SEC) {
    return { ok: false, error: "end_out_of_bounds" };
  }
  if (params.startSec >= params.endSec) {
    return { ok: false, error: "start_ge_end" };
  }
  return { ok: true };
}
