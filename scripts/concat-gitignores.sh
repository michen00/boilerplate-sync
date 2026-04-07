#!/usr/bin/env bash

set -euo pipefail # Exit on errors, unbound vars, and failed pipelines

SCRIPT_NAME=$(basename "$0")

# Track mktemp paths so INTERRUPT/ERR can remove leftovers (trap EXIT).
_TMP_FILES=()
mktemp_track() {
  local t
  t=$(mktemp)
  _TMP_FILES+=("$t")
  echo "$t"
}

_cleanup_mktemp() {
  local f
  for f in "${_TMP_FILES[@]}"; do
    rm -f "$f"
  done
}
trap _cleanup_mktemp EXIT

usage() {
  cat << EOF
Usage: $SCRIPT_NAME [--output <output_file>] [<input_file>]

Concatenate multiple .gitignore templates into a single file by fetching URLs from
stdin, a file, or built-in defaults.

Inputs:
  stdin            Read URLs from standard input when piped or redirected.
  <input_file>     Optional file containing one URL per line. Supports section headers
                   with lines starting "## ". A single argument of .gitignore or
                   path/to/.gitignore is treated as the output path (relative to repo
                   root) and default URLs are used.

Options:
  --output <file>  Destination file name. Defaults to .gitignore.
  -h, --help       Show this help message and exit.

Examples:
  cat urls.txt | $SCRIPT_NAME
  cat urls.txt | $SCRIPT_NAME --output custom.output.gitignore
  $SCRIPT_NAME
  $SCRIPT_NAME urls.txt
  $SCRIPT_NAME urls.txt --output custom.output.gitignore
  $SCRIPT_NAME my-project/.gitignore
EOF
  exit "${1:-0}"
}

# Hardcoded default entries (used if no input is provided). Section headers
# (## Title) appear in the generated .gitignore header; URLs are fetched.
DEFAULT_ENTRIES=(
  "## Language / runtime / ecosystem"
  "https://raw.githubusercontent.com/github/gitignore/main/Node.gitignore"

  "## IDEs / editors"
  "https://raw.githubusercontent.com/github/gitignore/main/Global/Cloud9.gitignore"
  "https://raw.githubusercontent.com/github/gitignore/main/Global/Cursor.gitignore"
  "https://raw.githubusercontent.com/github/gitignore/main/Global/Eclipse.gitignore"
  "https://raw.githubusercontent.com/github/gitignore/main/Global/Emacs.gitignore"
  "https://raw.githubusercontent.com/github/gitignore/main/Global/JetBrains.gitignore"
  "https://raw.githubusercontent.com/github/gitignore/main/Global/SublimeText.gitignore"
  "https://raw.githubusercontent.com/github/gitignore/main/Global/Vim.gitignore"
  "https://raw.githubusercontent.com/github/gitignore/main/Global/VisualStudioCode.gitignore"
  "https://raw.githubusercontent.com/github/gitignore/main/VisualStudio.gitignore"

  "## OS / platform"
  "https://raw.githubusercontent.com/github/gitignore/main/Global/Linux.gitignore"
  "https://raw.githubusercontent.com/github/gitignore/main/Global/macOS.gitignore"
  "https://raw.githubusercontent.com/github/gitignore/main/Global/Windows.gitignore"

  "## Tools / documents / misc artifacts"
  "https://raw.githubusercontent.com/github/gitignore/main/Global/Archives.gitignore"
  "https://raw.githubusercontent.com/github/gitignore/main/Global/Backup.gitignore"
  "https://raw.githubusercontent.com/github/gitignore/main/Global/Diff.gitignore"
  "https://raw.githubusercontent.com/github/gitignore/main/Global/MicrosoftOffice.gitignore"
  "https://raw.githubusercontent.com/github/gitignore/main/Global/Patch.gitignore"
)

# Default output file
OUTPUT_FILE=".gitignore"

# Variables
INPUT_FILE=""
ENTRIES=()
URLS=()

