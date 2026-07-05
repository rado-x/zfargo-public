#!/usr/bin/env bash
# One-shot watcher: when GitHub Pages issues the TLS cert for public.zfargo.com,
# enable https_enforced, confirm to Nathaniel, and self-remove from cron.
# Created 2026-07-04 after shipping public.zfargo.com/daysay via GitHub Pages.
set -euo pipefail
GHT=$(grep -oE 'github_pat_[A-Za-z0-9_]+' /home/rado/.config/env/gh-pat | head -1)
API="https://api.github.com/repos/rado-x/zfargo-public/pages"

https=$(curl -s -o /dev/null -w "%{http_code}" https://public.zfargo.com/ || echo 000)
if [ "$https" != "200" ]; then
  exit 0   # cert not ready yet; try again next tick
fi

# Cert is live. Enforce HTTPS (idempotent).
curl -s -X PUT -H "Authorization: Bearer $GHT" -H "Accept: application/vnd.github+json" \
  "$API" --data '{"https_enforced":true}' >/dev/null || true

/home/rado/.rado/bin/rado-zulip-send --stream "fun stuff" --topic "daysay" \
  'HTTPS is live: **https://public.zfargo.com/daysay** — cert issued, HTTP now redirects to HTTPS. Fully done.' || true

# Self-remove from crontab.
crontab -l 2>/dev/null | grep -v 'cert-watch.sh' | crontab - || true
exit 0
