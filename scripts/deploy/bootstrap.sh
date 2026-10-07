#!/usr/bin/env bash
# One-time production setup for the CI/CD pipeline (Task 8.14). Idempotent: safe to re-run.
#
# Creates/links the Railway project with two services (server, facilitator) and their public domains,
# the Vercel project (Root Directory web), sets every runtime variable from the root .env, stores the
# CI secrets and variables in GitHub, then runs the first deploy and the live smoke test.
#
# Needs: `railway login`, `gh auth login`, and in the environment:
#   VERCEL_TOKEN   https://vercel.com/account/tokens
#   RAILWAY_TOKEN  Railway project token (Project → Settings → Tokens, environment "production"); the script
#                  creates the project first and stops to ask for it if missing.
# Optional: DRY_RUN=1 prints every mutating command instead of running it.
#
#   VERCEL_TOKEN=… RAILWAY_TOKEN=… bash scripts/deploy/bootstrap.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

PROJECT=${PROJECT_NAME:-cardanofish}
DRY=${DRY_RUN:-0}
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
# Preconditions (logins, tokens, DB): fatal for real runs, warnings in a dry run so the plan can still be printed.
need() { if [ "$DRY" = 1 ]; then printf '\033[33mWARN (dry run): %s\033[0m\n' "$*"; else die "$*"; fi; }
run() { if [ "$DRY" = 1 ]; then echo "[dry-run] $*" >&2; else "$@"; fi; }
# Secret values go through stdin, never argv (argv is visible in process lists and CI logs).
railway_set() { # service key value
  if [ "$DRY" = 1 ]; then echo "[dry-run] railway variable set $2 --stdin --service $1 --skip-deploys (value hidden)"; return; fi
  printf '%s' "$3" | railway variable set "$2" --stdin --service "$1" --skip-deploys >/dev/null
}
gh_secret() { # name value
  if [ "$DRY" = 1 ]; then echo "[dry-run] gh secret set $1 (value hidden)"; return; fi
  printf '%s' "$2" | gh secret set "$1" >/dev/null
}
gh_var() { run gh variable set "$1" --body "$2" >/dev/null; }

# ---------- 0. inputs ----------
say "Checking tools, logins and .env"
for c in railway vercel gh node openssl; do command -v "$c" >/dev/null || die "$c is not installed"; done
# A project token (RAILWAY_TOKEN) can't run `whoami`; `status` works with either a login or the token.
railway whoami >/dev/null 2>&1 || railway status >/dev/null 2>&1 || need "Railway CLI is logged out: run 'railway login'"
gh auth status >/dev/null 2>&1 || need "GitHub CLI is logged out: run 'gh auth login'"
[ -n "${VERCEL_TOKEN:-}" ] || need "VERCEL_TOKEN is not set (create one at https://vercel.com/account/tokens)"
[ -z "${VERCEL_TOKEN:-}" ] || vercel whoami --token "$VERCEL_TOKEN" >/dev/null 2>&1 || need "VERCEL_TOKEN is rejected by Vercel"
[ -f .env ] || die "root .env is missing (copy .env.example and fill it in)"

envval() { # read KEY from .env without sourcing it (values may contain spaces or '!')
  node -e 'const [k]=process.argv.slice(1);const l=require("fs").readFileSync(".env","utf8").split(/\r?\n/).find(x=>x.startsWith(k+"="));if(l){let v=l.slice(k.length+1);const i=v.search(/\s+#/);if(i>=0)v=v.slice(0,i);process.stdout.write(v.trim().replace(/^["\x27]|["\x27]$/g,""))}' "$1"
}
REQUIRED=(SUPABASE_DB_URL RELAYER_SECRET_KEY PLATFORM_FEE_PAY_TO ENVELOPE_X25519_PK REPORT_ED25519_PK CRE_PLATFORM_TOKEN CRE_RUNNER_TOKEN SYNTHETIC_SECRET)
OPTIONAL=(SOLANA_RPC_URL ESCROW_PROGRAM_ID PLATFORM_FEE_USDC WORLD_APP_ID WORLD_RP_ID WORLD_RP_SIGNING_KEY WORLD_ENV)
declare -A V
for k in "${REQUIRED[@]}"; do V[$k]=$(envval "$k"); [ -n "${V[$k]}" ] || die ".env has no value for $k"; done
for k in "${OPTIONAL[@]}"; do V[$k]=$(envval "$k"); done