add_entry() {
  local line="$1"
  local trimmed="$line"
  trimmed="${trimmed#"${trimmed%%[![:space:]]*}"}"
  trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
  [[ -z "$trimmed" ]] && return 0
  if [[ "$trimmed" == "## "* ]]; then
    ENTRIES+=("$trimmed")
  elif [[ "$trimmed" == \#* ]]; then
    return 0
  else
    ENTRIES+=("$trimmed")
    URLS+=("$trimmed")
  fi
}

parse_input_stream() {
  local line=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    add_entry "$line"
  done
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      if [[ -z ${2:-} ]]; then
        echo "Error: --output requires a file name." >&2
        usage 1
      fi
      OUTPUT_FILE="$2"
      shift 2
      ;;
    -h | --help)
      usage 0
      ;;
    --*)
      echo "Unknown option: $1" >&2
      usage 1
      ;;
    *)
      if [[ -z $INPUT_FILE ]]; then
        INPUT_FILE="$1"
        shift
      else
        echo "Error: Multiple input files specified: '$INPUT_FILE' and '$1'" >&2
        usage 1
      fi
      ;;
  esac
done

# If the only positional argument looks like an output path (e.g. .gitignore or
# my-project/.gitignore), treat it as --output and use default URLs. Resolve relative
# to repo root (parent of script dir) so the same path is used regardless of cwd.
if [[ -n $INPUT_FILE && ($INPUT_FILE == .gitignore || $INPUT_FILE == */.gitignore) && "$OUTPUT_FILE" == ".gitignore" ]]; then
  SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
  REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
  OUTPUT_FILE="$REPO_ROOT/$INPUT_FILE"
  INPUT_FILE=""
fi

# Determine the source of URLs.
# Priority: explicit input file > stdin (pipe or redirection) > defaults.
if [[ -n $INPUT_FILE ]]; then
  if [[ -f $INPUT_FILE ]]; then
    parse_input_stream < "$INPUT_FILE"
  else
    echo "Input file not found: $INPUT_FILE" >&2
    exit 1
  fi
elif ! [ -t 0 ]; then
  parse_input_stream
else
  for entry in "${DEFAULT_ENTRIES[@]}"; do
    add_entry "$entry"
  done
fi

