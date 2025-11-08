# Setup Guide - Super Brainstorm Bot

This guide will walk you through setting up and running the Super Brainstorm Bot.

## Prerequisites

- Node.js 18+ installed
- npm or yarn package manager
- Discord Bot Token
- Notion API Key and Page IDs
- At least one AI API key (OpenAI or Anthropic recommended)

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Create Environment File

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Or create it manually with the following content:

```env
# Discord Configuration (REQUIRED)
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_GUILD_ID=your_guild_id_here
DISCORD_CHANNEL_ID=your_channel_id_here

# OpenAI Configuration (REQUIRED - at least one AI provider)
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4-turbo-preview

# Anthropic Configuration (REQUIRED - at least one AI provider)
ANTHROPIC_API_KEY=your_anthropic_api_key_here
ANTHROPIC_MODEL=claude-3-opus-20240229

# Grok Configuration (OPTIONAL)
GROK_API_KEY=your_grok_api_key_here
GROK_MODEL=grok-beta
GROK_BASE_URL=https://api.x.ai/v1

# Notion Configuration (REQUIRED)
NOTION_API_KEY=your_notion_api_key_here
NOTION_REASONING_PAGE_ID=your_reasoning_page_id_here
NOTION_TLDR_PAGE_ID=your_tldr_page_id_here

# Conversation Limits (OPTIONAL - defaults provided)
MAX_MESSAGES_PER_CONVERSATION=1000
MAX_TOKENS_PER_CONVERSATION=5000000
MAX_CONTEXT_WINDOW_PERCENT=80
CONTEXT_REFRESH_THRESHOLD=50
CONVERSATION_TIMEOUT_MINUTES=60
MAX_AI_RESPONSES_PER_TURN=3
BATCH_REPLY_TIME_WINDOW_SECONDS=60

# Scribe Bot Configuration (OPTIONAL)
SCRIBE_UPDATE_INTERVAL=60
SCRIBE_MODEL=chatgpt

# TLDR Bot Configuration (OPTIONAL)
TLDR_UPDATE_INTERVAL=600
TLDR_MODEL=chatgpt

# Session Planner Configuration (OPTIONAL)
SESSION_PLANNER_MODEL=claude
SESSION_PLANNER_TIMEOUT_MINUTES=30
SESSION_PLANNER_MAX_QUESTIONS=5
SESSION_PLANNER_AUTO_START=false

# Session Moderator Configuration (OPTIONAL)
MODERATOR_CHECK_INTERVAL=10
MODERATOR_TOPIC_DRIFT_THRESHOLD=0.6
MODERATOR_MAX_DRIFT_WARNINGS=3
MODERATOR_PARTICIPANT_BALANCE_CHECK=true
MODERATOR_QUALITY_ASSESSMENT=true

# Logging Configuration (OPTIONAL)
LOG_LEVEL=info
```

## Step 3: Get Discord Bot Token

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application or select an existing one
3. Go to the "Bot" section
4. Click "Add Bot" if needed
5. Under "Token", click "Reset Token" or "Copy" to get your bot token
6. Enable the following **Privileged Gateway Intents**:
   - ✅ **MESSAGE CONTENT INTENT** (Required!)
   - ✅ Server Members Intent (Optional, for member info)
   - ✅ Presence Intent (Optional, for presence info)

7. Go to "OAuth2" > "URL Generator"
   - Select scopes: `bot`
   - Select bot permissions:
     - ✅ Read Messages/View Channels
     - ✅ Send Messages
     - ✅ Read Message History
     - ✅ Use External Emojis
     - ✅ Add Reactions
   - Copy the generated URL and open it in your browser
   - Select your server and authorize

8. Get your **Guild ID** (Server ID):
   - Enable Developer Mode in Discord (User Settings > Advanced > Developer Mode)
   - Right-click your server name > Copy Server ID

9. Get your **Channel ID**:
   - Right-click the channel where you want the bot to operate > Copy Channel ID

## Step 4: Get Notion API Key and Page IDs