FAC_TOKEN=$(envval FACILITATOR_TOKEN)
if [ ${#FAC_TOKEN} -lt 32 ]; then
  FAC_TOKEN=$(openssl rand -hex 32)
  if [ "$DRY" = 1 ]; then echo "FACILITATOR_TOKEN missing or short: a real run generates one and saves it to .env"; else
    # The token is hex, so it is safe inside sed and printf.
    if grep -q '^FACILITATOR_TOKEN=' .env; then sed -i "s/^FACILITATOR_TOKEN=.*/FACILITATOR_TOKEN=$FAC_TOKEN/" .env
    else printf '\nFACILITATOR_TOKEN=%s\n' "$FAC_TOKEN" >> .env; fi
    echo "FACILITATOR_TOKEN was missing or short: generated one and saved it to .env"
  fi
fi

say "Checking the production database connection"
# shellcheck disable=SC2016  # JavaScript template literal, not shell
SUPABASE_DB_URL="${V[SUPABASE_DB_URL]}" node -e '
  import("postgres").then(async ({ default: postgres }) => {
    const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, connect_timeout: 15 });
    try { await sql`select 1`; console.log("database OK"); }
    catch (e) { console.error("database connection failed:", e.message); process.exitCode = 1; }
    finally { await sql.end(); }
  });' || need "SUPABASE_DB_URL in .env does not connect. Reset the password (Supabase → Project Settings → Database) and update .env."

# ---------- 1. Railway project + services + domains ----------
say "Railway project '$PROJECT'"
if [ "$DRY" = 1 ] || ! railway status >/dev/null 2>&1; then run railway init --name "$PROJECT"; else echo "already linked: $(railway status 2>/dev/null | head -1)"; fi
existing_services() { railway status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).services?.edges||[]).map(e=>e.node.name).join(" "))}catch{console.log("")}})'; }
have=" $(existing_services) "
for s in server facilitator; do
  if [[ "$have" == *" $s "* ]]; then echo "service $s exists"; continue; fi
  run railway add --service "$s" >/dev/null
done

if [ -z "${RAILWAY_TOKEN:-}" ] && [ "$DRY" != 1 ]; then
  die "The Railway project exists now. Create a project token (Railway → $PROJECT → Settings → Tokens, environment production), then re-run with RAILWAY_TOKEN=<token>."
fi

railway_domain() { # service → https URL (creates the *.up.railway.app domain if missing)
  if [ "$DRY" = 1 ]; then echo "https://$1-dry-run.up.railway.app"; return; fi
  local d
  d=$(railway domain --service "$1" 2>&1 | grep -oE '[a-z0-9.-]+\.up\.railway\.app' | head -1 || true)
  [ -n "$d" ] || d=$(railway domain list --service "$1" --json 2>/dev/null | grep -oE '[a-z0-9.-]+\.up\.railway\.app' | head -1 || true)
  [ -n "$d" ] || die "could not get a domain for Railway service $1"
  echo "https://$d"
}
SERVER_URL=$(railway_domain server)
FAC_URL=$(railway_domain facilitator)
echo "server:      $SERVER_URL"
echo "facilitator: $FAC_URL"

# ---------- 2. Vercel project (Root Directory web) ----------
say "Vercel project '$PROJECT'"
run vercel link --yes --project "$PROJECT" --token "${VERCEL_TOKEN:-}" >/dev/null
if [ "$DRY" = 1 ]; then ORG_ID=team_dry; PROJECT_ID=prj_dry; else
  ORG_ID=$(node -p 'require("./.vercel/project.json").orgId')
  PROJECT_ID=$(node -p 'require("./.vercel/project.json").projectId')
fi
TEAM_Q=""; [[ "$ORG_ID" == team_* ]] && TEAM_Q="?teamId=$ORG_ID"
run curl -fsS -X PATCH "https://api.vercel.com/v9/projects/$PROJECT_ID$TEAM_Q" \
  -H "Authorization: Bearer ${VERCEL_TOKEN:-}" -H 'Content-Type: application/json' \
  -d '{"rootDirectory":"web","framework":"nextjs","nodeVersion":"22.x"}' -o /dev/null
if [ "$DRY" = 1 ]; then echo "[dry-run] vercel env add NEXT_PUBLIC_SERVER_URL production = $SERVER_URL"; else
  vercel env rm NEXT_PUBLIC_SERVER_URL production --yes --token "$VERCEL_TOKEN" >/dev/null 2>&1 || true
  printf '%s' "$SERVER_URL" | vercel env add NEXT_PUBLIC_SERVER_URL production --token "$VERCEL_TOKEN" >/dev/null
