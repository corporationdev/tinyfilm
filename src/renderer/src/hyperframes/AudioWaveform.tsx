import { memo, useCallback, useEffect, useRef, useState } from 'react'

interface AudioWaveformProps {
  audioUrl: string
  waveformUrl?: string
  label: string
  labelColor: string
}

const BAR_W = 2
const GAP = 1
const STEP = BAR_W + GAP

function extractPeaks(channelData: Float32Array, barCount: number): number[] {
  const peaks: number[] = []
  const samplesPerBar = Math.floor(channelData.length / barCount)
  if (samplesPerBar === 0) return Array(barCount).fill(0)

  for (let i = 0; i < barCount; i += 1) {
    let max = 0
    const start = i * samplesPerBar
    const end = Math.min(start + samplesPerBar, channelData.length)
    for (let j = start; j < end; j += 1) {
      const abs = Math.abs(channelData[j] ?? 0)
      if (abs > max) max = abs
    }
    peaks.push(max)
  }

  const maxPeak = Math.max(...peaks, 0.001)
  return peaks.map((peak) => peak / maxPeak)
}

function fakePeaks(url: string, count: number): number[] {
  let seed = 0
  for (let i = 0; i < url.length; i += 1) {
    seed = ((seed << 5) - seed + url.charCodeAt(i)) | 0
  }
  seed = Math.abs(seed) || 42

  const rand = (): number => {
    seed = (seed * 16807) % 2147483647
    return (seed & 0x7fffffff) / 2147483647
  }

  const peaks: number[] = []
  for (let i = 0; i < count; i += 1) {
    const t = i / count
    const envelope = 0.3 + 0.3 * Math.sin(t * Math.PI * 3.2) + 0.2 * Math.sin(t * Math.PI * 7.1)
    peaks.push(Math.max(0.05, Math.min(1, envelope * (0.4 + 0.6 * rand()))))
  }
  return peaks
}

const peaksCache = new Map<string, number[]>()
const decodeInFlight = new Map<string, Promise<number[]>>()

export const AudioWaveform = memo(function AudioWaveform({
  audioUrl,
  waveformUrl,
  label,
  labelColor
}: AudioWaveformProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const barsRef = useRef<HTMLDivElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const cacheKey = waveformUrl ?? audioUrl
  const [peaks, setPeaks] = useState<number[] | null>(peaksCache.get(cacheKey) ?? null)

  useEffect(() => {
    if (peaks || !cacheKey) return

    let cancelled = false
    let promise = decodeInFlight.get(cacheKey)

    if (!promise) {
      promise = (
        waveformUrl
          ? fetch(waveformUrl)
              .then((response) => response.json())
              .then((data: { peaks?: number[] }) => {
                if (!Array.isArray(data.peaks)) throw new Error('Bad waveform response')
                return data.peaks
              })
          : fetch(audioUrl)
              .then((response) => response.arrayBuffer())
              .then((buffer) => {
                const context = new AudioContext()
                return context.decodeAudioData(buffer).finally(() => context.close())
              })
              .then((decoded) => extractPeaks(decoded.getChannelData(0), 4000))
      )
        .catch(() => fakePeaks(cacheKey, 4000))
        .then((nextPeaks) => {
          peaksCache.set(cacheKey, nextPeaks)
          return nextPeaks
        })
        .finally(() => decodeInFlight.delete(cacheKey))

      decodeInFlight.set(cacheKey, promise)
    }

    promise.then((nextPeaks) => {
      if (!cancelled) setPeaks(nextPeaks)
    })

    return () => {
      cancelled = true
    }
  }, [audioUrl, waveformUrl, cacheKey, peaks])

  const draw = useCallback(() => {
    const container = containerRef.current
    const barsEl = barsRef.current
    if (!container || !barsEl || !peaks) return

    const width = container.clientWidth || 400
    const barCount = Math.min(Math.floor(width / STEP), peaks.length)

    let html = ''
    for (let i = 0; i < barCount; i += 1) {
      const peakIdx = Math.floor((i / barCount) * peaks.length)
      const amp = peaks[peakIdx] ?? 0
      const pct = Math.max(3, Math.round(amp * 100))
      const opacity = (0.45 + amp * 0.4).toFixed(2)
      html += `<div style="position:absolute;bottom:0;left:${i * STEP}px;width:${BAR_W}px;height:${pct}%;background:rgba(75,163,210,${opacity})"></div>`
    }
    barsEl.innerHTML = html
  }, [peaks])

  const setContainerRef = useCallback(
    (el: HTMLDivElement | null) => {
      roRef.current?.disconnect()
      containerRef.current = el
      if (!el) return

      draw()
      roRef.current = new ResizeObserver(() => draw())
      roRef.current.observe(el)
    },
    [draw]
  )

  useEffect(() => {
    draw()
  }, [draw])

  useEffect(() => {
    return () => roRef.current?.disconnect()
  }, [])

  return (
    <div ref={setContainerRef} className="absolute inset-0 overflow-hidden">
      <div ref={barsRef} className="absolute bottom-0 left-0 right-0" style={{ top: 16 }} />
      {!peaks ? (
        <div
          className="absolute bottom-0 left-0 right-0 animate-pulse"
          style={{
            top: 16,
            background:
              'linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 100%)'
          }}
        />
      ) : null}
      <div className="absolute left-0 right-0 top-0 z-10 px-1.5 py-0.5">
        <span
          className="block truncate text-[9px] font-semibold leading-tight"
          style={{ color: labelColor, textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
        >
          {label}
        </span>
      </div>
    </div>
  )
})
