export class ScaleQuantizer {
  quantizeMidi(root: number, scaleIntervals: number[], candidateMidi: number): number {
    const centerOctave = Math.floor(candidateMidi / 12);
    let best = candidateMidi;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let octave = centerOctave - 2; octave <= centerOctave + 2; octave += 1) {
      for (const interval of scaleIntervals) {
        const midi = octave * 12 + root + interval;
        const distance = Math.abs(midi - candidateMidi);

        if (distance < bestDistance) {
          best = midi;
          bestDistance = distance;
        }
      }
    }

    return Math.max(24, Math.min(108, Math.round(best)));
  }
}
