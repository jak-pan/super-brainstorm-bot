# Deployment Guide

This guide explains how to deploy the Super Brainstorm Bot using Docker.

## Prerequisites

* Docker installed (version 20.10+)
* Docker Compose (optional, for easier management)

## Quick Start

### 1. Build the Docker Image

```bash
docker build -t superbrainstormbot .
```

### 2. Create `.env` File

Make sure you have a `.env` file with all required environment variables (see `SETUP.md`).

### 3. Run the Container

```bash
docker run -d \
  --name superbrainstormbot \
  --restart unless-stopped \
  --env-file .env \
  superbrainstormbot
```

## Using Docker Compose

### 1. Create `.env` File

Ensure your `.env` file is in the project root.

### 2. Start the Service

```bash
docker-compose up -d
```

### 3. View Logs

```bash
docker-compose logs -f
```

### 4. Stop the Service

```bash
docker-compose down
```

## Cloud Deployment

### AWS ECS / Fargate

1. Build and push to ECR:

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build and tag
docker build -t superbrainstormbot .
docker tag superbrainstormbot:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/superbrainstormbot:latest

# Push
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/superbrainstormbot:latest
```

2. Create ECS task definition with:
   * Image: Your ECR image
   * Environment variables: Add all from `.env` file
   * Memory: 512MB minimum (1GB recommended)
   * CPU: 0.5 vCPU minimum (1 vCPU recommended)

### Google Cloud Run

1. Build and push to GCR:

```bash
# Build
docker build -t gcr.io/<project-id>/superbrainstormbot .

# Push
docker push gcr.io/<project-id>/superbrainstormbot
```

2. Deploy:

```bash
gcloud run deploy superbrainstormbot \
  --image gcr.io/<project-id>/superbrainstormbot \
  --platform managed \
  --region us-central1 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 3600 \
  --max-instances 1 \
  --set-env-vars "$(cat .env | grep -v '^#' | xargs)"
```

### Azure Container Instances

1. Build and push to ACR:

```bash
# Login
az acr login --name <registry-name>

# Build
az acr build --registry <registry-name> --image superbrainstormbot:latest .
```

2. Deploy:

```bash
az container create \
  --resource-group <resource-group> \
  --name superbrainstormbot \
  --image <registry-name>.azurecr.io/superbrainstormbot:latest \
  --registry-login-server <registry-name>.azurecr.io \
  --cpu 1 \
  --memory 1 \
  --environment-variables "$(cat .env | grep -v '^#' | xargs)"
```

### DigitalOcean App Platform

1. Connect your GitHub repository
2. Configure build:
   * Build Command: `npm run build`
   * Run Command: `node dist/index.js`
3. Add environment variables from your `.env` file
4. Deploy!

### Railway

1. Connect your GitHub repository
2. Railway will auto-detect Dockerfile
3. Add environment variables in Railway dashboard
4. Deploy!

### Render

1. Connect your GitHub repository
2. Select "Docker" as the environment
3. Add environment variables
4. Deploy!

## Environment Variables in Cloud

Instead of using `.env` file, set environment variables in your cloud platform:

**Required:**

* `DISCORD_BOT_TOKEN`
* `DISCORD_GUILD_ID`
* `OPENROUTER_API_KEY` (provides access to all 300+ AI models)
* `NOTION_API_KEY`
* `NOTION_PAGE_ID` (single database/page ID that hosts all topics)

**Optional:**

* `LOG_LEVEL` (default: `info`)

**Note:** Most configuration (model presets, limits, intervals) is stored in `src/config/default-settings.json` and can be modified via `/sbb settings` command in Discord.

See `.env.example` for the complete list.

## Health Checks

The Dockerfile includes a health check. If you need to expose a health endpoint, you can add a simple HTTP server to `src/index.ts`:

```typescript
import http from 'http';

// Add after bot starts
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

healthServer.listen(3000, () => {
  logger.info('Health check server listening on port 3000');
});
```

## Resource Requirements

**Minimum:**

* CPU: 0.5 vCPU
* Memory: 512MB
* Disk: 1GB

**Recommended:**

* CPU: 1 vCPU
* Memory: 1GB
* Disk: 2GB

**For High Traffic:**

* CPU: 2 vCPU
* Memory: 2GB
* Disk: 5GB

## Monitoring

### View Logs

```bash
# Docker
docker logs -f superbrainstormbot

# Docker Compose
docker-compose logs -f
```

### Restart Container

```bash
# Docker
docker restart superbrainstormbot

# Docker Compose
docker-compose restart
```

### Update Container

```bash
# Pull latest code
git pull

# Rebuild
docker-compose build

# Restart
docker-compose up -d
```

## Security Best Practices

1. **Never commit `.env` file** - Use secrets management in your cloud platform
2. **Use non-root user** - The Dockerfile already does this
3. **Keep dependencies updated** - Regularly rebuild with `npm audit fix`
4. **Use private registries** - Don't push images with secrets to public registries
5. **Limit resources** - Set CPU and memory limits
6. **Enable logging** - Monitor logs for errors

## Troubleshooting

### Container exits immediately

```bash
# Check logs
docker logs superbrainstormbot

# Common issues:
# - Missing environment variables
# - Invalid API keys
# - Discord bot token incorrect
```

### Out of Memory

Increase memory limit:

```bash
docker run -d --memory="2g" --name superbrainstormbot --env-file .env superbrainstormbot
```

### Can't connect to Discord

* Verify `DISCORD_BOT_TOKEN` is correct
* Check that MESSAGE CONTENT INTENT is enabled
* Ensure bot is invited to server with correct permissions

### Notion errors

* Verify `NOTION_API_KEY` is correct
* Ensure pages are shared with integration
* Check page IDs are correct

## Production Checklist

* \[ ] All environment variables set in cloud platform
* \[ ] Secrets stored securely (not in code)
* \[ ] Resource limits configured
* \[ ] Health checks enabled
* \[ ] Logging configured
* \[ ] Auto-restart enabled
* \[ ] Monitoring set up
* \[ ] Backup strategy for Notion pages
* \[ ] Rate limiting configured (if needed)

## Example: Full Deployment Script

```bash
#!/bin/bash

# Build
docker build -t superbrainstormbot:latest .

# Tag for registry (replace with your registry)
docker tag superbrainstormbot:latest registry.example.com/superbrainstormbot:latest

# Push
docker push registry.example.com/superbrainstormbot:latest

# Deploy (example for ECS)
aws ecs update-service \
  --cluster my-cluster \
  --service superbrainstormbot \
  --force-new-deployment
```

## Support

For issues specific to Docker deployment, check:

* Docker logs: `docker logs superbrainstormbot`
* Container status: `docker ps -a`
* Resource usage: `docker stats superbrainstormbot`

For general bot issues, see `SETUP.md` troubleshooting section.

## Manual Deployment

If you prefer to deploy manually without Docker, you can follow the setup instructions in [SETUP.md](./SETUP.md) and run the bot directly on your server using Node.js. The guide covers all the necessary steps including environment configuration, building the project, and running the application.
