#!/bin/bash
set -e

model="${1:-opus}"

# Resolve script location and project root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# jq filters for streaming output
stream_text='select(.type == "assistant").message.content[]? | select(.type == "text").text // empty | gsub("\n"; "\r\n") | . + "\r\n\n"'
final_result='select(.type == "result").result // empty'

prompt=$(cat "$SCRIPT_DIR/PROMPT_build.md")
cd "$PROJECT_ROOT"

tmpfile=$(mktemp)
trap "rm -f $tmpfile" EXIT

claude --permission-mode acceptEdits --model "$model" \
  --verbose \
  --print \
  --output-format stream-json \
  -p "$prompt" \
| grep --line-buffered '^{' \
| tee "$tmpfile" \
| jq --unbuffered -rj "$stream_text"

result=$(jq -r "$final_result" "$tmpfile")

if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
  echo "Sprint complete."
fi
