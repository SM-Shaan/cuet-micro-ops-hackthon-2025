# Makefile for docker compose
.PHONY: dev-up dev-down dev-clean prod-up prod-down prod-clean

# Build and start all services
dev-up:
	docker compose -f docker/compose.dev.yml build
	docker compose -f docker/compose.dev.yml up -d

# Stop and remove all services
dev-down:
	docker compose -f docker/compose.dev.yml down

# Remove all containers, images, and volumes
dev-clean:
	docker compose -f docker/compose.dev.yml down -v --rmi all

prod-up:
	docker compose -f docker/compose.prod.yml build
	docker compose -f docker/compose.prod.yml up -d

prod-down:
	docker compose -f docker/compose.prod.yml down

prod-clean:
	docker compose -f docker/compose.prod.yml down -v --rmi all