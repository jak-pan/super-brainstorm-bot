# Deployment Guide

This guide covers deploying the Super Brainstorm Bot to cloud services like DigitalOcean, AWS EC2, Linode, and similar VPS providers.

## Quick Start Options

### Option 1: Docker Deployment (Recommended)

The easiest way to deploy is using Docker. See [DOCKER.md](./DOCKER.md) for Docker-specific instructions.

### Option 2: Direct Node.js Deployment

Deploy directly on a VPS with Node.js installed.

## Supported Platforms

* **DigitalOcean Droplets** - Simple, affordable VPS
* **AWS EC2** - Scalable cloud instances
* **Linode** - Developer-friendly VPS
* **Vultr** - High-performance VPS
* **Hetzner** - Cost-effective European VPS
* **Any Linux VPS** - Works on any Ubuntu/Debian-based server

## Prerequisites

* A VPS/server with:
  * Ubuntu 20.04+ or Debian 11+ (recommended)
  * At least 1GB RAM (2GB+ recommended)
  * Node.js 18+ installed
  * Docker (optional, for Docker deployment)
  * Git installed

## Deployment Methods

### Method 1: Docker Deployment (Recommended)

Docker deployment is the simplest and most reliable method. See [DOCKER.md](./DOCKER.md) for detailed instructions.

**Quick Docker Setup:**

```bash
# Clone repository
git clone <repository-url>
cd superbrainstormbot

# Create .env file
cp .env.example .env
# Edit .env with your credentials

# Build and run with Docker
docker build -t superbrainstormbot .
docker run -d --name sbb-bot --env-file .env --restart unless-stopped superbrainstormbot

# View logs
docker logs -f sbb-bot
```

### Method 2: Direct Node.js Deployment

#### Step 1: Server Setup

**For DigitalOcean Droplet:**

1. Create a new Droplet:
   * Choose Ubuntu 22.04 LTS
   * Select size: Basic plan, $6/month (1GB RAM) or higher
   * Add SSH keys or use password authentication
   * Create Droplet

2. Connect via SSH:
   ```bash
   ssh root@your-droplet-ip
   ```

**For AWS EC2:**

1. Launch an EC2 instance:
   * Choose Ubuntu Server 22.04 LTS
   * Select instance type: t2.micro (free tier) or t2.small
   * Configure security group (allow SSH on port 22)
   * Launch and download key pair

2. Connect via SSH:
   ```bash
   ssh -i your-key.pem ubuntu@your-ec2-ip
   ```

#### Step 2: Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should be v20.x or higher
npm --version

# Install Git (if not already installed)
sudo apt install -y git

# Install PM2 for process management (recommended)
sudo npm install -g pm2
```

#### Step 3: Clone and Setup Application

```bash
# Create application directory
sudo mkdir -p /opt/superbrainstormbot
sudo chown $USER:$USER /opt/superbrainstormbot
cd /opt/superbrainstormbot

# Clone repository
git clone <repository-url> .

# Install dependencies
npm install

# Create .env file
cp .env.example .env
nano .env  # Edit with your credentials
```

**Configure `.env` file:**

```env
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_GUILD_ID=your_guild_id_here
DISCORD_CHANNEL_ID=your_channel_id_here
OPENROUTER_API_KEY=your_openrouter_api_key_here
NOTION_API_KEY=your_notion_api_key_here
NOTION_PAGE_ID=your_notion_database_page_id_here
LOG_LEVEL=info
```

#### Step 4: Build Application

```bash
# Build TypeScript
npm run build

# Verify build
ls -la dist/  # Should see compiled JavaScript files
```

#### Step 5: Run as a Service

**Option A: Using PM2 (Recommended)**

PM2 provides process management, auto-restart, and logging:

```bash
# Start application with PM2
pm2 start dist/index.js --name sbb-bot

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
# Follow the instructions shown (usually run a sudo command)

# View logs
pm2 logs sbb-bot

# View status
pm2 status

# Restart application
pm2 restart sbb-bot

# Stop application
pm2 stop sbb-bot
```

**Option B: Using systemd**

Create a systemd service file:

```bash
sudo nano /etc/systemd/system/sbb-bot.service
```

Add the following content:

```ini
[Unit]
Description=Super Brainstorm Bot
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/opt/superbrainstormbot
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node /opt/superbrainstormbot/dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Replace `your-username` with your actual username.

Enable and start the service:

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable sbb-bot

# Start service
sudo systemctl start sbb-bot

# Check status
sudo systemctl status sbb-bot

# View logs
sudo journalctl -u sbb-bot -f
```

#### Step 6: Verify Deployment

1. Check that the bot is running:
   ```bash
   # With PM2
   pm2 status

   # With systemd
   sudo systemctl status sbb-bot
   ```

2. Check logs for successful startup:
   ```bash
   # With PM2
   pm2 logs sbb-bot --lines 50

   # With systemd
   sudo journalctl -u sbb-bot -n 50
   ```

3. Look for these log messages:
   ```
   Starting Super Brainstorm Bot...
   Configuration loaded
   Discord bot logged in as YourBot#1234
   Successfully registered slash commands
   Super Brainstorm Bot is running!
   ```

4. Test in Discord:
   * Go to your Discord server
   * Use `/sbb start` command
   * Bot should respond

## Updating the Application

### Using Git

```bash
cd /opt/superbrainstormbot

