#!/usr/bin/env bash
set -euo pipefail

echo "[1/3] Build"
npm run build

echo "[2/3] Deploy"
npm run deploy

echo "[3/3] Suggested smoke tests"
echo "- Open home page"
echo "- Check /api"
echo "- Check /api/recommend/options"
echo "- Check one station detail page"
