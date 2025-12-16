# Makefile for docker compose and development
.PHONY: dev-up dev-down dev-clean dev-logs dev-ps \
        prod-up prod-down prod-clean prod-logs prod-ps \
        test test-quick test-e2e test-resilience \
        lint lint-fix format format-check install help

# ============================================================================
# Development Commands
# ============================================================================

# Build and start all development services
dev-up:
	docker compose -f docker/compose.dev.yml up --build -d

# Stop development services
dev-down:
	docker compose -f docker/compose.dev.yml down

# Remove all containers, images, and volumes
dev-clean:
	docker compose -f docker/compose.dev.yml down -v --rmi all

# View development logs (follow mode)
dev-logs:
	docker compose -f docker/compose.dev.yml logs -f

# Show running development containers
dev-ps:
	docker compose -f docker/compose.dev.yml ps

# ============================================================================
# Production Commands
# ============================================================================

# Build and start all production services
prod-up:
	docker compose -f docker/compose.prod.yml up --build -d

# Stop production services
prod-down:
	docker compose -f docker/compose.prod.yml down

# Remove all containers, images, and volumes
prod-clean:
	docker compose -f docker/compose.prod.yml down -v --rmi all

# View production logs (follow mode)
prod-logs:
	docker compose -f docker/compose.prod.yml logs -f

# Show running production containers
prod-ps:
	docker compose -f docker/compose.prod.yml ps

# ============================================================================
# Testing Commands
# ============================================================================

# Run all tests
test: test-quick test-e2e

# Quick health verification (11 tests, ~5s)
test-quick:
	npm run test:quick

# Full E2E test suite (45 tests, ~30s)
test-e2e:
	npm run test:e2e

# Resilience tests - Redis/S3 failure (~2min)
test-resilience:
	npm run test:resilience

# ============================================================================
# Code Quality Commands
# ============================================================================

# Run linter
lint:
	npm run lint

# Fix linting issues
lint-fix:
	npm run lint:fix

# Format code with Prettier
format:
	npm run format

# Check code formatting
format-check:
	npm run format:check

# ============================================================================
# Setup Commands
# ============================================================================

# Install dependencies
install:
	npm install

# ============================================================================
# Help
# ============================================================================

help:
	@echo "Delineate Hackathon - Available Commands"
	@echo ""
	@echo "Development:"
	@echo "  make dev-up      - Start development stack"
	@echo "  make dev-down    - Stop development services"
	@echo "  make dev-clean   - Remove containers and volumes"
	@echo "  make dev-logs    - View logs (follow mode)"
	@echo "  make dev-ps      - Show running containers"
	@echo ""
	@echo "Production:"
	@echo "  make prod-up     - Start production stack (with Nginx)"
	@echo "  make prod-down   - Stop production services"
	@echo "  make prod-clean  - Full cleanup"
	@echo "  make prod-logs   - View logs (follow mode)"
	@echo "  make prod-ps     - Show running containers"
	@echo ""
	@echo "Testing:"
	@echo "  make test        - Run quick + E2E tests"
	@echo "  make test-quick  - Quick health verification (~5s)"
	@echo "  make test-e2e    - Full E2E suite (~30s)"
	@echo "  make test-resilience - Redis/S3 failure tests (~2min)"
	@echo ""
	@echo "Code Quality:"
	@echo "  make lint        - Run ESLint"
	@echo "  make lint-fix    - Fix linting issues"
	@echo "  make format      - Format code with Prettier"
	@echo "  make format-check - Check code formatting"
	@echo ""
	@echo "Setup:"
	@echo "  make install     - Install npm dependencies"