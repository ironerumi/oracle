# Learnings

## Perplexity API

### Endpoint
- Base URL: `https://api.perplexity.ai/chat/completions`
- Auth: `Authorization: Bearer $PERPLEXITY_API_KEY`

### Models
| Model | Input Limit | Notes |
|-------|-------------|-------|
| sonar | 128K | Basic search |
| sonar-pro | 200K | Enhanced |
| sonar-reasoning-pro | 128K | Has reasoning effort: high |
| sonar-deep-research | 128K | Long-running research |

### Response Quirks
- Cost returned in `usage.cost.total_cost` (not calculated from tokens)
- Streaming final chunk has `object: "chat.completion.done"` with full usage
- SSE format: `data: {json}` lines, ends with `data: [DONE]`

### Known Behaviors
- Models may refuse arbitrary phrase requests ("Reply with exactly X")
- Use factual questions for reliable test assertions (e.g., "What is 2+2?")

## Provider Integration Patterns

### Adding New Provider Checklist
1. types.ts - add to provider union + KnownModelName
2. config.ts - add MODEL_CONFIGS entries
3. {provider}.ts - create client (buildMessages, parseResponse, stream)
4. client.ts - add routing by `knownConfig?.provider`
5. run.ts - add hasXxxKey, key resolution, base URL, providerKeyMissing check
6. runOptions.ts - exclude from OPENAI_BASE_URL inheritance
7. engine.ts - recognize provider key for api engine selection

### Routing by Config vs Prefix
- Use `knownConfig?.provider === 'xxx'` for known models
- Prefix checks (e.g., `startsWith('sonar')`) catch unknown variants incorrectly
- Unknown variants should fall through to OpenRouter, not provider-specific endpoints

### Cost Handling
- Some APIs return cost directly (`_upstream_cost_usd`)
- Prefer upstream cost over calculated cost when available
- Store as internal field, check in run.ts before calculating

## Local Development Setup

### Switching to Local Build
```bash
pnpm build           # Build local changes
npm link             # Link globally (pnpm link --global needs PNPM_HOME)
brew unlink oracle   # Remove homebrew version from PATH
```

### Reverting to Official
```bash
npm unlink -g @steipete/oracle
brew link oracle
```

### Environment Variables
- Secrets stored in `~/Repos/dotfiles/config/zsh/secrets`
- Source with `source ~/Repos/dotfiles/config/zsh/secrets`
- Claude shell doesn't auto-source zshrc; export keys explicitly or source secrets file
