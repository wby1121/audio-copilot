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

type Provider = 'local' | 'openai' | 'ollama'

type AiSummary = {
  summary: string
  eqSuggestion: string
  compressorSuggestion: string
  obsGuide: string
}

type DiagnoseApiResponse = {
  diagnosis: DiagnosisResult
  insights: MetricInsight[]
  scenario: ReturnType<typeof getScenarioTemplate>
  providerUsed: Provider
  retrievalMode: string
  retrievedProblems: string[]
  aiSummary: AiSummary
}

const scenarioTemplates = listScenarioTemplates()
const defaultIssue = '有电流声'

function buildFallbackSummary(
  diagnosis: DiagnosisResult,
  scenarioId: string,
  metrics: AudioMetrics | null,
): AiSummary {
  const scenario = getScenarioTemplate(scenarioId)
  const signalLine = metrics
    ? `当前录音平均电平 ${metrics.rmsDb} dB，峰值 ${metrics.peakDb} dB，噪声底约 ${metrics.noiseFloorDb} dB。`
    : '当前还没有录音指标，所以先走文本诊断路径。'

  return {
    summary: `先围绕“${diagnosis.matchedProblem}”排查。${signalLine}`,
    eqSuggestion: `EQ 建议从 ${scenario.recommendedSettings.eq} 起步，先轻微修正再回听。`,
    compressorSuggestion: `压缩器建议从 ${scenario.recommendedSettings.compressor} 起步，先稳住人声，再避免把底噪一起抬上来。`,
    obsGuide:
      'OBS 中优先检查输入设备、同步偏移和滤镜顺序；先把源电平调健康，再做门限、压缩和降噪。',
  }
}

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
  const [countdown, setCountdown] = useState(5)
  const [provider, setProvider] = useState<Provider>('local')
  const [resolvedProvider, setResolvedProvider] = useState<Provider>('local')
  const [retrievalMode, setRetrievalMode] = useState('lexical')
  const [retrievedProblems, setRetrievedProblems] = useState<string[]>([])
  const [aiSummary, setAiSummary] = useState<AiSummary>(() =>
    buildFallbackSummary(diagnoseIssue(defaultIssue), 'gaming', null),
  )
  const [diagnosisNote, setDiagnosisNote] = useState<string | null>(null)
  const [recordingError, setRecordingError] = useState<string | null>(null)
  const [isDiagnosing, setIsDiagnosing] = useState(false)
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

  async function handleDiagnose() {
    const localDiagnosis = diagnoseIssue(issueInput)
    const localInsights = metrics ? diagnoseMetrics(metrics) : []

    setIsDiagnosing(true)
    setDiagnosisNote(null)
    setDiagnosis(localDiagnosis)
    setInsights(localInsights)
    setAiSummary(buildFallbackSummary(localDiagnosis, selectedScenarioId, metrics))

    try {
      const response = await fetch('/api/diagnose', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          issue: issueInput,
          metrics,
          scenarioId: selectedScenarioId,
          provider,
        }),
      })

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`)
      }

      const payload = (await response.json()) as DiagnoseApiResponse
      setDiagnosis(payload.diagnosis)
      setInsights(payload.insights)
      setAiSummary(payload.aiSummary)
      setResolvedProvider(payload.providerUsed)
      setRetrievalMode(payload.retrievalMode)
      setRetrievedProblems(payload.retrievedProblems)
    } catch {
      setResolvedProvider('local')
      setRetrievalMode('lexical')
      setRetrievedProblems([localDiagnosis.matchedProblem])
      setDiagnosisNote(
        provider === 'local'
          ? '当前使用本地规则诊断模式。'
          : '服务端 AI 当前不可用，已自动回退到本地规则诊断。',
      )
    } finally {
      setIsDiagnosing(false)
    }
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
      setRecordingError(null)
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
    } catch (error) {
      setRecordingError(
        error instanceof Error
          ? error.message
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
                  the browser, then route them through local rules, OpenAI, or
                  Ollama-backed RAG for practical fixes.
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
                    Browser + API
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
                    3. 切换 local / OpenAI / Ollama 生成不同层级建议
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl bg-slate-950/90 p-4 text-white">
                  <p className="text-xs uppercase tracking-[0.22em] text-cyan-200">
                    Retrieval
                  </p>
                  <p className="mt-2">{retrievalMode}</p>
                </div>
                <div className="rounded-2xl bg-slate-950/90 p-4 text-white">
                  <p className="text-xs uppercase tracking-[0.22em] text-cyan-200">
                    Provider
                  </p>
                  <p className="mt-2">{resolvedProvider}</p>
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
              输入一句话，走本地规则或 RAG 增强诊断
            </h2>

            <div className="mt-5 flex flex-col gap-3">
              <textarea
                className="min-h-28 rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-4 text-base text-white outline-none transition focus:border-cyan-400/50"
                value={issueInput}
                onChange={(event) => setIssueInput(event.target.value)}
                placeholder="例如：有电流声、声音很小、直播有延迟"
              />

              <div className="flex flex-wrap gap-2">
                {(['local', 'openai', 'ollama'] as Provider[]).map((option) => (
                  <button
                    key={option}
                    className={`rounded-full px-4 py-2 text-sm transition ${
                      option === provider
                        ? 'bg-cyan-300 text-slate-950'
                        : 'border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                    }`}
                    onClick={() => setProvider(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>

              <button
                className="inline-flex w-fit items-center rounded-full bg-cyan-400 px-5 py-3 font-medium text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-400/50"
                onClick={() => void handleDiagnose()}
                disabled={isDiagnosing}
              >
                {isDiagnosing ? '分析中...' : '生成诊断建议'}
              </button>
            </div>

            {diagnosisNote ? (
              <p className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                {diagnosisNote}
              </p>
            ) : null}

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

              <div className="mt-4 flex flex-wrap gap-2">
                {retrievedProblems.map((problem) => (
                  <span
                    key={problem}
                    className="rounded-full border border-orange-300/20 bg-orange-300/10 px-3 py-1 text-xs text-orange-100"
                  >
                    {problem}
                  </span>
                ))}
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

              {recordingError ? (
                <p className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">
                  {recordingError}
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

        <section className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
          <div className="rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6 backdrop-blur">
            <p className="text-sm uppercase tracking-[0.24em] text-violet-200">
              AI Tuning Output
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-white">
              把检索到的知识和当前音频状态转成调音建议
            </h2>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-slate-950/75 p-5 md:col-span-2">
                <p className="text-sm text-slate-400">Summary</p>
                <p className="mt-2 text-base text-white">{aiSummary.summary}</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-950/75 p-5">
                <p className="text-sm text-slate-400">EQ Suggestion</p>
                <p className="mt-2 text-base text-white">
                  {aiSummary.eqSuggestion}
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-950/75 p-5">
                <p className="text-sm text-slate-400">Compressor</p>
                <p className="mt-2 text-base text-white">
                  {aiSummary.compressorSuggestion}
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-950/75 p-5 md:col-span-2">
                <p className="text-sm text-slate-400">OBS Guide</p>
                <p className="mt-2 text-base text-white">{aiSummary.obsGuide}</p>
              </div>
            </div>
          </div>

          <section className="rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6 backdrop-blur">
            <div className="flex flex-col gap-4">
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

            <div className="mt-6 grid gap-6">
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
        </section>
      </main>
    </div>
  )
}

export default App
