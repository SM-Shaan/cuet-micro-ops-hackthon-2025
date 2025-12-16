# CI/CD Pipeline Documentation

This document explains the Continuous Integration and Continuous Deployment (CI/CD) pipeline for the CUET Micro-Ops Hackathon project.

---

## Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Push to   │───▶│  CI Tests   │────▶│ Build/Push  │───▶│   Deploy    │
│    main     │     │   Pass      │     │   Image     │     │  (Optional) │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

| Component          | Tool           | Status       |
| ------------------ | -------------- | ------------ |
| CI Pipeline        | GitHub Actions | Implemented  |
| Container Registry | Docker Hub     | Implemented  |
| CD (Auto-deploy)   | Optional       | Configurable |

---

## CI Pipeline (Continuous Integration)

The CI pipeline runs automatically on every push and pull request.

### Pipeline Stages

```
┌────────────────────────────────────────────────────────────────┐
│                        CI Pipeline                             │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   ┌─────────┐                                                  │
│   │  Lint   │──────────────┬───────────────┐                  │
│   └─────────┘              │               │                  │
│        │                   ▼               ▼                  │
│        │            ┌──────────┐    ┌──────────┐              │
│        │            │   Test   │    │ Security │              │
│        │            │   E2E    │    │   Scan   │              │
│        │            └────┬─────┘    └────┬─────┘              │
│        │                 │               │                    │
│        │                 ▼               │                    │
│        │            ┌──────────┐         │                    │
│        │            │  Build   │         │                    │
│        │            │  Docker  │         │                    │
│        │            └────┬─────┘         │                    │
│        │                 │               │                    │
│        │                 ▼               ▼                    │
│        │            ┌──────────────────────┐                  │
│        └───────────▶│       Deploy         │                  │
│                     │  (main branch only)  │                  │
│                     └──────────────────────┘                  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Jobs Description

| Job                  | Purpose                     | Runs On      |
| -------------------- | --------------------------- | ------------ |
| **Lint & Format**    | ESLint + Prettier checks    | All branches |
| **E2E Tests**        | End-to-end API testing      | All branches |
| **Security Scan**    | npm audit + CodeQL analysis | All branches |
| **Build Docker**     | Build production image      | All branches |
| **Push to Registry** | Push image to Docker Hub    | `main` only  |
| **Deploy**           | Trigger deployment webhook  | `main` only  |

---

## Docker Hub Setup

### 1. Create Docker Hub Account

1. Sign up at [hub.docker.com](https://hub.docker.com)
2. Create a repository named `cuet-micro-ops`

### 2. Create Access Token

1. Go to **Account Settings** → **Security**
2. Click **New Access Token**
3. Name: `github-actions`
4. Permissions: **Read & Write**
5. Copy the token (shown only once)

### 3. Add GitHub Secrets

Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**

| Secret Name          | Value                        |
| -------------------- | ---------------------------- |
| `DOCKERHUB_USERNAME` | Your Docker Hub username     |
| `DOCKERHUB_TOKEN`    | The access token from step 2 |

### 4. Verify Setup

After pushing to `main`, check:

- GitHub Actions → workflow should pass
- Docker Hub → image should appear with `latest` tag

---

## CD Options (Continuous Deployment)

### Option 1: Docker Hub Only (Current)

```
Push to main → CI Tests → Build Image → Push to Docker Hub
                                              │
                                              ▼
                                    Manual deploy when needed
```

**Pros:** Simple, no extra services
**Cons:** Manual deployment step

### Option 2: Render (Free Tier)

```
Push to main → CI Tests → Render auto-deploys from repo
```

**Setup:**

1. Create account at [render.com](https://render.com)
2. New → Web Service → Connect GitHub repo
3. Configure:
   - **Environment:** Docker
   - **Branch:** main
   - **Dockerfile Path:** `docker/Dockerfile.prod`

**Pros:** Free, automatic deploys
**Cons:** Cold starts on free tier

### Option 3: VPS + Docker Compose

```
Push to main → CI Tests → Push Image → SSH → docker compose up
```

**Setup:**

1. Get a VPS (~$5/mo): DigitalOcean, Linode, Vultr
2. Install Docker on VPS
3. Add SSH deployment to workflow:

```yaml
deploy:
  runs-on: ubuntu-latest
  needs: build
  steps:
    - name: Deploy via SSH
      uses: appleboy/ssh-action@v1.0.0
      with:
        host: ${{ secrets.VPS_HOST }}
        username: ${{ secrets.VPS_USER }}
        key: ${{ secrets.VPS_SSH_KEY }}
        script: |
          cd /app
          docker compose pull
          docker compose up -d
```

### Option 4: Kubernetes

```
Push to main → CI Tests → Push Image → kubectl apply
```

**Free K8s Options:**

- Oracle Cloud (OKE) - Always free tier
- Civo - $250 trial credit

**Required files:**

- `k8s/deployment.yaml`
- `k8s/service.yaml`
- `k8s/ingress.yaml`

---

## Workflow File Reference

Location: `.github/workflows/ci.yml`

### Triggers

```yaml
on:
  push:
    branches: [main, master, dev]
  pull_request:
    branches: [main, master]
```

### Environment Variables for Tests

```yaml
env:
  NODE_ENV: development
  PORT: 3000
  S3_REGION: us-east-1
  DOWNLOAD_DELAY_ENABLED: "false"
```

### Conditional Deployment

```yaml
# Only runs on main branch push (not PRs)
if: github.ref == 'refs/heads/main' && github.event_name == 'push'
```

---

## Local Testing

### Run CI Checks Locally

```bash
# Lint
npm run lint

# Format check
npm run format:check

# E2E tests
npm run test:e2e

# Build Docker image
docker build -f docker/Dockerfile.prod -t cuet-micro-ops .
```

### Test Docker Image

```bash
# Run the built image
docker run -p 3000:3000 cuet-micro-ops

# Test health endpoint
curl http://localhost:3000/health
```

---

## Troubleshooting

### CI Failures

| Error              | Solution                                        |
| ------------------ | ----------------------------------------------- |
| Lint errors        | Run `npm run lint:fix` locally                  |
| Format errors      | Run `npm run format` locally                    |
| Test failures      | Check test logs, run `npm run test:e2e` locally |
| Docker build fails | Check Dockerfile syntax, test locally first     |

### Docker Hub Push Fails

1. Verify secrets are set correctly
2. Check Docker Hub token hasn't expired
3. Ensure repository exists on Docker Hub

### Deployment Issues

1. Check webhook URL is correct
2. Verify deployment platform is connected to correct repo
3. Check deployment logs on the platform

---

## Security Considerations

- **Never commit secrets** to the repository
- Use **GitHub Secrets** for all sensitive values
- Docker Hub tokens should have **minimal permissions**
- Review **CodeQL alerts** in Security tab
- Keep dependencies updated (`npm audit`)

---

## Summary

| What            | Where                      | How                       |
| --------------- | -------------------------- | ------------------------- |
| Workflow config | `.github/workflows/ci.yml` | GitHub Actions            |
| Docker image    | `docker/Dockerfile.prod`   | Multi-stage build         |
| Secrets         | GitHub Settings            | Repository secrets        |
| Image registry  | Docker Hub                 | `username/cuet-micro-ops` |
| Deployment      | Your choice                | Render, VPS, or K8s       |
