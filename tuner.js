(() => {
  "use strict";

  function autoCorrelate(buffer, sampleRate) {
    let rms = 0;
    for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / buffer.length);
    if (rms < 0.012) return { frequency: -1, clarity: 0 };

    let start = 0, end = buffer.length - 1;
    const threshold = 0.2;
    for (let i = 0; i < buffer.length / 2; i++) {
      if (Math.abs(buffer[i]) < threshold) { start = i; break; }
    }
    for (let i = 1; i < buffer.length / 2; i++) {
      if (Math.abs(buffer[buffer.length - i]) < threshold) { end = buffer.length - i; break; }
    }

    const data = buffer.slice(start, end);
    const size = data.length;
    const correlations = new Float32Array(size);
    for (let lag = 0; lag < size; lag++) {
      let sum = 0;
      for (let i = 0; i < size - lag; i++) sum += data[i] * data[i + lag];
      correlations[lag] = sum;
    }

    let dip = 0;
    while (dip + 1 < size && correlations[dip] > correlations[dip + 1]) dip++;
    let maxValue = -1, maxIndex = -1;
    for (let i = dip; i < size; i++) {
      if (correlations[i] > maxValue) { maxValue = correlations[i]; maxIndex = i; }
    }
    if (maxIndex <= 0) return { frequency: -1, clarity: 0 };

    let period = maxIndex;
    if (maxIndex > 0 && maxIndex < size - 1) {
      const x1 = correlations[maxIndex - 1];
      const x2 = correlations[maxIndex];
      const x3 = correlations[maxIndex + 1];
      const denom = x1 - 2 * x2 + x3;
      if (denom !== 0) period += 0.5 * (x1 - x3) / denom;
    }
    const clarity = correlations[maxIndex] / Math.max(correlations[0], 1e-9);
    return { frequency: sampleRate / period, clarity };
  }

  window.ShianPitch = { autoCorrelate };
})();