#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <iterations> [model]"
  echo "  model defaults to: opus"
  exit 1
fi

iterations="$1"
model="${2:-opus}"

# Resolve script location and project root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# jq filters for streaming output
stream_text='select(.type == "assistant").message.content[]? | select(.type == "text").text // empty | gsub("\n"; "\r\n") | . + "\r\n\n"'
final_result='select(.type == "result").result // empty'

prompt=$(cat "$SCRIPT_DIR/PROMPT_build.md")
cd "$PROJECT_ROOT"

for ((i=1; i<=iterations; i++)); do
  echo "Iteration $i"
  echo "--------------------------------"

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
    echo "Sprint complete after $i iterations."
    terminal-notifier -message "Sprint complete" -title "ralph" 2>/dev/null || true
    exit 0
  fi
done

echo "Reached $iterations iterations without completion."
