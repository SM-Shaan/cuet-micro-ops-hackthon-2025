#!/bin/bash
#
# Resilience Test Script
# Tests Redis failure handling and S3 circuit breaker
#
# Usage: ./scripts/resilience-test.sh
#
# Prerequisites:
# - Docker Compose environment running
# - curl installed
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

BASE_URL="${1:-http://localhost:3000}"
COMPOSE_FILE="docker/compose.dev.yml"

passed=0
failed=0

log_pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((passed++))
}

log_fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    echo -e "  ${YELLOW}Expected${NC}: $2"
    echo -e "  ${YELLOW}Got${NC}: $3"
    ((failed++))
}

log_section() {
    echo ""
    echo -e "${YELLOW}=== $1 ===${NC}"
}

log_info() {
    echo -e "  $1"
}

# Check if docker compose is available
check_docker() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: docker is not installed${NC}"
        exit 1
    fi
}

# Wait for service to be ready
wait_for_health() {
    local max_attempts=${1:-30}
    local expected_status=${2:-""}

    for i in $(seq 1 $max_attempts); do
        response=$(curl -s "$BASE_URL/health" 2>/dev/null || echo '{}')

        if [ -n "$expected_status" ]; then
            status=$(echo "$response" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
            if [ "$status" = "$expected_status" ]; then
                return 0
            fi
        else
            if echo "$response" | grep -q '"status"'; then
                return 0
            fi
        fi

        sleep 1
    done
    return 1
}

# Test 1: Redis Failure Handling
test_redis_failure() {
    log_section "Redis Failure Handling Test"

    # Step 1: Verify healthy state
    log_info "Step 1: Verifying healthy state..."
    response=$(curl -s "$BASE_URL/health")

    if echo "$response" | grep -q '"redis":"ok"'; then
        log_pass "Initial state: Redis is healthy"
    else
        log_fail "Initial state: Redis is healthy" '"redis":"ok"' "$response"
        return
    fi

    # Step 2: Stop Redis
    log_info "Step 2: Stopping Redis..."
    docker compose -f "$COMPOSE_FILE" stop redis > /dev/null 2>&1
    sleep 3

    # Step 3: Check health shows Redis error
    log_info "Step 3: Checking health shows Redis error..."
    response=$(curl -s "$BASE_URL/health")

    if echo "$response" | grep -q '"redis":"error"'; then
        log_pass "Health shows Redis error"
    else
        log_fail "Health shows Redis error" '"redis":"error"' "$response"
    fi

    # Step 4: Verify download start returns 503
    log_info "Step 4: Testing download start returns 503..."
    http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/v1/download/start" \
        -H "Content-Type: application/json" \
        -d '{"file_id": 50000, "user_id": "redis-test-user"}')

    if [ "$http_code" = "503" ]; then
        log_pass "Download start returns 503 when Redis is down"
    else
        log_fail "Download start returns 503 when Redis is down" "503" "$http_code"
    fi

    # Step 5: Restart Redis
    log_info "Step 5: Restarting Redis..."
    docker compose -f "$COMPOSE_FILE" start redis > /dev/null 2>&1
    sleep 5

    # Step 6: Verify recovery
    log_info "Step 6: Verifying recovery..."
    if wait_for_health 10 "healthy"; then
        response=$(curl -s "$BASE_URL/health")
        if echo "$response" | grep -q '"redis":"ok"'; then
            log_pass "Redis recovered successfully"
        else
            log_fail "Redis recovered successfully" '"redis":"ok"' "$response"
        fi
    else
        log_fail "Redis recovered successfully" "healthy status" "timeout"
    fi
}

# Test 2: S3 Circuit Breaker
test_s3_circuit_breaker() {
    log_section "S3 Circuit Breaker Test"

    # Step 1: Verify healthy state
    log_info "Step 1: Verifying healthy state..."
    response=$(curl -s "$BASE_URL/health")

    if echo "$response" | grep -q '"storage":"ok"'; then
        log_pass "Initial state: S3 is healthy"
    else
        log_fail "Initial state: S3 is healthy" '"storage":"ok"' "$response"
        return
    fi

    # Step 2: Stop S3 (RustFS)
    log_info "Step 2: Stopping S3 (RustFS)..."
    docker compose -f "$COMPOSE_FILE" stop rustfs > /dev/null 2>&1
    sleep 2

    # Step 3: Test timeout is ~5 seconds (not 11+)
    log_info "Step 3: Testing timeout is ~5 seconds..."
    start_time=$(date +%s)
    curl -s "$BASE_URL/v1/files" > /dev/null 2>&1
    end_time=$(date +%s)
    elapsed=$((end_time - start_time))

    if [ "$elapsed" -le 7 ]; then
        log_pass "Request timeout is ~5 seconds (was: ${elapsed}s)"
    else
        log_fail "Request timeout is ~5 seconds" "<= 7s" "${elapsed}s"
    fi

    # Step 4: Trigger circuit breaker
    log_info "Step 4: Triggering circuit breaker (5+ failures)..."
    for i in 1 2 3 4 5 6; do
        curl -s "$BASE_URL/v1/files" > /dev/null 2>&1 || true
    done

    # Step 5: Check circuit is open
    log_info "Step 5: Checking circuit breaker state..."
    response=$(curl -s "$BASE_URL/health")

    if echo "$response" | grep -q '"storage":"circuit_open"' || echo "$response" | grep -q '"storage":"error"'; then
        log_pass "Circuit breaker is open or error state"
    else
        log_fail "Circuit breaker is open or error state" '"storage":"circuit_open" or "error"' "$response"
    fi

    # Step 6: Restart S3
    log_info "Step 6: Restarting S3..."
    docker compose -f "$COMPOSE_FILE" start rustfs > /dev/null 2>&1

    # Step 7: Wait for circuit reset (30 seconds)
    log_info "Step 7: Waiting 35 seconds for circuit breaker reset..."
    sleep 35

    # Step 8: Verify recovery
    log_info "Step 8: Verifying S3 recovery..."
    response=$(curl -s "$BASE_URL/health")

    if echo "$response" | grep -q '"storage":"ok"'; then
        log_pass "S3 recovered successfully"
    else
        log_fail "S3 recovered successfully" '"storage":"ok"' "$response"
    fi
}

# Print summary
print_summary() {
    echo ""
    echo -e "${YELLOW}==============================${NC}"
    echo -e "${YELLOW}     RESILIENCE TEST SUMMARY  ${NC}"
    echo -e "${YELLOW}==============================${NC}"
    echo "Total:  $((passed + failed))"
    echo -e "${GREEN}Passed: $passed${NC}"
    echo -e "${RED}Failed: $failed${NC}"
    echo ""

    if [ "$failed" -eq 0 ]; then
        echo -e "${GREEN}All resilience tests passed!${NC}"
    else
        echo -e "${RED}Some resilience tests failed.${NC}"
    fi
}

# Main
main() {
    echo "Resilience Tests for Delineate Hackathon Challenge"
    echo "Base URL: $BASE_URL"
    echo "Compose File: $COMPOSE_FILE"
    echo ""

    check_docker

    # Wait for initial healthy state
    log_info "Waiting for server to be ready..."
    if ! wait_for_health 30; then
        echo -e "${RED}Server did not become ready in time${NC}"
        exit 1
    fi
    echo "Server is ready!"

    test_redis_failure
    test_s3_circuit_breaker

    print_summary

    if [ "$failed" -gt 0 ]; then
        exit 1
    fi
}

main "$@"
