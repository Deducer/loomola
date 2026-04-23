/**
 * Mixes one or two MediaStreams into a single audio-only MediaStream via
 * Web Audio's MediaStreamAudioSourceNode + MediaStreamAudioDestinationNode.
 * Returns the mixed stream plus a disposer to tear down the AudioContext.
 */
export function createAudioMixer(inputs: (MediaStream | null)[]): {
  output: MediaStream;
  dispose: () => void;
} {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();

  const sources: MediaStreamAudioSourceNode[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (input.getAudioTracks().length === 0) continue;
    const source = ctx.createMediaStreamSource(input);
    source.connect(dest);
    sources.push(source);
  }

  return {
    output: dest.stream,
    dispose: () => {
      for (const s of sources) s.disconnect();
      void ctx.close();
    },
  };
}
