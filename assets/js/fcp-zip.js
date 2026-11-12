/**
 * Re-encode FCP export ZIP: Media/_source/* (webm/ogg) → Media/{id}.wav
 * so Final Cut Pro can import voiceovers.
 */

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * @param {AudioBuffer} buffer
 * @returns {ArrayBuffer}
 */
export function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const samples = buffer.length;
  const blockAlign = (numChannels * bitDepth) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples * blockAlign;
  const headerSize = 44;
  const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(arrayBuffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }
  for (let i = 0; i < samples; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channels[c][i];
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return arrayBuffer;
}

function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    s.async = true;
    s.onload = () => (window.JSZip ? resolve(window.JSZip) : reject(new Error('JSZip missing')));
    s.onerror = () => reject(new Error('JSZip load failed'));
    document.head.appendChild(s);
  });
}

/**
 * Replace Media/_source audio with real WAV files; remove _source folder entries.
 * @param {Blob} zipBlob
 * @returns {Promise<Blob>}
 */
export async function transcodeFcpZipAudio(zipBlob) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(zipBlob);
  const sourcePaths = Object.keys(zip.files).filter(
    (p) => /\/Media\/_source\/[^/]+\.(webm|ogg)$/i.test(p) && !zip.files[p].dir
  );

  if (!sourcePaths.length) {
    return zipBlob;
  }

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return zipBlob;
  }

  const ctx = new AudioCtx();
  try {
    for (const srcPath of sourcePaths) {
      const base = srcPath.split('/').pop().replace(/\.(webm|ogg)$/i, '');
      const mediaDir = srcPath.replace(/\/_source\/[^/]+$/, '');
      const wavPath = `${mediaDir}/${base}.wav`;
      try {
        const raw = await zip.files[srcPath].async('arraybuffer');
        const audioBuffer = await ctx.decodeAudioData(raw.slice(0));
        const wav = audioBufferToWav(audioBuffer);
        zip.file(wavPath, wav);
      } catch {
        // Keep silent WAV stub already in the zip.
      }
      zip.remove(srcPath);
    }

    // Drop empty _source placeholders if any remain.
    Object.keys(zip.files)
      .filter((p) => p.includes('/Media/_source'))
      .forEach((p) => zip.remove(p));
  } finally {
    try {
      await ctx.close();
    } catch {
      /* ignore */
    }
  }

  return zip.generateAsync({ type: 'blob' });
}
