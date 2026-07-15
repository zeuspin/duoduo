export function resampleMono(input: Float32Array, sourceRate: number, targetRate = 16000): Float32Array {
  if (sourceRate === targetRate) return input.slice();
  if (sourceRate < targetRate) throw new Error("UNSUPPORTED_SAMPLE_RATE");
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) sum += input[cursor];
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

export function floatToPcm16(input: Float32Array): Buffer {
  const output = Buffer.allocUnsafe(input.length * 2);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output.writeInt16LE(sample < 0 ? Math.round(sample * 0x7fff) : Math.round(sample * 0x7fff), index * 2);
  }
  return output;
}
