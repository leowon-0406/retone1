# Re:Tone OpenAI model migration ledger

## Objective

- Replace the currently hard-coded OpenAI models with a current, configurable model setup.
- Preserve the existing Responses API request/response behavior and user-facing AI features.
- Reuse the already configured `OPENAI_API_KEY`; never expose it in source or logs.

## Current integration

- Provider: OpenAI Responses API via `reqwest`
- Fast tone/context checks: `gpt-4o-mini`
- Fact checking with web search: `gpt-4.1-mini`
- Storage: `store: false`
- Structured output: JSON object for moderation and conversation analysis
- Web search: required only for fact checking

## Decisions

- Implementation requested: yes
- Credential decision: reuse the existing Render `OPENAI_API_KEY`
- Preserve public API routes and JSON formats: yes
- Make model selection configurable through environment variables: implemented
- Fast/high-volume default: `gpt-6-luna`
- Context, flow and web-search default: `gpt-6.1-terra`
- Compatibility fallback: `gpt-4o-mini` for ordinary responses and `gpt-4.1-mini` for web search

## Coverage map

- Tone pre-check and contextual message review
- Rewrite and emotional support
- Conversation-flow analysis
- Image moderation (separate moderation endpoint; no model migration planned)
- Fact checking with web search
- AI connection status

## Validation

- Focused source/configuration checks: passed
- Frontend regression suite: passed
- Rust build and test compilation: passed
- Live API smoke test: pending after deployment

## Responses API capability assessment

- Model selection: applicable; split by latency-sensitive and quality-sensitive workloads.
- Responses API: already in use; retained.
- Streaming/WebSocket: not needed for short buffered moderation results in this stage.
- Privacy: retained `store: false`; no claim of Zero Data Retention.
- Processing tier: Standard retained; no pricing-tier change requested.
- Prompt caching: application cache already reuses completed checks; no request-level cache change in this stage.
- State: application-owned recent context retained; no server-side response chaining introduced.
- Reasoning/verbosity: omitted to preserve compatibility across the new models and legacy fallback.
- Output limits: existing per-workload limits retained.
- Structured output: JSON output retained for moderation, context and flow analysis.
- Tools: required web search retained for fact checking; no additional tools added.
