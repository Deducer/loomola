/**
 * Read a local video file's duration in the browser without uploading it.
 *
 * Uses a detached <video> with preload="metadata". MediaRecorder-produced
 * WebM files often report Infinity because the container has no duration
 * header; for those we seek to the end once, which makes Chrome scan the
 * cues and emit `durationchange` with the real value.
 *
 * Returns null when the browser cannot decode the file (unsupported codec,
 * corrupt file). Callers decide whether to proceed.
 */
export function readVideoDuration(
  file: Blob,
  timeoutMs = 20_000
): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    let settled = false;
    let seekedForDuration = false;

    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    const check = () => {
      const d = video.duration;
      if (Number.isFinite(d) && d > 0) {
        finish(d);
        return;
      }
      if (!seekedForDuration && d === Infinity) {
        seekedForDuration = true;
        // Chrome's documented trick for WebM without a duration element.
        video.currentTime = Number.MAX_SAFE_INTEGER;
      }
    };

    video.addEventListener("loadedmetadata", check);
    video.addEventListener("durationchange", check);
    video.addEventListener("error", () => finish(null));
    video.src = url;
  });
}
