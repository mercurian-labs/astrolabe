#!/usr/bin/env bash
# Sets up people and sign-ins on a local cloud stack (infra/cloud under
# `alchemy dev`), so walks don't need hand-written SQL and curl.
#
# Usage:
#   cloud-kit.sh person <email> [name]        Create the account if missing, approve it off
#                                             the waitlist, and print a bearer session token.
#   cloud-kit.sh approve <user-code> <email>  Approve a device sign-in code as <email>.
#   cloud-kit.sh approve-latest <client> <email>
#                                             Approve the newest pending code whose client id
#                                             starts with <client> (astrolabe-web,
#                                             astrolabe-desktop, astrolabe-mobile).
#   cloud-kit.sh mail [email]                 Print the newest emails the stack sent (recipient,
#                                             subject, first body line, which holds sign-in codes).
#   cloud-kit.sh write <email> <write> '<json input>'
#                                             Make a workspace write as <email>, e.g.
#                                             write ben@x acceptInvitation '{"invitationId":"…"}'.
#                                             Writes are listed in packages/shared/src/mercurianWorkspaces.ts.
#   cloud-kit.sh invitations <email>          List pending invitations addressed to <email> (ids).
#
# Environment:
#   CLOUD_API_URL  The API's URL from `alchemy dev` ("Api ready at …"). Required.
#   CLOUD_DB_URL   Defaults to the stack's Postgres on CLOUD_POSTGRES_PORT (54341).
#
# Tokens are deterministic per email, so rerunning `person` returns the same one.
set -euo pipefail

api="${CLOUD_API_URL:?set CLOUD_API_URL to the API URL alchemy dev printed}"
db="${CLOUD_DB_URL:-postgresql://mercurian:mercurian@localhost:${CLOUD_POSTGRES_PORT:-54341}/mercurian_cloud}"

sql() { psql "$db" -v ON_ERROR_STOP=1 -At "$@"; }
slug() { printf '%s' "$1" | tr -c 'a-zA-Z0-9' '-' | tr 'A-Z' 'a-z'; }
token_for() { printf 'walk%s' "$(printf '%s' "$1" | shasum | cut -c1-28)"; }

ensure_person() {
  local email="$1" name="${2:-${1%%@*}}" id token
  id="walk-$(slug "${email%%@*}")"
  token="$(token_for "$email")"
  sql -v email="$email" -v name="$name" -v id="$id" -v token="$token" >/dev/null <<'SQL'
INSERT INTO auth.user (id, name, email, email_verified, access)
VALUES (:'id', :'name', :'email', true, 'approved')
ON CONFLICT (email) DO UPDATE SET access = 'approved';
INSERT INTO auth.session (id, token, user_id, expires_at, updated_at)
SELECT 'walk-session-' || u.id, :'token', u.id, now() + interval '7 days', now()
FROM auth.user u WHERE u.email = :'email'
ON CONFLICT (id) DO UPDATE SET expires_at = excluded.expires_at, token = excluded.token;
SQL
  printf '%s\n' "$token"
}

approve() {
  local code="$1" email="$2" token
  token="$(ensure_person "$email")"
  # Better Auth only approves a code a signed-in session has looked up first.
  curl -fsS -o /dev/null -H "authorization: Bearer $token" -H "origin: $api" \
    "$api/api/auth/device?user_code=$code"
  curl -fsS -X POST -H "authorization: Bearer $token" -H "content-type: application/json" \
    -H "origin: $api" "$api/api/auth/device/approve" -d "{\"userCode\":\"$code\"}"
  echo
}

case "${1:-}" in
  person) ensure_person "${2:?email}" "${3:-}" ;;
  approve) approve "${2:?user code}" "${3:?email}" ;;
  approve-latest)
    # psql substitutes :'client' only in input it reads, not in -c.
    code="$(sql -v client="${2:?client id prefix}%" <<<"SELECT user_code FROM auth.device_code
      WHERE status = 'pending' AND expires_at > now() AND client_id LIKE :'client'
      ORDER BY expires_at DESC LIMIT 1")"
    [[ -n "$code" ]] || { echo "no pending code for client $2" >&2; exit 1; }
    echo "approving $code"
    approve "$code" "${3:?email}"
    ;;
  write)
    token="$(ensure_person "${2:?email}")"
    curl -sS -X POST -H "authorization: Bearer $token" -H "content-type: application/json" \
      -H "origin: $api" "$api/api/workspaces/write" \
      -d "{\"write\":\"${3:?write name}\",\"input\":${4:?json input}}"
    echo
    ;;
  invitations)
    sql -v email="${2:?email}" <<<"SELECT i.id || '  ' || o.name || '  (' || i.role || ')'
      FROM auth.invitation i JOIN auth.organization o ON o.id = i.organization_id
      WHERE lower(i.email) = lower(:'email') AND i.status = 'pending' AND i.expires_at > now()"
    ;;
  mail)
    curl -fsS "$api/dev/mailbox" | awk -v who="${2:-}" '
      /<strong>/ { gsub(/.*<strong>|<\/strong>.*/, ""); to = $0 }
      /<h2>/ { gsub(/.*<h2>|<\/h2>.*/, ""); subject = $0 }
      /<pre>/ { gsub(/.*<pre>/, ""); gsub(/<\/pre>.*/, ""); body = $0
        if (who == "" || index(to, who)) { print to "\n  " subject "\n  " body; n++ }
        if (n >= 8) exit }'
    ;;
  *) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
