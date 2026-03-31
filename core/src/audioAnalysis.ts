export type AudioMetrics = {
  durationSec: number
  sampleRate: number
  channels: number
  rmsDb: number
  peakDb: number
  peakAmplitude: number
  clippingRatio: number
  hasClipping: boolean
  noiseFloorDb: number
  stereoImbalanceDb: number | null
  monoWarning: boolean
  estimatedOnsetLatencyMs: number | null
}

function toDb(value: number) {
  if (value <= 0) {
    return -96
  }

  return 20 * Math.log10(value)
}

function getWindowRms(samples: Float32Array, start: number, end: number) {
  let sum = 0

  for (let index = start; index < end; index += 1) {
    const sample = samples[index] ?? 0
    sum += sample * sample
  }

  return Math.sqrt(sum / Math.max(1, end - start))
}

function analyzeChannel(samples: Float32Array) {
  let sum = 0
  let peak = 0
  let clippingSamples = 0

  for (const sample of samples) {
    const amplitude = Math.abs(sample)
    sum += sample * sample
    peak = Math.max(peak, amplitude)

    if (amplitude >= 0.99) {
      clippingSamples += 1
    }
  }

  const rms = Math.sqrt(sum / Math.max(1, samples.length))

  return {
    rms,
    peak,
    clippingRatio: clippingSamples / Math.max(1, samples.length),
  }
}

function estimateNoiseFloorDb(samples: Float32Array, sampleRate: number) {
  const windowSize = Math.max(512, Math.floor(sampleRate * 0.05))
  const windows: number[] = []

  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(samples.length, start + windowSize)
    windows.push(toDb(getWindowRms(samples, start, end)))
  }

  windows.sort((left, right) => left - right)
  const percentileIndex = Math.floor(windows.length * 0.15)

  return windows[percentileIndex] ?? -96
}

function estimateOnsetLatencyMs(samples: Float32Array, sampleRate: number, peak: number) {
  const threshold = Math.max(0.02, peak * 0.2)

  for (let index = 0; index < samples.length; index += 1) {
    if (Math.abs(samples[index] ?? 0) >= threshold) {
      return Math.round((index / sampleRate) * 1000)
    }
  }

  return null
}

export async function analyzeAudioBlob(blob: Blob): Promise<AudioMetrics> {
  const audioContext = new AudioContext()

  try {
    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
    const { numberOfChannels, sampleRate, duration, length } = audioBuffer
    const merged = new Float32Array(length)
    const channelStats = []

    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      const channelData = audioBuffer.getChannelData(channel)
      channelStats.push(analyzeChannel(channelData))

      for (let index = 0; index < length; index += 1) {
        merged[index] += (channelData[index] ?? 0) / numberOfChannels
      }
    }

    const mergedStats = analyzeChannel(merged)
    const leftRmsDb = numberOfChannels > 0 ? toDb(channelStats[0]?.rms ?? 0) : -96
    const rightRmsDb =
      numberOfChannels > 1 ? toDb(channelStats[1]?.rms ?? 0) : leftRmsDb
    const stereoImbalanceDb =
      numberOfChannels > 1 ? Math.abs(leftRmsDb - rightRmsDb) : null

    return {
      durationSec: Number(duration.toFixed(2)),
      sampleRate,
      channels: numberOfChannels,
      rmsDb: Number(toDb(mergedStats.rms).toFixed(1)),
      peakDb: Number(toDb(mergedStats.peak).toFixed(1)),
      peakAmplitude: Number(mergedStats.peak.toFixed(3)),
      clippingRatio: Number((mergedStats.clippingRatio * 100).toFixed(2)),
      hasClipping: mergedStats.clippingRatio > 0.001,
      noiseFloorDb: Number(estimateNoiseFloorDb(merged, sampleRate).toFixed(1)),
      stereoImbalanceDb:
        stereoImbalanceDb === null ? null : Number(stereoImbalanceDb.toFixed(1)),
      monoWarning: numberOfChannels === 1,
      estimatedOnsetLatencyMs: estimateOnsetLatencyMs(
        merged,
        sampleRate,
        mergedStats.peak,
      ),
    }
  } finally {
    await audioContext.close()
  }
}

