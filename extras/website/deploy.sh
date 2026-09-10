#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Portfolio Desktop - Cloudflare Pages Deployment Script
# Deploys extras/website directly to Cloudflare Pages via Wrangler
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# Load environment variables from .env if present
if [[ -f "${SCRIPT_DIR}/../../.env" ]]; then
  set -a
  source "${SCRIPT_DIR}/../../.env"
  set +a
elif [[ -f "${SCRIPT_DIR}/.env" ]]; then
  set -a
  source "${SCRIPT_DIR}/.env"
  set +a
fi

# ANSI Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

PROJECT_NAME="${CLOUDFLARE_PAGES_PROJECT:-portfolio-desktop}"
BRANCH="${CLOUDFLARE_PAGES_BRANCH:-main}"
COMMIT_DIRTY=true

print_banner() {
  echo -e "${CYAN}${BOLD}"
  echo "================================================================="
  echo "  ⚡ PORTFOLIO DESKTOP :: CLOUDFLARE PAGES DEPLOYER"
  echo "================================================================="
  echo -e "${NC}"
  echo -e "  Directory:    ${SCRIPT_DIR}"
  echo -e "  Project Name: ${BOLD}${PROJECT_NAME}${NC}"
  echo -e "  Branch:       ${BRANCH}"
  echo "-----------------------------------------------------------------"
}

show_help() {
  cat << EOF
Usage: ./deploy.sh [options]

Deploy the Portfolio Desktop marketing website to Cloudflare Pages.

Options:
  --project-name=<name>   Cloudflare Pages project name (default: portfolio-desktop)
  --branch=<branch>       Branch name to associate with deployment (default: main)
  --clean                 Remove local caches before deployment
  -h, --help              Show this help menu

Environment Variables:
  CLOUDFLARE_API_TOKEN     (Optional) Cloudflare API Token for CI/CD
  CLOUDFLARE_ACCOUNT_ID    (Optional) Cloudflare Account ID
  CLOUDFLARE_PAGES_PROJECT Override default project name
  POSTHOG_API_KEY          PostHog project API key injected into the deployed site

Examples:
  ./deploy.sh
  ./deploy.sh --project-name=my-portfolio-site
EOF
  exit 0
}

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-name=*)
      PROJECT_NAME="${1#*=}"
      shift
      ;;
    --project-name)
      PROJECT_NAME="$2"
      shift 2
      ;;
    --branch=*)
      BRANCH="${1#*=}"
      shift
      ;;
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    -h|--help)
      show_help
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}" >&2
      exit 1
      ;;
  esac
done

print_banner

# 1. Sanity Checks
if [[ ! -f "${SCRIPT_DIR}/index.html" ]]; then
  echo -e "${RED}[ERROR] index.html not found in ${SCRIPT_DIR}!${NC}" >&2
  exit 1
fi

# 1.2. Regenerate the metrics catalog page from extras/metrics before staging
if command -v bun >/dev/null 2>&1; then
  (cd "${SCRIPT_DIR}/../.." && bun run scripts/build-metrics-site.ts)
else
  echo -e "${YELLOW}[WARN] bun not found; deploying the committed metrics/index.html as is.${NC}" >&2
fi

# 1.5. Stage a deploy copy and inject environment variables (PostHog API key)
# Browsers cannot read server envvars at runtime, so we substitute them here.
# Uses the same POSTHOG_API_KEY that the desktop app reads.
POSTHOG_API_KEY="${POSTHOG_API_KEY:-phc_PLACEHOLDER}"
STAGING_DIR="$(mktemp -d)"
trap 'rm -rf "${STAGING_DIR}"' EXIT
cp -R "${SCRIPT_DIR}/." "${STAGING_DIR}/"
rm -rf "${STAGING_DIR}/.wrangler" \
       "${STAGING_DIR}/.env" \
       "${STAGING_DIR}/deploy.sh" \
       "${STAGING_DIR}/README.md" \
       "${STAGING_DIR}/package.json"
find "${STAGING_DIR}" -type f -name '*.html' -exec sed -i "s|YOUR_POSTHOG_PROJECT_API_KEY|${POSTHOG_API_KEY}|g" {} +

# 2. Determine runner (bunx, npx, or global wrangler)
WRANGLER_BIN=""
if command -v wrangler >/dev/null 2>&1; then
  WRANGLER_BIN="wrangler"
elif command -v bunx >/dev/null 2>&1; then
  WRANGLER_BIN="bunx wrangler"
elif command -v npx >/dev/null 2>&1; then
  WRANGLER_BIN="npx -y wrangler@latest"
else
  echo -e "${RED}[ERROR] Neither bunx, npx, nor global wrangler was found.${NC}" >&2
  echo -e "Please install Bun (https://bun.sh) or Node.js to deploy." >&2
  exit 1
fi

echo -e "${YELLOW}[1/3]${NC} Runner detected: ${BOLD}${WRANGLER_BIN}${NC}"

# 3. Check authentication status
echo -e "${YELLOW}[2/3]${NC} Validating Cloudflare credentials..."
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo -e "      ${GREEN}✓${NC} Using CLOUDFLARE_API_TOKEN from environment"
else
  echo -e "      ${CYAN}ℹ${NC} No CLOUDFLARE_API_TOKEN set. Wrangler will use interactive login or cached credentials."
fi

# 4. Deploy to Cloudflare Pages
echo -e "${YELLOW}[3/3]${NC} Deploying directory to Cloudflare Pages..."
echo "-----------------------------------------------------------------"

DEPLOY_CMD=(${WRANGLER_BIN} pages deploy "${STAGING_DIR}" --project-name="${PROJECT_NAME}" --branch="${BRANCH}" --commit-dirty=true)

# Run deployment
if ${DEPLOY_CMD[@]}; then
  echo "-----------------------------------------------------------------"
  echo -e "${GREEN}${BOLD}✓ Deployment completed successfully!${NC}"
  echo -e "Visit your Cloudflare Pages dashboard or project domain at:"
  echo -e "${CYAN}https://${PROJECT_NAME}.pages.dev${NC}"
  echo "================================================================="
else
  DEPLOY_STATUS=$?
  echo "-----------------------------------------------------------------"
  echo -e "${RED}[ERROR] Cloudflare Pages deployment failed (exit code: ${DEPLOY_STATUS}).${NC}" >&2
  echo -e "Tip: If you are not logged in yet, run: ${BOLD}${WRANGLER_BIN} login${NC}" >&2
  exit ${DEPLOY_STATUS}
fi
