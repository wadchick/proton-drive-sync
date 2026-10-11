#!/usr/bin/env bash
# Local CI gate: typecheck, lint, unit, e2e, and fault-injection tests, then a rebuild
# that must reproduce every committed dist/cli output byte for byte.
# Any failure blocks. Mirrors .github/workflows/ci.yml.
# Run under Node 24.x to match GitHub Actions (`node -v` should print v24.*).
set -euo pipefail
cd "$(dirname "$0")/.."
npm run typecheck
npm run lint
npm run test -- --project unit
npm run test -- --project e2e --passWithNoTests
npm run test -- --project fault --passWithNoTests
npm run build
git diff --exit-code -- dist
test -z "$(git status --porcelain --untracked-files=all -- dist)"
echo "CI gate passed"
