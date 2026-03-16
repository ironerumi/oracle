---
title: "refactor: Rebase feat/nai-203 onto upstream/main"
type: refactor
status: active
date: 2026-03-17
linear_issue: NAI-203
---

# Rebase feat/nai-203-fix-cf-clearance-poisoning onto upstream/main

## Problem

Branch `feat/nai-203-fix-cf-clearance-poisoning` diverged from upstream/main at `abc23048`. Since then:

- **Our branch:** 50+ commits (Perplexity API, Camoufox browser engine, ppl/\* routing, cf_clearance fix)
- **Upstream:** 40 commits (biome->oxlint migration, v0.9.0, Gemini deep-think, follow-up chaining, Azure v1, dep bumps)
- **2 merge commits** in our history (from prior upstream merges)

A naive `git rebase` of 50+ commits (including merge commits) would require dozens of conflict resolution rounds. Most conflicts are cosmetic (oxlint quote migration), but 4 files have semantic overlaps.

## Strategy: Squash-Rebase

Squash our 50+ commits into **4-6 logical groups**, then rebase those onto upstream/main. This gives:

- ~4-6 conflict resolution rounds (vs 50+)
- Clean, reviewable PR history
- Merge commits naturally disappear

### Commit Groups

| #   | Scope                                                                                              | Key files                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Perplexity API + ppl/\* routing** — types, configs, client, model resolution, bare sonar removal | `src/oracle/{types,config,perplexity,client,run,gemini}.ts`, `src/cli/{engine,options,runOptions}.ts`, `bin/oracle-cli.ts`, tests |
| 2   | **Camoufox browser engine** — lifecycle, actions, executor, cookie sync, deps                      | `src/perplexity-browser/**` (new files), `src/cli/browserConfig.ts`, `package.json`                                               |
| 3   | **cf_clearance fix** — cookie filter, two-phase nav, model picker rewrite, error detection         | `src/perplexity-browser/{index,cookieFilter,actions/*}.ts`, tests                                                                 |
| 4   | **Docs & config** — README, CLAUDE.md, plans, brainstorms                                          | `README.md`, `.claude/CLAUDE.md`, `docs/**`                                                                                       |

Groups 1 (API) and former Group 3 (ppl-routing) are merged because they modify the same files (`types.ts`, `engine.ts`, `options.ts`, `runOptions.ts`). Splitting them would require hunk-level staging with no real review benefit.

## Conflict Analysis (13 files)

### Trivial (cosmetic / non-overlapping) — 7 files

| File                              | Nature                                                            | Resolution                       |
| --------------------------------- | ----------------------------------------------------------------- | -------------------------------- |
| `src/cli/engine.ts`               | Upstream: oxlint quotes only. Ours: additive logic                | Take ours, apply quote style     |
| `src/cli/options.ts`              | Upstream: oxlint quotes. Ours: REMOVED_SONAR + ppl/\* passthrough | Take ours, apply quote style     |
| `src/oracle/gemini.ts`            | Upstream: 3.1-pro alias. Ours: additive                           | Take both                        |
| `src/oracle/types.ts`             | Upstream: gpt-5.4/gemini-3.1. Ours: ppl/\* models                 | Take both (union type additions) |
| `tests/cli/browserConfig.test.ts` | Upstream: gpt-5.4 tests. Ours: new Perplexity describe block      | Take both                        |
| `bin/oracle-cli.ts`               | Upstream: quote migration. Ours: Perplexity imports + routing     | Take ours, apply quote style     |
| `package.json`                    | Upstream: v0.9.0, oxlint, dep bumps. Ours: camoufox deps          | Take both, merge deps            |

### Semantic (overlapping logic) — 4 files

| File                       | Nature                                                                                                             | Resolution                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `src/cli/browserConfig.ts` | Both modify BROWSER_MODEL_LABELS array + buildBrowserConfig                                                        | Keep upstream's gpt-5.4/deep-think entries + our Perplexity spread. Keep our `isPplModel` check in buildBrowserConfig |
| `src/cli/runOptions.ts`    | Upstream: gemini-3.1 API-only check, maxFileSizeBytes. Ours: early model resolution, Perplexity base URL exclusion | Integrate both — our early model resolution goes first, then upstream's gemini check, then Perplexity base URL        |
| `src/oracle/client.ts`     | Upstream: proxy detection + Azure routing. Ours: Perplexity client factory                                         | Perplexity routing BEFORE proxy override (Perplexity has its own SDK, must not be captured by proxy logic)            |
| `src/oracle/run.ts`        | Upstream: follow-up, Azure, file size. Ours: PERPLEXITY_API_KEY + base URL                                         | Add Perplexity to the provider key chain. Keep our no-OpenRouter-fallback logic                                       |

### Auto-regenerate — 2 files

| File             | Resolution                                                                         |
| ---------------- | ---------------------------------------------------------------------------------- |
| `pnpm-lock.yaml` | Accept upstream's, run `pnpm install` after resolving package.json                 |
| `README.md`      | Manual merge — keep upstream's follow-up/Gemini sections + our Perplexity examples |

## Execution Steps

### Phase 0: Backup

```bash
git branch backup/nai-203-pre-rebase
```

