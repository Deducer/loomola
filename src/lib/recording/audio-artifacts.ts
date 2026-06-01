export function recordingPrefixFromTrackKey(key: string): string {
  const rawIdx = key.indexOf("/raw/");
  if (rawIdx >= 0) return key.slice(0, rawIdx);
  const slash = key.lastIndexOf("/");
  return slash >= 0 ? key.slice(0, slash) : key;
}

export function mixedAudioKeyForTrack(key: string): string {
  return `${recordingPrefixFromTrackKey(key)}/mixed.m4a`;
}

export function sourceTranscriptAudioKeyForTrack(key: string): string {
  return `${recordingPrefixFromTrackKey(key)}/transcript-channels.m4a`;
}

export function waveformKeyForTrack(key: string): string {
  return `${recordingPrefixFromTrackKey(key)}/waveform.png`;
}