if [[ ${#URLS[@]} -eq 0 ]]; then
  echo "No URLs provided." >&2
  exit 1
fi

# Calculate the length of the longest header line (for ruler)
MAX_HEADER_LINE_LENGTH=0
for entry in "${ENTRIES[@]}"; do
  if [[ "$entry" == "## "* ]]; then
    HEADER_LINE="# ${entry#\#\# }"
  else
    HEADER_LINE="# - $entry"
  fi
  if [[ ${#HEADER_LINE} -gt $MAX_HEADER_LINE_LENGTH ]]; then
    MAX_HEADER_LINE_LENGTH=${#HEADER_LINE}
  fi
done

# Create the comment header
HEADER_LENGTH=$MAX_HEADER_LINE_LENGTH
HEADER=$(printf '#%.0s' $(seq 1 "$HEADER_LENGTH"))

OUTPUT_DIR=$(dirname "$OUTPUT_FILE")
if [[ ! -d "$OUTPUT_DIR" ]]; then
  mkdir -p "$OUTPUT_DIR" || {
    echo "Error: cannot create directory '$OUTPUT_DIR' for output file." >&2
    exit 1
  }
fi

{
  echo "$HEADER"
  echo "# This .gitignore is composed of the following templates:"
  for entry in "${ENTRIES[@]}"; do
    if [[ "$entry" == "## "* ]]; then
      echo "# ${entry#\#\# }"
    else
      echo "# - $entry"
    fi
  done
  echo "$HEADER"
  echo ""
} > "$OUTPUT_FILE"

echo "Initialized output file with header: $OUTPUT_FILE"

# Convert blob URL to raw URL if needed (user-supplied input may use blob format)
to_raw_url() {
  local u="$1"
  if [[ "$u" == *"/blob/"* ]]; then
    echo "$u" | sed 's|github.com|raw.githubusercontent.com|; s|/blob||'
  else
    echo "$u"
  fi
}

# Loop through URLs
for url in "${URLS[@]}"; do
  echo "Processing URL: $url"

  RAW_URL=$(to_raw_url "$url")
  if [[ "$url" != "$RAW_URL" ]]; then
    echo "Converted to raw URL: $RAW_URL"
  fi

  # Extract the filename (e.g., Python.gitignore)
  FILENAME=$(basename "$url")

  # Calculate dynamic block length
  PREFACE_LENGTH=$((${#FILENAME} + 4)) # Length of " # FILENAME # "
  PREFACE=$(printf '#%.0s' $(seq 1 $PREFACE_LENGTH))

  # Preface block
  {
    echo "$PREFACE"
    echo "# $FILENAME #"
    echo "$PREFACE"
    echo ""
  } >> "$OUTPUT_FILE"

  # Fetch content (curl -f: fail on HTTP 4xx/5xx); stream to output to avoid huge vars
  TMP_CURL=$(mktemp_track)
  if ! curl -f -s "$RAW_URL" -o "$TMP_CURL"; then
    echo "Failed to fetch: $RAW_URL" >&2
    exit 1
  fi

  if [[ ! -s "$TMP_CURL" ]]; then
    echo "Empty content from: $RAW_URL" >&2
    exit 1
  fi

  # Reject HTML (e.g. GitHub error page) using a small prefix read
  content_prefix=$(head -c 256 "$TMP_CURL" | tr -d '\0')
  # Patterns use literal '<' / '<!'; store in vars so [[ =~ ]] does not parse '<' as redirection
  _html_doctype_re='^[[:space:]]*<![[:space:]]*[Dd][Oo][Cc][Tt][Yy][Pp][Ee]'
  _html_root_re='^[[:space:]]*<[Hh][Tt][Mm][Ll]'
  if [[ "$content_prefix" =~ $_html_doctype_re ]] ||
    [[ "$content_prefix" =~ $_html_root_re ]]; then
    echo "Received HTML instead of gitignore content from: $RAW_URL" >&2
    exit 1
  fi

  echo "Appending content from: $RAW_URL"
  awk '{ gsub(/\r$/, ""); gsub(/[ \t]+$/, ""); print }' "$TMP_CURL" >> "$OUTPUT_FILE"
  rm -f "$TMP_CURL"
  printf '\n# End of %s\n\n' "$url" >> "$OUTPUT_FILE"
done

# Normalize line endings in the final output file
NORMALIZE_TMP=$(mktemp_track)
tr -d '\r' < "$OUTPUT_FILE" > "$NORMALIZE_TMP" || exit 1
mv "$NORMALIZE_TMP" "$OUTPUT_FILE"

# Ensure single trailing newline (collapse any trailing blank lines into exactly one newline)
if command -v perl > /dev/null 2>&1; then
  perl -0777 -pi -e 's/\n*\z/\n/' "$OUTPUT_FILE"
elif command -v python3 > /dev/null 2>&1; then
  python3 -c '
import pathlib, sys
p = pathlib.Path(sys.argv[1])
data = p.read_text()
p.write_text(data.rstrip("\r\n") + "\n")
' "$OUTPUT_FILE"
elif [[ "$(uname -s)" == Darwin ]]; then
  sed -i '' -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$OUTPUT_FILE" # spellchecker:disable-line
else
  sed -i ':a;/^\n*$/{$d;N;ba;}' "$OUTPUT_FILE" # spellchecker:disable-line
fi

# Add additional ignore patterns
cat >> "$OUTPUT_FILE" << EOF

# Claude user-specific settings
.claude/settings.local.json

# Cursor rules
.cursor/rules/

# OpenSpec scaffolding
.claude/commands/opsx/*.md
.claude/skills/openspec-*/SKILL.md
.codex/skills/openspec-*/SKILL.md
.cursor/commands/opsx-*.md
.cursor/skills/openspec-*/SKILL.md
.github/prompts/opsx-*.prompt.md
.github/skills/openspec-*/SKILL.md

# spec-kit scaffolding
.agents/skills/speckit-*/SKILL.md
.claude/commands/speckit.*.md
.cursor/commands/speckit.*.md
.github/agents/speckit.*.agent.md
.github/prompts/speckit.*.prompt.md
.specify/init-options.json
.specify/scripts/bash/*.sh
.specify/templates/*.md

# Directory for temporary files marked for deletion
.delete-me/

# Track dist/ for GitHub Actions (ncc bundle; committed in this repo). Templates may
# include dist rules above; these negations win when listed after those blocks.
!dist/
!dist/**

!.gitkeep
EOF

echo "Combined .gitignore created as $OUTPUT_FILE"
