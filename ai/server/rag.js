const problemTree = require('../../data/problem-tree.json')
const scenarioTemplates = require('../../data/scenario-templates.json')

function normalizeText(value = '') {
  return value.toLowerCase()
}

function buildDocument(node) {
  return [
    `problem: ${node.problem}`,
    `keywords: ${node.keywords.join(', ')}`,
    `causes: ${node.causes.join(', ')}`,
    `solutions: ${node.solutions.join(', ')}`,
    `deviceAdvice: ${node.deviceAdvice.join(', ')}`,
  ].join('\n')
}

function overlapScore(query, text) {
  const tokens = normalizeText(query)
    .split(/[\s,，。.!?？]+/)
    .filter(Boolean)

  if (tokens.length === 0) {
    return 0
  }

  const normalizedText = normalizeText(text)

  return tokens.reduce((score, token) => {
    return score + (normalizedText.includes(token) ? 1 : 0)
  }, 0)
}

function lexicalScore(query, node) {
  const normalizedQuery = normalizeText(query)
  let score = 0

  if (normalizedQuery.includes(normalizeText(node.problem))) {
    score += 6
  }

  for (const keyword of node.keywords) {
    if (normalizedQuery.includes(normalizeText(keyword))) {
      score += 3
    }
  }

  score += overlapScore(query, buildDocument(node))

  return score
}

function cosineSimilarity(left, right) {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0

  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0
    const r = right[index] ?? 0
    dot += l * r
    leftNorm += l * l
    rightNorm += r * r
  }

  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm)
  return denominator === 0 ? 0 : dot / denominator
}

function diagnoseIssue(input) {
  const ranked = problemTree
    .map((node) => ({ node, score: lexicalScore(input, node) }))
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
      bestMatch.score >= 10 ? 'high' : bestMatch.score >= 6 ? 'medium' : 'low',
    reasons: bestMatch.node.causes,
    steps: bestMatch.node.solutions,
    deviceAdvice: bestMatch.node.deviceAdvice,
  }
}

