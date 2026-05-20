#!/bin/bash
# Push streaming/ into AnEntrypoint/assets in chunks of N dirs per commit.
# Avoids HTTP 408 timeouts that hit when uploading 2GB in a single push.
set -e
cd "$(dirname "$0")/.."

BATCH=${BATCH:-100}
mapfile -t DIRS < <(ls streaming/ | sort)
TOTAL=${#DIRS[@]}
echo "[batch-push] $TOTAL dirs, batch=$BATCH"

# Track which ones are already on the remote so we can resume.
git fetch origin master --quiet
PUSHED=$(git ls-tree -r origin/master --name-only 2>/dev/null | grep -c '^streaming/' || echo 0)
echo "[batch-push] $PUSHED streaming files already on remote"

i=0
batch_idx=0
while [ $i -lt $TOTAL ]; do
  batch_idx=$((batch_idx + 1))
  end=$((i + BATCH))
  if [ $end -gt $TOTAL ]; then end=$TOTAL; fi
  echo "[batch-push] batch $batch_idx: streaming/${DIRS[$i]} .. streaming/${DIRS[$((end-1))]}"
  for ((j=i; j<end; j++)); do
    git add "streaming/${DIRS[$j]}" 2>/dev/null
  done
  # If batch_idx==1, also add the manifest + scripts so they land alongside.
  if [ $batch_idx -eq 1 ]; then
    git add manifest.json manifest.baked.json scripts/build-baked-manifest.mjs
  fi
  if git diff --cached --quiet; then
    echo "[batch-push]   nothing to add (already tracked), skip"
  else
    git commit -m "Streaming bakes batch $batch_idx" >/dev/null
    echo "[batch-push]   pushing batch $batch_idx..."
    if ! git push 2>&1 | tail -3; then
      echo "[batch-push] PUSH FAILED at batch $batch_idx — last commit kept locally, retry by re-running"
      exit 1
    fi
  fi
  i=$end
done
echo "[batch-push] DONE"