# Pull latest changes
git pull origin main

# Install any new dependencies
npm install

# Rebuild
npm run build

# Restart application
# With PM2:
pm2 restart sbb-bot

# With systemd:
sudo systemctl restart sbb-bot
```

### Using Docker

```bash
# Pull latest image
docker pull your-registry/superbrainstormbot:latest

# Stop and remove old container
docker stop sbb-bot
docker rm sbb-bot

# Run new container
docker run -d --name sbb-bot --env-file .env --restart unless-stopped your-registry/superbrainstormbot:latest
```

## Monitoring

### PM2 Monitoring

```bash
# Monitor in real-time
pm2 monit

# View detailed information
pm2 show sbb-bot

# View logs
pm2 logs sbb-bot

# View error logs only
pm2 logs sbb-bot --err
```

### systemd Monitoring

```bash
# View status
sudo systemctl status sbb-bot

# View logs
sudo journalctl -u sbb-bot -f

# View recent logs
sudo journalctl -u sbb-bot -n 100

# View logs since boot
sudo journalctl -u sbb-bot -b
```

### Health Checks

The bot logs important events. Monitor for:

* Connection errors
* API rate limit warnings
* Cost limit warnings
* Notion update failures

## Troubleshooting

### Bot Not Starting

1. **Check logs:**
   ```bash
   pm2 logs sbb-bot
   # or
   sudo journalctl -u sbb-bot -n 50
   ```

2. **Verify environment variables:**
   ```bash
   cat /opt/superbrainstormbot/.env
   ```

3. **Check Node.js version:**
   ```bash
   node --version  # Should be 18+
   ```

4. **Verify build:**
   ```bash
   ls -la /opt/superbrainstormbot/dist/
   ```

### Bot Disconnects Frequently

1. **Check system resources:**
   ```bash
   free -h  # Check memory
   df -h    # Check disk space
   ```

2. **Check for errors in logs:**
   ```bash
   pm2 logs sbb-bot --err
   ```

3. **Increase restart delay (systemd):**
   Edit `/etc/systemd/system/sbb-bot.service` and increase `RestartSec=30`

### High Memory Usage

1. **Monitor memory:**
   ```bash
   pm2 monit
   # or
   htop
   ```

2. **Restart bot periodically:**
   ```bash
   # Add to crontab for daily restart at 3 AM
   crontab -e
   # Add: 0 3 * * * pm2 restart sbb-bot
   ```

### Discord API Errors

1. **Check rate limits:**
   * Look for rate limit warnings in logs
   * The bot has built-in rate limiting, but check if it's working

2. **Verify bot token:**
   * Ensure token is correct in `.env`
   * Check if token was regenerated

3. **Check bot permissions:**
   * Ensure bot has required permissions in Discord
   * Verify MESSAGE CONTENT INTENT is enabled

## Security Best Practices

1. **Use non-root user:**
   ```bash
   # Create dedicated user
   sudo adduser sbb-bot
   sudo chown -R sbb-bot:sbb-bot /opt/superbrainstormbot
   ```

2. **Protect .env file:**
   ```bash
   chmod 600 /opt/superbrainstormbot/.env
   ```

3. **Firewall setup:**
   ```bash
   # Allow only SSH (port 22)
   sudo ufw allow 22/tcp
   sudo ufw enable
   ```

4. **Keep system updated:**
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

5. **Use SSH keys instead of passwords:**
   * Disable password authentication in SSH
   * Use key-based authentication only

## Backup

### Backup Configuration

```bash
# Backup .env file
cp /opt/superbrainstormbot/.env /opt/superbrainstormbot/.env.backup

# Backup entire application
tar -czf sbb-bot-backup-$(date +%Y%m%d).tar.gz /opt/superbrainstormbot
```

### Automated Backups

Add to crontab:

```bash
crontab -e
# Add: 0 2 * * * tar -czf /backups/sbb-bot-$(date +\%Y\%m\%d).tar.gz /opt/superbrainstormbot
```

## Cost Optimization

### DigitalOcean

* Start with Basic plan ($6/month, 1GB RAM)
* Monitor usage and upgrade if needed
* Use snapshots for backups

### AWS EC2

* Use t2.micro for free tier
* Consider Reserved Instances for long-term use
* Set up CloudWatch alarms for cost monitoring

### General Tips

* Monitor resource usage
* Scale down if not needed
* Use serverless options if available (though this bot needs persistent connection)

## Additional Resources

* [DigitalOcean Getting Started](https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu-22-04)
* [AWS EC2 Documentation](https://docs.aws.amazon.com/ec2/)
* [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/quick-start/)
* [systemd Service Tutorial](https://www.digitalocean.com/community/tutorials/how-to-use-systemctl-to-manage-systemd-services-and-units)

## Support

If you encounter issues:

1. Check logs first
2. Verify all environment variables are set
3. Ensure Node.js version is 18+
4. Check system resources (memory, disk)
5. Review [SETUP.md](./SETUP.md) for setup issues
6. Check [Troubleshooting](#troubleshooting) section above
