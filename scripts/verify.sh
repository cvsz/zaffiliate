#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "verify: syntax gate"
npm run check

echo "verify: full test suite"
npm test

echo "verify: dependency audit"
npm audit --omit=dev --audit-level=high

echo "verify: tracked secret scan"
set +e
git ls-files | grep -E '(^|/)(\.env$|secrets/|.*\.(pem|key|p12|pfx))$'
[ $? -eq 1 ] || { echo "verify: tracked secret material detected" >&2; exit 1; }
grep -RInE '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,})' --exclude-dir=.git --exclude-dir=node_modules --exclude='*.md' . 
[ $? -eq 1 ] || { echo "verify: potential secret material detected" >&2; exit 1; }
set -e

echo "verify: ALL GATES GREEN"
