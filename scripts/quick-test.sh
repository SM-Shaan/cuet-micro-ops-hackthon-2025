#!/bin/bash
#
# Quick Test Script
# Runs basic health and functionality checks
#
# Usage: ./scripts/quick-test.sh [BASE_URL]
#

BASE_URL="${1:-http://localhost:3000}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Quick Test - Delineate API${NC}"
echo "Base URL: $BASE_URL"
echo ""

passed=0
failed=0

check() {
    local name="$1"
    local expected="$2"
    local actual="$3"

    if echo "$actual" | grep -q "$expected"; then
        echo -e "${GREEN}✓${NC} $name"
        ((passed++))
    else
        echo -e "${RED}✗${NC} $name"
        echo "  Expected: $expected"
        echo "  Got: $actual"
        ((failed++))
    fi
}

# Health check
echo -e "${YELLOW}--- Health ---${NC}"
health=$(curl -s "$BASE_URL/health")
check "Health endpoint responds" '"status"' "$health"
check "Storage check present" '"storage"' "$health"
check "Redis check present" '"redis"' "$health"

# Root endpoint
echo -e "${YELLOW}--- Root ---${NC}"
root=$(curl -s "$BASE_URL/")
check "Root returns message" '"Hello Hono!"' "$root"

# File list (may fail if S3 is down)
echo -e "${YELLOW}--- Files ---${NC}"
files_status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/v1/files")
if [ "$files_status" = "200" ] || [ "$files_status" = "503" ]; then
    echo -e "${GREEN}✓${NC} File list endpoint responds ($files_status)"
    ((passed++))
else
    echo -e "${RED}✗${NC} File list endpoint responds"
    echo "  Expected: 200 or 503"
    echo "  Got: $files_status"
    ((failed++))
fi

# Download check
echo -e "${YELLOW}--- Download Check ---${NC}"
download_check=$(curl -s -X POST "$BASE_URL/v1/download/check" \
    -H "Content-Type: application/json" \
    -d '{"file_id": 70000}')
check "Download check returns file_id" '"file_id":70000' "$download_check"
check "Download check returns available" '"available"' "$download_check"

# Download start (quick validation only)
echo -e "${YELLOW}--- Download Start ---${NC}"
start_status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/v1/download/start" \
    -H "Content-Type: application/json" \
    -d '{"file_id": 70000, "user_id": "quick-test"}')
if [ "$start_status" = "200" ] || [ "$start_status" = "503" ]; then
    echo -e "${GREEN}✓${NC} Download start endpoint responds ($start_status)"
    ((passed++))
else
    echo -e "${RED}✗${NC} Download start endpoint responds"
    echo "  Expected: 200 or 503"
    echo "  Got: $start_status"
    ((failed++))
fi

# Security headers
echo -e "${YELLOW}--- Security ---${NC}"
headers=$(curl -sI "$BASE_URL/")
check "X-Request-ID header" "x-request-id" "$headers"
check "Rate limit header" "ratelimit-limit" "$headers"
check "Security headers" "x-content-type-options" "$headers"

# Summary
echo ""
echo -e "${YELLOW}==============================${NC}"
echo -e "Passed: ${GREEN}$passed${NC}"
echo -e "Failed: ${RED}$failed${NC}"
echo -e "${YELLOW}==============================${NC}"

if [ "$failed" -eq 0 ]; then
    echo -e "${GREEN}All quick tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed.${NC}"
    exit 1
fi
