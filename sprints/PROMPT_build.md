1. Study context using parallel Sonnet subagents:
   @sprints/plan.md @sprints/spec.md @CLAUDE.md @learnings.md @spec.md

2. Study @sprints/plan.md. Work on the FIRST incomplete task (marked [ ]).
   Do NOT pick your own priority. Do NOT work ahead.
   Don't assume functionality is not implemented; confirm with code search first.

3. Implement the task:
   - Follow acceptance criteria exactly
   - Run the Evidence command from plan.md to verify
   - If functionality is missing then it's your job to add it

4. If evidence fails, fix and retry. If pass:
   - Update sprints/plan.md: mark task [x]

5. Git commit with message including notes:
   'feat(TASK_ID): brief description
   - gotchas or findings here
   - blockers encountered'

RULES:

- ONLY work on ONE task per iteration
- If all tasks complete, output <promise>COMPLETE</promise>
