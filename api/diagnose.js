const { runRag } = require('../ai/server/rag.js')

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const { issue, metrics = null, scenarioId = 'gaming', provider = 'local' } =
      request.body ?? {}

    if (!issue || typeof issue !== 'string') {
      response.status(400).json({ error: 'issue is required' })
      return
    }

    const result = await runRag({
      issue,
      metrics,
      scenarioId,
      requestedProvider: provider,
    })

    response.status(200).json(result)
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown diagnose error',
    })
  }
}

