import problemTree from '../../data/problem-tree.json'
import scenarioTemplates from '../../data/scenario-templates.json'
import type { AudioMetrics } from '../../core/src/audioAnalysis.ts'

type KnowledgeNode = {
  problem: string
  keywords: string[]
  causes: string[]
  solutions: string[]
  deviceAdvice: string[]
}

type ScenarioTemplate = {
  id: string
  name: string
  summary: string
  recommendedSettings: {
    gain: string
    noiseGate: string
    compressor: string
    eq: string
    notes: string[]
  }
}

export type DiagnosisResult = {
  matchedProblem: string
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
  steps: string[]
  deviceAdvice: string[]
}

export type MetricInsight = {
  headline: string
  details: string
  tuningAdvice: string[]
}

const knowledgeBase = problemTree as KnowledgeNode[]
const templates = scenarioTemplates as ScenarioTemplate[]

function scoreNode(input: string, node: KnowledgeNode) {
  const normalized = input.toLowerCase()
  let score = 0

  if (normalized.includes(node.problem.toLowerCase())) {
    score += 4
  }

  for (const keyword of node.keywords) {
    if (normalized.includes(keyword.toLowerCase())) {
      score += 2
    }
  }

  return score
}

export function diagnoseIssue(input: string): DiagnosisResult {
  const ranked = knowledgeBase
    .map((node) => ({ node, score: scoreNode(input, node) }))
    .sort((left, right) => right.score - left.score)

  const bestMatch = ranked[0]

  if (!bestMatch || bestMatch.score === 0) {
    return {
      matchedProblem: '通用音频排查',
      confidence: 'low',
      reasons: [
        '输入设备选择错误',
        '系统采样率和软件采样率不一致',
        '增益、线材或供电链路存在基础问题',
      ],
      steps: [
        '先确认使用的是正确麦克风设备',
        '统一系统与软件采样率为 48kHz',
        '用另一条线材或另一个 USB 口交叉测试',
        '在 OBS / Discord 中关闭多余滤镜后复测',
      ],
      deviceAdvice: [
        'USB 麦克风优先检查供电与接口',
        'XLR 链路优先检查前级、幻象电源和线材',
      ],
    }
  }

  return {
    matchedProblem: bestMatch.node.problem,
    confidence:
      bestMatch.score >= 6 ? 'high' : bestMatch.score >= 4 ? 'medium' : 'low',
    reasons: bestMatch.node.causes,
    steps: bestMatch.node.solutions,
    deviceAdvice: bestMatch.node.deviceAdvice,
  }
}

export function diagnoseMetrics(metrics: AudioMetrics): MetricInsight[] {
  const insights: MetricInsight[] = []

  if (metrics.noiseFloorDb > -45) {
    insights.push({
      headline: '你有底噪问题',
      details: `当前噪声底约为 ${metrics.noiseFloorDb} dB，已经偏高，直播和播客里会比较明显。`,
      tuningAdvice: [
        '降低硬件增益，缩短麦克风距离',
        '先排查 USB 供电、风扇和空调噪声',
        '最后再用轻量降噪，不要一开始就重处理',
      ],
    })
  }

  if (metrics.hasClipping || metrics.peakDb > -3) {
    insights.push({
      headline: '你的增益过高',
      details: `峰值来到 ${metrics.peakDb} dB，已经接近或进入削波区间。`,
      tuningAdvice: [
        '先降硬件增益，再调整压缩器',
        '把正常说话峰值控制在 -12 dB 到 -6 dB 左右',
        '加防喷罩并稍微偏轴收音',
      ],
    })
  }

  if (metrics.rmsDb < -30) {
    insights.push({
      headline: '整体电平偏低',
      details: `当前平均电平约为 ${metrics.rmsDb} dB，主体人声会显得偏远。`,
      tuningAdvice: [
        '将麦克风靠近 10 到 15 厘米',
        '检查输入设备是否选对',
        '逐步增加前级增益，避免直接拉软件音量',
      ],
    })
  }

  if ((metrics.stereoImbalanceDb ?? 0) > 6) {
    insights.push({
      headline: '左右声道可能异常',
      details: `左右声道电平差约 ${metrics.stereoImbalanceDb} dB，可能是单边输入、转接线或路由设置问题。`,
      tuningAdvice: [
        '检查是否误用了单声道到立体声的转接方式',
        'OBS 中确认音源没有只进一侧声道',
        '需要双声道时再保留立体声，否则直接转为单声道更稳妥',
      ],
    })
  }

  if ((metrics.estimatedOnsetLatencyMs ?? 0) > 180) {
    insights.push({
      headline: '检测到偏高的起始延迟',
      details: `本次录音的粗略起始延迟约为 ${metrics.estimatedOnsetLatencyMs} ms，可能与蓝牙、缓冲区或监听链路有关。`,
      tuningAdvice: [
        '优先改用有线耳机与有线麦克风',
        '统一采样率并下调缓冲区',
        '直播时尽量使用声卡直通监听',
      ],
    })
  }

  if (insights.length === 0) {
    insights.push({
      headline: '当前信号基础状态不错',
      details: '没有看到明显的削波、异常底噪或严重声道失衡，可以继续做细节调音。',
      tuningAdvice: [
        '轻微压缩即可，不要过度处理',
        '根据场景模板再细调 EQ 和门限',
        '用真实直播或会议软件做一次端到端复测',
      ],
    })
  }

  return insights
}

export function getScenarioTemplate(id: string) {
  return templates.find((template) => template.id === id) ?? templates[0]
}

export function listScenarioTemplates() {
  return templates
}

