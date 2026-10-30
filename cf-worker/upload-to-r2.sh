#!/usr/bin/env bash
# Uploads the protected files (portfolio PDF + all cert images) to the R2
# bucket this worker reads from. Run this from the repo root, after
# `wrangler login` and after creating the bucket (see README.md).
#
# Usage: bash cf-worker/upload-to-r2.sh

set -euo pipefail

BUCKET="choihanmin-protected"

wrangler r2 object put "${BUCKET}/portfolio-locked.pdf" --file=files/portfolio-locked.pdf --remote

for n in $(seq -w 1 45); do
  src="images/web/cert${n}.jpg"
  if [ -f "$src" ]; then
    wrangler r2 object put "${BUCKET}/cert${n}.jpg" --file="$src" --remote
  else
    echo "WARNING: missing $src" >&2
  fi
done

echo "Done. Uploaded portfolio-locked.pdf + cert01..cert45.jpg to r2://${BUCKET}/"