### Create Notion Integration

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Give it a name (e.g., "Super Brainstorm Bot")
4. Select your workspace
5. Under "Capabilities", enable:
   - ✅ Read content
   - ✅ Update content
   - ✅ Insert content
6. Click "Submit" and copy the **Internal Integration Token** (this is your `NOTION_API_KEY`)

### Create Notion Pages

1. Create two pages in your Notion workspace:
   - **Reasoning Page**: For detailed conversation documentation (Scribe Bot)
   - **TLDR Page**: For conversation summaries (TLDR Bot)

2. Share the pages with your integration:
   - Open each page
   - Click "..." (three dots) > "Add connections"
   - Select your integration

3. Get the Page IDs:
   - Open each page in your browser
   - The URL will look like: `https://www.notion.so/Your-Page-Name-abc123def456...`
   - The Page ID is the part after the last `-` (e.g., `abc123def456...`)
   - Copy the full ID (it's a long string of characters)

## Step 5: Get AI API Keys

### OpenAI (Required - at least one AI provider)

1. Go to [OpenAI API Keys](https://platform.openai.com/api-keys)
2. Sign in or create an account
3. Click "Create new secret key"
4. Copy the key (you won't see it again!)

### Anthropic (Required - at least one AI provider)

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Sign in or create an account
3. Go to API Keys section
4. Create a new API key
5. Copy the key

### Grok (Optional)

1. Go to [X.AI Developer Portal](https://x.ai/)
2. Sign in with your X account
3. Navigate to API keys section
4. Create a new API key

## Step 6: Build the Project

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` folder.

## Step 7: Run the Bot

### Development Mode (with auto-reload)

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

## Step 8: Verify It's Working

1. Check the console logs - you should see:
   ```
   Starting Super Brainstorm Bot...
   Configuration loaded
   Notion service initialized
   Registered X AI adapters: ...
   Context manager initialized
   ...
   Discord bot logged in as YourBot#1234
   Super Brainstorm Bot is running!
   ```

2. Go to your Discord server and channel
3. Send a message (not a command) - the bot should start the planning phase
4. The Session Planner bot should respond with clarifying questions or a plan

## Troubleshooting

### Bot doesn't respond

- ✅ Check that the bot is online in Discord
- ✅ Verify `DISCORD_CHANNEL_ID` matches the channel you're using
- ✅ Ensure MESSAGE CONTENT INTENT is enabled in Discord Developer Portal
- ✅ Check console logs for errors

### "Missing required environment variables" error

- ✅ Make sure `.env` file exists in the root directory
- ✅ Verify all required variables are set (no empty values)
- ✅ Check for typos in variable names

### "Discord bot logged in" but no response

- ✅ Verify the channel ID is correct
- ✅ Check that the bot has permissions in that channel
- ✅ Ensure the bot can see the channel (not hidden)

### Notion errors

- ✅ Verify the integration is shared with both pages
- ✅ Check that Page IDs are correct (long strings, not page names)
- ✅ Ensure the integration has "Update content" permission

### AI API errors

- ✅ Verify API keys are correct
- ✅ Check your API account has credits/quota
- ✅ Try a different model if one fails

## Commands

Once the bot is running, you can use these commands in Discord:

- `!start` or `!approve` - Approve plan and start conversation
- `!continue` - Resume paused conversation
- `!stop` - Stop conversation
- `!pause` - Pause conversation
- `!status` - Show conversation status
- `!refresh` - Force context refresh from Notion
- `!focus` - Show current conversation focus
- `!summary` - Show conversation summary

## Next Steps

- Read `ARCHITECTURE.md` for system design details
- Read `IMPLEMENTATION.md` for implementation details
- Check `STATUS.md` for current progress
- Customize prompts in `src/prompts/` directory

## Support

If you encounter issues:

1. Check the console logs for error messages
2. Verify all environment variables are set correctly
3. Ensure all API keys are valid and have credits
4. Check that Discord bot has proper permissions

Happy brainstorming! 🚀

