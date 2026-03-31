# Deployment

## Local UI only

```bash
npm install
npm run dev
```

## Full stack with Vercel local runtime

```bash
npm install
npm run dev:full
```

This mode serves the Vite app plus the `/api/diagnose` function.

## Production

1. Import the repo into Vercel.
2. Set environment variables from `.env.example`.
3. Deploy with the default `vercel.json` configuration.

## Recommended environment variables

- `AUDIOCOPILOT_AI_PROVIDER=local` for safe default demo mode
- `OPENAI_API_KEY` to enable hosted Responses API generation
- `OPENAI_MODEL=gpt-5-mini`
- `OPENAI_EMBEDDING_MODEL=text-embedding-3-small`
- `OLLAMA_BASE_URL=http://127.0.0.1:11434`
- `OLLAMA_MODEL=llama3.1:8b`
