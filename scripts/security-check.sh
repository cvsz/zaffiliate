#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
status=0

echo "security-check: dependency audit"
npm audit --omit=dev --audit-level=high || status=1

echo "security-check: tracked secret material"
if git ls-files | grep -E '(^|/)(\.env$|secrets/|.*\.(pem|key|p12|pfx))$'; then
  echo "security-check: tracked secret paths detected" >&2
  status=1
fi

echo "security-check: high-signal secret patterns"
set +e
grep -RInE '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,})' --exclude-dir=.git --exclude-dir=node_modules --exclude='*.md' .
[ $? -eq 1 ] && echo "security-check: no findings" || { echo "security-check: findings above" >&2; status=1; }
set -e

echo "security-check: container runtime user"
user_line="$(grep -E '^[[:space:]]*USER[[:space:]]' Dockerfile | tail -1 | awk '{print $2}')"
if [ -n "$user_line" ] && [ "$user_line" != "root" ] && [ "$user_line" != "0" ]; then
  echo "security-check: Dockerfile runs as ${user_line} (non-root OK)"
else
  echo "security-check: Dockerfile must declare a non-root USER" >&2
  status=1
fi

[ "$status" -eq 0 ] && echo "security-check: PASS" || echo "security-check: FAIL" >&2
exit "$status"
