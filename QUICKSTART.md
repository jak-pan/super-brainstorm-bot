# Quick Start Guide

Get the bot running in 5 minutes!

## 1. Install Dependencies

```bash
npm install
```

## 2. Create `.env` File

```bash
cp .env.example .env
```

Then edit `.env` and fill in your credentials:

### Required:
- **DISCORD_BOT_TOKEN** - Get from [Discord Developer Portal](https://discord.com/developers/applications)
- **DISCORD_GUILD_ID** - Right-click your server > Copy Server ID (enable Developer Mode first)
- **DISCORD_CHANNEL_ID** - Right-click your channel > Copy Channel ID
- **OPENAI_API_KEY** - Get from [OpenAI Platform](https://platform.openai.com/api-keys)
- **ANTHROPIC_API_KEY** - Get from [Anthropic Console](https://console.anthropic.com/)
- **NOTION_API_KEY** - Get from [Notion Integrations](https://www.notion.so/my-integrations)
- **NOTION_REASONING_PAGE_ID** - Create a Notion page, share with integration, copy ID from URL
- **NOTION_TLDR_PAGE_ID** - Create another Notion page, share with integration, copy ID from URL

### Quick Links:
- [Discord Bot Setup Guide](https://discord.com/developers/docs/getting-started)
- [Notion Integration Guide](https://developers.notion.com/docs/getting-started)

## 3. Build

```bash
npm run build
```

## 4. Run

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

## 5. Test

1. Go to your Discord channel
2. Send a regular message (not a command)
3. The Session Planner bot should respond!

## Need Help?

See [SETUP.md](./SETUP.md) for detailed setup instructions.

## Common Issues

**"Missing required environment variables"**
→ Make sure `.env` file exists and all required variables are filled in

**Bot doesn't respond**
→ Enable "MESSAGE CONTENT INTENT" in Discord Developer Portal > Bot settings

**Notion errors**
→ Make sure you shared both pages with your integration (click "..." > "Add connections")

