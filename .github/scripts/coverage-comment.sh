#!/usr/bin/env bash
# Parses Bun's coverage text output into a markdown table and posts as a PR comment.
# Usage: coverage-comment.sh <coverage-file>
set -euo pipefail

FILE="${1:?Usage: coverage-comment.sh <coverage-file>}"
if [ ! -f "$FILE" ]; then echo "File not found: $FILE"; exit 0; fi

# --- Extract test results (compatible with macOS + Linux grep) ---
pass=$(grep -Eo '[0-9]+ pass' "$FILE" | head -1 || echo "0 pass")
fail=$(grep -Eo '[0-9]+ fail' "$FILE" | head -1 || echo "0 fail")
ran=$(grep -Eo 'Ran [0-9]+ tests across [0-9]+ files' "$FILE" | head -1 || echo "")

# --- Build markdown ---
body="<!-- server-coverage-report -->\n"
body+="## 🧪 Server Test Coverage\n\n"

if [ "$fail" = "0 fail" ]; then
  body+="✅ **${pass}**, ${fail}"
else
  body+="❌ **${pass}**, **${fail}**"
fi
[ -n "$ran" ] && body+=" — ${ran}"
body+="\n\n"

body+="| File | Funcs | Lines | Uncovered |\n"
body+="|------|------:|------:|:-----------|\n"

# Parse only between the second and third ---- separator lines (the data rows).
# Layout: ---- / header / ---- / data rows / ----
sep_count=0
while IFS= read -r line; do
  if [[ "$line" =~ ^-{5,} ]]; then
    sep_count=$((sep_count + 1))
    continue
  fi
  # Data rows are between sep 2 and sep 3
  if [ $sep_count -lt 2 ] || [ $sep_count -ge 3 ]; then continue; fi

  # Parse pipe-delimited columns
  file=$(echo "$line" | cut -d'|' -f1 | sed 's/^ *//;s/ *$//')
  funcs=$(echo "$line" | cut -d'|' -f2 | sed 's/^ *//;s/ *$//')
  lines_pct=$(echo "$line" | cut -d'|' -f3 | sed 's/^ *//;s/ *$//')
  uncov=$(echo "$line" | cut -d'|' -f4 | sed 's/^ *//;s/ *$//')

  # Skip if we didn't get numeric data
  if ! echo "$lines_pct" | grep -qE '^[0-9]'; then continue; fi

  # Status emoji based on line coverage
  pct_int=$(echo "$lines_pct" | sed 's/\..*//')
  if [ "$pct_int" -ge 80 ] 2>/dev/null; then icon="🟢"
  elif [ "$pct_int" -ge 60 ] 2>/dev/null; then icon="🟡"
  elif [ "$pct_int" -ge 40 ] 2>/dev/null; then icon="🟠"
  else icon="🔴"
  fi

  # Truncate long uncovered line lists
  if [ ${#uncov} -gt 60 ]; then
    uncov="${uncov:0:57}..."
  fi

  if [[ "$file" == "All files" ]]; then
    body+="| ${icon} **All files** | **${funcs}** | **${lines_pct}** | |\n"
  else
    body+="| ${icon} \`${file}\` | ${funcs} | ${lines_pct} | \`${uncov}\` |\n"
  fi
done < "$FILE"

echo -e "$body"