### Phase 1: Apply full diff onto upstream/main

```bash
# Start from upstream/main
git checkout -b feat/nai-203-rebase upstream/main

# Apply our cumulative diff (three-way merge for conflict markers)
git diff upstream/main...feat/nai-203-fix-cf-clearance-poisoning | git apply --3way
```

This stages everything in one pass. All 13 conflicts surface here. Resolve them per the Conflict Analysis tables above, then verify the working tree compiles before structuring commits.

**Conflict resolution priorities:**

- `client.ts`: Perplexity routing BEFORE upstream's proxy override
- `run.ts`: Perplexity in provider key chain AFTER upstream's follow-up logic
- `runOptions.ts`: our early model resolution first, then upstream's gemini-3.1 check
- `browserConfig.ts`: upstream's gpt-5.4/deep-think entries, then our Perplexity spread

### Phase 2: Structure commits via selective staging

After all conflicts are resolved (everything in working tree, nothing staged):

```bash
# Group 1: API + ppl/* routing
git add src/oracle/{types,config,perplexity,client,run,gemini,modelResolver}.ts \
        src/cli/{engine,options,runOptions}.ts bin/oracle-cli.ts \
        tests/{engine,runOptions}.test.ts tests/cli/options.test.ts
git commit -m "feat: Perplexity API integration + ppl/* model routing"

# Group 2: Camoufox browser engine
git add src/perplexity-browser/ src/cli/browserConfig.ts package.json \
        tests/cli/browserConfig.test.ts tests/perplexity-browser/
git commit -m "feat: Camoufox browser engine for Perplexity"

# Group 3: cf_clearance fix (already staged files from perplexity-browser/ are committed;
#           this catches cookieFilter, two-phase nav changes, model picker rewrite)
git add -A src/perplexity-browser/ tests/perplexity-browser/
git commit -m "fix: two-phase navigation to prevent cf_clearance poisoning"

# Group 4: Docs & config
git add README.md .claude/CLAUDE.md .gitignore docs/ scripts/
git commit -m "docs: Perplexity integration docs, plans, brainstorms"
```

**Note:** If a file has changes spanning multiple groups (rare — most files cleanly belong to one group), use `git add -p <file>` for hunk-level staging.

### Phase 3: Lint, format, test

```bash
# Auto-fix formatting to match upstream's oxlint+oxfmt (replaces biome)
pnpm install                    # regenerate pnpm-lock.yaml with our new deps
pnpm exec oxfmt --write src/ tests/ bin/   # only our files, not all of repo
pnpm run lint                   # oxlint — may surface lint errors beyond formatting
pnpm run typecheck
pnpm test
```

If oxfmt/oxlint produce changes, amend the relevant commit (not a separate "fix lint" commit).

**Scope control:** Only run `oxfmt --write` on directories we touched (`src/`, `tests/`, `bin/`), not the entire repo. This prevents reformatting upstream files and creating phantom diffs.

### Phase 4: Replace branch

```bash
pnpm test && pnpm run lint && pnpm run typecheck

# Force-update the feature branch
git branch -f feat/nai-203-fix-cf-clearance-poisoning feat/nai-203-rebase
git checkout feat/nai-203-fix-cf-clearance-poisoning
git branch -d feat/nai-203-rebase

# Force-push to origin
git push origin feat/nai-203-fix-cf-clearance-poisoning --force-with-lease
```

## Risks

| Risk                                                       | Mitigation                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Patch apply fails (wrong context from oxlint reformatting) | `--3way` falls back to 3-way merge; if that fails, apply full diff manually file-by-file |
| oxlint lint errors (not just formatting)                   | Budget time for non-trivial lint fixes; oxlint rules differ from biome                   |
| Lock file regeneration changes dep versions                | Pin to upstream's lock first, then add our deps                                          |
| Perplexity routing breaks with upstream's proxy override   | Test: `ppl/sonar` with PERPLEXITY_API_KEY must NOT route through proxy                   |
| Backup branch forgotten                                    | `backup/nai-203-pre-rebase` preserved until PR merged                                    |

## Acceptance Criteria

- [ ] Branch rebased onto upstream/main (linear history, no merge commits)
- [ ] 4 logical commits (API+routing, Camoufox, cf-fix, docs)
- [ ] `pnpm test` passes
- [ ] `pnpm run lint` passes (oxlint, not biome)
- [ ] `pnpm run typecheck` passes
- [ ] All 13 conflict files correctly integrated
- [ ] Live validation: `oracle "test" -m ppl/sonar` works (API mode)
- [ ] Live validation: `oracle "test" -m ppl/claude-sonnet-4.6 --engine browser` works (browser mode)
- [ ] `backup/nai-203-pre-rebase` branch exists

## Sources

- [Plan: cf_clearance fix](docs/plans/2026-03-13-fix-perplexity-cookie-cloudflare-poisoning-plan.md)
- [Plan: ppl/\* routing](docs/plans/2026-03-09-feat-ppl-prefix-model-routing-plan.md)
- [Plan: Camoufox headless](docs/plans/2026-03-09-feat-camoufox-headless-perplexity-plan.md)
- Upstream changelog: v0.9.0 (biome->oxlint, Gemini deep-think, follow-up, Azure v1)