function diagnoseMetrics(metrics) {
  if (!metrics) {
    return []
  }

  const insights = []

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

function getScenarioTemplate(id) {
  return (
    scenarioTemplates.find((template) => template.id === id) ?? scenarioTemplates[0]
  )
}

let cachedEmbeddings = null

async function embedDocuments(openai, model) {
  if (cachedEmbeddings) {
    return cachedEmbeddings
  }

  const documents = problemTree.map(buildDocument)
  const response = await openai.embeddings.create({
    model,
    input: documents,
    encoding_format: 'float',
  })

  cachedEmbeddings = response.data.map((item, index) => ({
    node: problemTree[index],
    embedding: item.embedding,
  }))

  return cachedEmbeddings
}

async function retrieveKnowledge({
  query,
  provider,
  openaiClient,
  embeddingModel,
}) {
  const lexicalRanked = problemTree
    .map((node) => ({ node, score: lexicalScore(query, node) }))
    .sort((left, right) => right.score - left.score)

  if (provider !== 'openai' || !openaiClient) {
    return {
      retrievalMode: 'lexical',
      nodes: lexicalRanked.slice(0, 3).map((item) => item.node),
    }
  }

  const queryEmbedding = await openaiClient.embeddings.create({
    model: embeddingModel,
    input: query,
    encoding_format: 'float',
  })
  const documents = await embedDocuments(openaiClient, embeddingModel)
  const hybridRanked = documents
    .map((item) => {
      const semanticScore = cosineSimilarity(
        queryEmbedding.data[0].embedding,
        item.embedding,
      )
      const lexical = lexicalScore(query, item.node)

      return {
        node: item.node,
        score: semanticScore * 10 + lexical,
      }
    })
    .sort((left, right) => right.score - left.score)

  return {
    retrievalMode: 'embedding-hybrid',
    nodes: hybridRanked.slice(0, 3).map((item) => item.node),
  }
}

function buildLocalSummary({ diagnosis, metrics, insights, scenario }) {
  const signalNote = metrics
    ? `当前采样为 ${metrics.sampleRate} Hz，平均电平 ${metrics.rmsDb} dB，峰值 ${metrics.peakDb} dB。`
    : '当前还没有上传音频指标，所以先按文本故障树给出排查路径。'

  return {
    summary: `优先把问题定位在“${diagnosis.matchedProblem}”这条路径上。${signalNote}`,
    eqSuggestion: `从 ${scenario.recommendedSettings.eq} 开始，先做轻微修正，再根据真实回放决定是否继续加深。`,
    compressorSuggestion: `压缩器建议从 ${scenario.recommendedSettings.compressor} 起步，先让人声更稳，再避免把底噪一起抬高。`,
    obsGuide: 'OBS 中先确认输入源选对，再看高级音频属性是否有同步偏移，最后按顺序检查增益、门限、压缩器和降噪滤镜。',
  }
}

function safeJsonParse(text) {
  if (typeof text !== 'string') {
    return null
  }

  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

async function generateOpenAIResponse({
  openai,
  model,
  issue,
  scenario,
  diagnosis,
  insights,
  retrievedNodes,
}) {
  const prompt = [
    'You are AudioCopilot, an expert audio troubleshooting assistant.',
    'Return strict JSON with keys: summary, eqSuggestion, compressorSuggestion, obsGuide.',
    'Keep the tone concise, practical, and creator-friendly.',
    `User issue: ${issue}`,
    `Scenario: ${scenario.name}`,
    `Diagnosis: ${JSON.stringify(diagnosis)}`,
    `Signal insights: ${JSON.stringify(insights)}`,
    `Retrieved knowledge: ${JSON.stringify(retrievedNodes)}`,
  ].join('\n')

  const response = await openai.responses.create({
    model,
    input: prompt,
  })

  const parsed = safeJsonParse(response.output_text)
  return parsed ?? buildLocalSummary({ diagnosis, insights, scenario })
}

async function generateOllamaResponse({
  issue,
  scenario,
  diagnosis,
  insights,
  retrievedNodes,
}) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
  const model = process.env.OLLAMA_MODEL || 'llama3.1:8b'
  const prompt = [
    'Return strict JSON with keys: summary, eqSuggestion, compressorSuggestion, obsGuide.',
    `User issue: ${issue}`,
    `Scenario: ${scenario.name}`,
    `Diagnosis: ${JSON.stringify(diagnosis)}`,
    `Signal insights: ${JSON.stringify(insights)}`,
    `Retrieved knowledge: ${JSON.stringify(retrievedNodes)}`,
  ].join('\n')

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: 'json',
    }),
  })

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status}`)
  }

  const payload = await response.json()
  const parsed = safeJsonParse(payload.response)
  return parsed ?? buildLocalSummary({ diagnosis, insights, scenario })
}

async function runRag({
  issue,
  scenarioId,
  metrics,
  requestedProvider,
}) {
  const scenario = getScenarioTemplate(scenarioId)
  const defaultProvider = process.env.AUDIOCOPILOT_AI_PROVIDER || 'local'
  const provider = requestedProvider || defaultProvider
  const insights = diagnoseMetrics(metrics)
  const diagnosis = diagnoseIssue(issue)

  let openai = null
  if (provider === 'openai' && process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai')
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }

  const retrieval = await retrieveKnowledge({
    query: `${issue}\n${JSON.stringify(metrics ?? {})}`,
    provider,
    openaiClient: openai,
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  })

  let providerUsed = 'local'
  let aiSummary = buildLocalSummary({ diagnosis, metrics, insights, scenario })

  if (provider === 'openai' && openai) {
    providerUsed = 'openai'
    aiSummary = await generateOpenAIResponse({
      openai,
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      issue,
      scenario,
      diagnosis,
      insights,
      retrievedNodes: retrieval.nodes,
    })
  } else if (provider === 'ollama') {
    providerUsed = 'ollama'
    aiSummary = await generateOllamaResponse({
      issue,
      scenario,
      diagnosis,
      insights,
      retrievedNodes: retrieval.nodes,
    })
  }

  return {
    diagnosis,
    insights,
    scenario,
    providerUsed,
    retrievalMode: retrieval.retrievalMode,
    retrievedProblems: retrieval.nodes.map((node) => node.problem),
    aiSummary,
  }
}

module.exports = {
  runRag,
  diagnoseIssue,
  diagnoseMetrics,
  getScenarioTemplate,
}
