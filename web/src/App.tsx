import { useEffect, useMemo, useRef, useState } from 'react'
import {
  diagnoseIssue,
  diagnoseMetrics,
  getScenarioTemplate,
  listScenarioTemplates,
  type DiagnosisResult,
  type MetricInsight,
} from '../../ai/src/diagnosis.ts'
import {
  analyzeAudioBlob,
  type AudioMetrics,
} from '../../core/src/audioAnalysis.ts'

const scenarioTemplates = listScenarioTemplates()
const defaultIssue = '有电流声'

function App() {
  const [issueInput, setIssueInput] = useState(defaultIssue)
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult>(() =>
    diagnoseIssue(defaultIssue),
  )
  const [selectedScenarioId, setSelectedScenarioId] = useState(
    scenarioTemplates[0]?.id ?? 'gaming',
  )
  const [metrics, setMetrics] = useState<AudioMetrics | null>(null)
  const [insights, setInsights] = useState<MetricInsight[]>([])
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(5)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const selectedScenario = useMemo(
    () => getScenarioTemplate(selectedScenarioId),
    [selectedScenarioId],
  )

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }

      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [audioUrl])

  function handleDiagnose() {
    setDiagnosis(diagnoseIssue(issueInput))
  }

  async function stopRecording() {
    recorderRef.current?.stop()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setIsRecording(false)
    setCountdown(5)
  }

  async function startRecording() {
    try {
      setError(null)
      setIsRecording(true)
      setCountdown(5)
      chunksRef.current = []

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })

      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType })

        if (audioUrl) {
          URL.revokeObjectURL(audioUrl)
        }

        const nextAudioUrl = URL.createObjectURL(blob)
        setAudioUrl(nextAudioUrl)

        const nextMetrics = await analyzeAudioBlob(blob)
        setMetrics(nextMetrics)
        setInsights(diagnoseMetrics(nextMetrics))
      }

      recorder.start()

      let remaining = 5
      const timer = window.setInterval(() => {
        remaining -= 1
        setCountdown(Math.max(remaining, 0))

        if (remaining <= 0) {
          window.clearInterval(timer)
        }
      }, 1000)

      window.setTimeout(() => {
        window.clearInterval(timer)
        void stopRecording()
      }, 5000)
    } catch (recordingError) {
      setError(
        recordingError instanceof Error
          ? recordingError.message
          : '无法访问麦克风，请检查浏览器权限。',
      )
      setIsRecording(false)
      setCountdown(5)
    }
  }

  const metricsCards = metrics
    ? [
        { label: 'Noise Floor', value: `${metrics.noiseFloorDb} dB` },
        { label: 'RMS', value: `${metrics.rmsDb} dB` },
        { label: 'Peak', value: `${metrics.peakDb} dB` },
        {
          label: 'Clipping',
          value: metrics.hasClipping ? `${metrics.clippingRatio}%` : 'No',
        },
        { label: 'Channels', value: String(metrics.channels) },
        {
          label: 'Onset Delay',
          value:
            metrics.estimatedOnsetLatencyMs === null
              ? 'N/A'
              : `${metrics.estimatedOnsetLatencyMs} ms`,
        },
      ]
    : []

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_35%),radial-gradient(circle_at_80%_20%,_rgba(249,115,22,0.18),_transparent_20%)]" />

      <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-10 px-6 py-8 md:px-10 lg:px-12">
        <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/65 shadow-glow backdrop-blur">
          <div className="grid gap-10 px-6 py-8 md:px-10 md:py-12 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <div className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-sm text-cyan-200">
                AI audio troubleshooting for creators
              </div>

              <div className="space-y-4">
                <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
                  Fix your microphone & audio issues in 3 minutes with AI.
                </h1>
                <p className="max-w-2xl text-base text-slate-300 md:text-lg">
                  Detect noise, clipping, rough latency, and channel issues in
                  the browser, then turn that into practical actions for OBS,
                  Discord, Zoom, and streaming setups.
                </p>
              </div>

              <div className="grid gap-3 text-sm text-slate-200 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-cyan-200">
                    Diagnose
                  </p>
                  <p className="mt-2">多路径问题原因 + 排查步骤</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-cyan-200">
                    Detect
                  </p>
                  <p className="mt-2">5 秒录音检测底噪、削波、延迟</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-cyan-200">
                    Tune
                  </p>
                  <p className="mt-2">场景模板输出 EQ / Compressor 建议</p>
                </div>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-orange-300/20 bg-gradient-to-br from-orange-200 via-orange-50 to-cyan-100 p-6 text-slate-900">
              <div className="rounded-[1.5rem] bg-slate-950 p-5 text-white">
                <div className="flex items-center justify-between">
                  <p className="text-sm uppercase tracking-[0.2em] text-cyan-200">
                    Live Demo Flow
                  </p>
                  <span className="rounded-full bg-orange-500/20 px-3 py-1 text-xs text-orange-200">
                    Browser only
                  </span>
                </div>

                <div className="mt-5 space-y-4 text-sm text-slate-300">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    1. 输入问题，例如“有电流声”
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    2. 录制 5 秒真实麦克风音频
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    3. 立刻拿到排查路径、调音建议和场景模板
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl bg-slate-950/90 p-4 text-white">
                  <p className="text-xs uppercase tracking-[0.22em] text-cyan-200">
                    Works With
                  </p>
                  <p className="mt-2">OBS / Discord / Zoom</p>
                </div>
                <div className="rounded-2xl bg-slate-950/90 p-4 text-white">
                  <p className="text-xs uppercase tracking-[0.22em] text-cyan-200">
                    Future Path
                  </p>
                  <p className="mt-2">OpenAI + local model support</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6 backdrop-blur">
            <p className="text-sm uppercase tracking-[0.24em] text-cyan-200">
              Text Diagnosis
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-white">
              输入一句话，先拿到诊断路径
            </h2>

            <div className="mt-5 flex flex-col gap-3">
              <textarea
                className="min-h-28 rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-4 text-base text-white outline-none transition focus:border-cyan-400/50"
                value={issueInput}
                onChange={(event) => setIssueInput(event.target.value)}
                placeholder="例如：有电流声、声音很小、直播有延迟"
              />
              <button
                className="inline-flex w-fit items-center rounded-full bg-cyan-400 px-5 py-3 font-medium text-slate-950 transition hover:bg-cyan-300"
                onClick={handleDiagnose}
              >
                生成诊断建议
              </button>
            </div>

            <div className="mt-6 rounded-3xl border border-white/10 bg-slate-950/70 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-400">匹配问题</p>
                  <p className="text-xl font-semibold text-white">
                    {diagnosis.matchedProblem}
                  </p>
                </div>
                <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-cyan-100">
                  {diagnosis.confidence}
                </span>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <div>
                  <p className="text-sm font-medium text-cyan-200">问题原因</p>
                  <ul className="mt-3 space-y-2 text-sm text-slate-300">
                    {diagnosis.reasons.map((reason) => (
                      <li key={reason} className="rounded-2xl bg-white/5 p-3">
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-sm font-medium text-cyan-200">排查步骤</p>
                  <ul className="mt-3 space-y-2 text-sm text-slate-300">
                    {diagnosis.steps.map((step, index) => (
                      <li key={step} className="rounded-2xl bg-white/5 p-3">
                        {index + 1}. {step}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-sm font-medium text-cyan-200">设备建议</p>
                  <ul className="mt-3 space-y-2 text-sm text-slate-300">
                    {diagnosis.deviceAdvice.map((tip) => (
                      <li key={tip} className="rounded-2xl bg-white/5 p-3">
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6 backdrop-blur">
            <p className="text-sm uppercase tracking-[0.24em] text-orange-200">
              5-Second Analyzer
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-white">
              录 5 秒音频，一键看信号健康度
            </h2>

            <div className="mt-6 rounded-[1.75rem] border border-orange-300/20 bg-gradient-to-br from-orange-500/15 to-cyan-400/10 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm text-slate-300">
                    关闭浏览器自动降噪后检测更准确
                  </p>
                  <p className="mt-2 text-3xl font-semibold text-white">
                    {isRecording ? `${countdown}s` : 'Ready'}
                  </p>
                </div>
                <button
                  className="rounded-full bg-orange-500 px-5 py-3 font-medium text-white transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-orange-500/40"
                  onClick={() => void startRecording()}
                  disabled={isRecording}
                >
                  {isRecording ? 'Recording...' : '录 5 秒音频'}
                </button>
              </div>

              {error ? (
                <p className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">
                  {error}
                </p>
              ) : null}

              {audioUrl ? (
                <audio className="mt-4 w-full" src={audioUrl} controls />
              ) : null}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {metricsCards.map((card) => (
                <div
                  key={card.label}
                  className="rounded-2xl border border-white/10 bg-slate-950/70 p-4"
                >
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                    {card.label}
                  </p>
                  <p className="mt-2 text-xl font-semibold text-white">
                    {card.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-6 space-y-3">
              {insights.map((insight) => (
                <div
                  key={insight.headline}
                  className="rounded-3xl border border-white/10 bg-white/5 p-5"
                >
                  <p className="text-lg font-semibold text-white">
                    {insight.headline}
                  </p>
                  <p className="mt-2 text-sm text-slate-300">
                    {insight.details}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {insight.tuningAdvice.map((tip) => (
                      <span
                        key={tip}
                        className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100"
                      >
                        {tip}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6 backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-emerald-200">
                Scene Templates
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-white">
                给不同创作场景一键推荐设置
              </h2>
            </div>

            <div className="flex flex-wrap gap-2">
              {scenarioTemplates.map((template) => (
                <button
                  key={template.id}
                  className={`rounded-full px-4 py-2 text-sm transition ${
                    template.id === selectedScenarioId
                      ? 'bg-emerald-300 text-slate-950'
                      : 'border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                  }`}
                  onClick={() => setSelectedScenarioId(template.id)}
                >
                  {template.name}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
            <div className="rounded-[1.5rem] border border-emerald-300/20 bg-emerald-300/10 p-5">
              <p className="text-sm uppercase tracking-[0.18em] text-emerald-100">
                场景说明
              </p>
              <p className="mt-3 text-xl font-semibold text-white">
                {selectedScenario.name}
              </p>
              <p className="mt-3 text-sm text-slate-200">
                {selectedScenario.summary}
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-slate-950/75 p-5">
                <p className="text-sm text-slate-400">Gain Target</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {selectedScenario.recommendedSettings.gain}
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-950/75 p-5">
                <p className="text-sm text-slate-400">Noise Gate</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {selectedScenario.recommendedSettings.noiseGate}
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-950/75 p-5">
                <p className="text-sm text-slate-400">Compressor</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {selectedScenario.recommendedSettings.compressor}
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-950/75 p-5">
                <p className="text-sm text-slate-400">EQ Direction</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {selectedScenario.recommendedSettings.eq}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {selectedScenario.recommendedSettings.notes.map((note) => (
              <span
                key={note}
                className="rounded-full border border-orange-300/20 bg-orange-300/10 px-3 py-1 text-xs text-orange-100"
              >
                {note}
              </span>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
