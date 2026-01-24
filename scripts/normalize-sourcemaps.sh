#!/bin/bash
# Normalize absolute paths in .d.ts.map files to relative paths
# This ensures source maps are consistent across different build environments

set -e

find dist -name "*.d.ts.map" -type f | while read -r file; do
  # Replace absolute paths with relative paths
  # Pattern: file:///absolute/path/to/repo/src/ -> file:///src/
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS sed requires -i '' for in-place editing
    sed -i '' 's|"file:///[^"]*/src/|"file:///src/|g' "$file"
  else
    # Linux sed uses -i without extension
    sed -i 's|"file:///[^"]*/src/|"file:///src/|g' "$file"
  fi
done
