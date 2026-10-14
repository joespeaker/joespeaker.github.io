// 16-bit PCM WAV encoder. Takes Float32 channel data (as from an AudioBuffer).

export function encodeWav(channels, sampleRate) {
  const numCh = channels.length;
  const frames = channels[0].length;
  const bytesPerSample = 2;
  const dataSize = frames * numCh * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const ascii = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };

  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);                                // fmt chunk size
  v.setUint16(20, 1, true);                                 // PCM
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numCh * bytesPerSample, true); // byte rate
  v.setUint16(32, numCh * bytesPerSample, true);              // block align
  v.setUint16(34, 16, true);                                  // bits per sample
  ascii(36, 'data');
  v.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const x = Math.max(-1, Math.min(1, channels[ch][i]));
      v.setInt16(off, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      off += 2;
    }
  }
  return buf;
}
