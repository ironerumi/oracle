# Root Cause Catalog

## Skill Execution Failures
| ID | Pattern | Prevention | Occ | Latest |
|----|---------|------------|-----|--------|
| SE-1 | Skill reference section ignored | Always read reference files before executing skill | 1 | 2026-02 |
| SE-2 | Pseudocode interpreted as "do it myself" | Look for explicit tool/command invocations in references | 1 | 2026-02 |

## Test Flakiness
| ID | Pattern | Prevention | Occ | Latest |
|----|---------|------------|-----|--------|
| TF-1 | LLM tests use arbitrary phrase requests | Use factual questions with deterministic answers | 1 | 2026-02 |

## Environment Issues
| ID | Pattern | Prevention | Occ | Latest |
|----|---------|------------|-----|--------|
| EI-1 | Env vars not in Claude shell (need source ~/.zshrc) | Source secrets file directly: `source ~/Repos/dotfiles/config/zsh/secrets` | 2 | 2026-02 |
| EI-2 | npm link shadowed by homebrew in PATH | Run `brew unlink <pkg>` before using npm linked version | 1 | 2026-02 |

## Archive Failures
| ID | Pattern | Prevention | Occ | Latest |
|----|---------|------------|-----|--------|
| AF-1 | Template files archived with sprint artifacts | Archive only exploration/spec/plan.md, not PROMPT_build.md or ralph scripts | 1 | 2026-02 |
| AF-2 | Tag left at wrong commit after follow-up fixes | Tag AFTER all commits done; use `git tag -f` to move if needed | 1 | 2026-02 |

## Skill Evolution Failures
| ID | Pattern | Prevention | Occ | Latest |
|----|---------|------------|-----|--------|
| EV-1 | Skill evolved but not released | After editing plugin skill: bump version, push, run `claude plugin update` | 1 | 2026-02 |