fi
# Production alias: <project>.vercel.app unless taken; read the real one from the API after the first deploy.
WEB_URL="https://$PROJECT.vercel.app"

# ---------- 3. Railway variables ----------
say "Railway variables"
for k in "${REQUIRED[@]}"; do railway_set server "$k" "${V[$k]}"; done
for k in "${OPTIONAL[@]}"; do [ -n "${V[$k]}" ] && railway_set server "$k" "${V[$k]}"; done
railway_set server SERVICE_ROLE server
railway_set server PUBLIC_BASE_URL "$SERVER_URL"
railway_set server FACILITATOR_URL "$FAC_URL"
railway_set server FACILITATOR_TOKEN "$FAC_TOKEN"
railway_set facilitator SERVICE_ROLE facilitator
railway_set facilitator RELAYER_SECRET_KEY "${V[RELAYER_SECRET_KEY]}"
[ -n "${V[SOLANA_RPC_URL]}" ] && railway_set facilitator SOLANA_RPC_URL "${V[SOLANA_RPC_URL]}"
railway_set facilitator FACILITATOR_TOKEN "$FAC_TOKEN"

# ---------- 4. First deploy (web first: its alias is the server's CORS origin) ----------
say "First deploy"
run vercel deploy --prod --yes --token "${VERCEL_TOKEN:-}"
if [ "$DRY" != 1 ]; then
  alias=$(curl -fsS "https://api.vercel.com/v9/projects/$PROJECT_ID$TEAM_Q" -H "Authorization: Bearer $VERCEL_TOKEN" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);const a=(p.targets?.production?.alias||[]).find(x=>x.endsWith(".vercel.app"));process.stdout.write(a||"")})')
  [ -n "$alias" ] && WEB_URL="https://$alias"
fi
echo "web: $WEB_URL"
railway_set server WEB_ORIGIN "$WEB_URL"
RAILWAY_TOKEN="${RAILWAY_TOKEN:-}" run railway up --ci --service facilitator
RAILWAY_TOKEN="${RAILWAY_TOKEN:-}" run railway up --ci --service server

# ---------- 5. GitHub secrets + variables for .github/workflows/deploy.yml ----------
say "GitHub secrets and variables"
gh_secret RAILWAY_TOKEN "${RAILWAY_TOKEN:-dry}"
gh_secret VERCEL_TOKEN "${VERCEL_TOKEN:-}"
gh_secret VERCEL_ORG_ID "$ORG_ID"
gh_secret VERCEL_PROJECT_ID "$PROJECT_ID"
gh_secret SUPABASE_DB_URL "${V[SUPABASE_DB_URL]}"
gh_secret FACILITATOR_TOKEN "$FAC_TOKEN"
gh_var SERVER_URL "$SERVER_URL"
gh_var WEB_URL "$WEB_URL"
gh_var FACILITATOR_URL "$FAC_URL"
gh_var RAILWAY_ENABLED true   # (re)link Railway to the Deploy workflow

# ---------- 6. CRE runner points at the hosted server ----------
say "CRE production config"
if [ "$DRY" = 1 ]; then echo "[dry-run] platformUrl → $SERVER_URL in cre/aggregate/config.production.json"; else
  node -e 'const f="cre/aggregate/config.production.json";const c=JSON.parse(require("fs").readFileSync(f,"utf8"));c.platformUrl=process.argv[1];require("fs").writeFileSync(f,JSON.stringify(c,null,2)+"\n")' "$SERVER_URL"
  echo "updated cre/aggregate/config.production.json (commit it); run the runner with CRE_TARGET=production-settings SERVER_URL=$SERVER_URL"
fi

# ---------- 7. Live smoke test ----------
say "Smoke test"
if [ "$DRY" = 1 ]; then echo "[dry-run] node scripts/deploy/smoke.mjs against $SERVER_URL / $WEB_URL / $FAC_URL"; else
  SERVER_URL="$SERVER_URL" WEB_URL="$WEB_URL" FACILITATOR_URL="$FAC_URL" FACILITATOR_TOKEN="$FAC_TOKEN" node scripts/deploy/smoke.mjs
fi

say "Done"
echo "Web:         $WEB_URL"
echo "API:         $SERVER_URL"
echo "Facilitator: $FAC_URL"
echo "From now on every push to main deploys through .github/workflows/deploy.yml."
