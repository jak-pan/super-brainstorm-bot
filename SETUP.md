# Setup Guide - Super Brainstorm Bot

This guide will walk you through setting up and running the Super Brainstorm Bot.

## Prerequisites

* Node.js 18+ installed
* npm or yarn package manager
* Discord Bot Token
* OpenRouter API Key (provides access to 300+ AI models)
* Notion API Key and Database/Page ID

## Step 1: Clone and Install Dependencies

```bash
git clone <repository-url>
cd superbrainstormbot
npm install
```

## Step 2: Create Environment File

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Or create it manually with the following content:

```env
# Discord Configuration (required)
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_GUILD_ID=your_guild_id_here

# OpenRouter Configuration (required)
# OpenRouter provides access to 300+ AI models from multiple providers
# Get your API key from: https://openrouter.ai/keys
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Notion Configuration (required)
# Single database/page ID that will host all topics as entries
# Each entry contains: Topic name, TLDR content (first prompt + subsequent TLDRs)
# Each entry has a subpage: "Reasoning & Transcript" with detailed reasoning and full transcript
NOTION_API_KEY=your_notion_api_key_here
NOTION_PAGE_ID=your_notion_database_page_id_here

# Logging (optional)
LOG_LEVEL=info
```

**Note:** Most configuration settings (model presets, limits, intervals) are now stored in `src/config/default-settings.json` and can be modified via `/sbb settings` command in Discord.

## Step 3: Get Discord Bot Token

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)

2. Create a new application or select an existing one

3. Go to the "Bot" section

4. Click "Add Bot" if needed

5. Under "Token", click "Reset Token" or "Copy" to get your bot token

6. Enable the following **Privileged Gateway Intents**:
   * ✅ **MESSAGE CONTENT INTENT** (Required!)
   * ✅ Server Members Intent (Optional, for member info)
   * ✅ Presence Intent (Optional, for presence info)

7. Go to "OAuth2" > "URL Generator"
   * Select scopes: `bot`
   * Select bot permissions:
     * ✅ Read Messages/View Channels
     * ✅ Send Messages
     * ✅ Read Message History
     * ✅ Use External Emojis
     * ✅ Add Reactions
   * Copy the generated URL and open it in your browser
   * Select your server and authorize

8. Get your **Guild ID** (Server ID):
   * Enable Developer Mode in Discord (User Settings > Advanced > Developer Mode)
   * Right-click your server name > Copy Server ID

9. Get your **Channel ID**:
   * Right-click the channel where you want the bot to operate > Copy Channel ID

## Step 4: Get Notion API Key and Database/Page ID

### Create Notion Integration

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Give it a name (e.g., "Super Brainstorm Bot")
4. Select your workspace
5. Under "Capabilities", enable:
   * ✅ Read content
   * ✅ Update content
   * ✅ Insert content
6. Click "Submit" and copy the **Internal Integration Token** (this is your `NOTION_API_KEY`)

### Create Notion Database/Page

1. Create a database or page in your Notion workspace (this will host all conversation topics)
   * You can use a regular page or a database
   * The bot will automatically create entries for each conversation topic

2. Share the database/page with your integration:
   * Open the database/page
   * Click "..." (three dots) > "Add connections"
   * Select your integration

3. Get the Page/Database ID:
   * Open the database/page in your browser
   * The URL will look like: `https://www.notion.so/Your-Page-Name-abc123def456...`
   * The Page ID is the part after the last `-` (e.g., `abc123def456...`)
   * Copy the full ID (it's a long string of characters)
   * This is your `NOTION_PAGE_ID`

**Note:** The bot will automatically:

* Create database entries for each conversation topic
* Store TLDR summaries in the main entry
* Create a "Reasoning & Transcript" subpage for detailed documentation

## Step 5: Get OpenRouter API Key

OpenRouter provides unified access to 300+ AI models from multiple providers (OpenAI, Anthropic, Grok, Google, and more) with a single API key.

1. Go to [OpenRouter API Keys](https://openrouter.ai/keys)
2. Sign in or create an account
3. Click "Create Key"
4. Copy the API key (you won't see it again!)
5. Add credits to your account (OpenRouter uses a pay-as-you-go model)

**Benefits of OpenRouter:**

* ✅ Single API key for all models
* ✅ Access to 300+ models from multiple providers
* ✅ Automatic failover and high availability
* ✅ Transparent pricing and cost tracking
* ✅ Built-in web search support for compatible models
* ✅ No need to manage multiple provider accounts

**Default Models:**
The bot automatically selects models based on task type (general/coding/architecture). Default models are configured in `src/config/default-settings.json` and can be customized via `/sbb settings` command.

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
   Default settings loaded from default-settings.json
   Notion service initialized
   OpenRouter adapter initialized
   Context manager initialized
   ...
   Successfully registered slash commands
   Discord bot logged in as YourBot#1234
   Super Brainstorm Bot is running!
   ```

2. Go to your Discord server and channel

3. Use `/sbb start [topic]` to start a new conversation
   * **In a channel**: Starts planning immediately using promise-based approach
   * **In a thread**:
     * Fetches all previous messages (adds to context)
     * Starts planning immediately with first message
     * **If questions are asked**: Conversation stays in planning mode, respond via messages or `/sbb edit`
     * **After questions answered or if no questions**: Plan is created automatically
     * When you approve (use `/sbb start`), previous messages are compiled (Scribe + TLDR)
     * Then conversation starts with all bots active

4. The bot will automatically detect the task type and select appropriate AI models

5. The Session Planner bot will respond with clarifying questions or a plan:
   * **If questions are asked**: Respond to them, and the plan will be created automatically
   * **If no questions**: Plan is created immediately and conversation auto-starts (or waits for approval with `/sbb plan`)

## Troubleshooting

### Bot doesn't respond

* ✅ Check that the bot is online in Discord
* ✅ Ensure MESSAGE CONTENT INTENT is enabled in Discord Developer Portal
* ✅ Check that the bot has permissions in the channel/thread you're using
* ✅ Check console logs for errors

### "Missing required environment variables" error

* ✅ Make sure `.env` file exists in the root directory
* ✅ Verify all required variables are set (no empty values)
* ✅ Check for typos in variable names

### "Discord bot logged in" but no response

* ✅ Check that the bot has permissions in the channel/thread you're using
* ✅ Ensure the bot can see the channel (not hidden)
* ✅ Verify the bot is in the correct server (guild)

### Notion errors

* ✅ Verify the integration is shared with the database/page
* ✅ Check that Page ID is correct (long string, not page name)
* ✅ Ensure the integration has "Update content" permission
* ✅ Make sure it's a database or page (not a subpage)

### AI API errors

* ✅ Verify OpenRouter API key is correct
* ✅ Check your OpenRouter account has credits
* ✅ Verify the model IDs in `default-settings.json` are valid
* ✅ Check OpenRouter status page if all models fail

## Commands

All commands use the `/sbb` prefix. Once the bot is running, you can use these slash commands in Discord:

### Conversation Management

* `/sbb start [topic]` - Start conversation (auto-starts if no plan exists, approves if plan exists)
  * **If no plan exists**: Creates plan and auto-starts conversation
  * **If plan exists**: Approves plan and starts conversation (compiles previous discussion if in thread)
  * **Topic**: Required if not in thread, optional in threads (uses thread name)
* `/sbb plan [topic]` - Start planning mode (creates plan and waits for approval)
  * Creates a plan and waits for you to approve with `/sbb start`
  * Topic optional in threads (uses thread name)
* `/sbb edit [message]` - Edit the planning message while in planning mode
  * Updates the plan based on your changes
* `/sbb continue` - Continue a paused conversation

### Model Management

* `/sbb select-models [task-type] [models] [scribe-model] [tldr-model]` - Select AI models for the conversation
* `/sbb add-model <model-id>` - Add a model to the current conversation
* `/sbb remove-model <model-id>` - Remove a model from the conversation
* `/sbb list-models` - List all models in the current conversation
* `/sbb fetch-models [provider]` - Fetch available models from OpenRouter API

### Agent Control

* `/sbb stop <agent>` - Stop a specific agent (model ID) or use `all` to stop all agents

### Image Generation

* `/sbb image [message-link] [prompt] [attachment]` - Generate images from a message link, prompt, or attachment
* `/sbb unblock-image` - Unblock image generation if it was blocked due to cost limit

### Settings

* `/sbb settings` - View and modify bot settings (default models, limits, intervals)

**Note:** The bot also processes regular messages in configured channels and threads to continue conversations.

## Configuration

Most settings are stored in `src/config/default-settings.json` and can be modified:

* **Model Presets**: Default models for general, coding, and architecture tasks
* **Cost Limits**: Default cost limits ($22 for conversations, $2 for images)
* **Limits**: Message limits, timeouts, batch settings
* **Intervals**: Scribe and TLDR update intervals
* **Moderator Settings**: Topic drift detection, quality assessment

You can also modify settings interactively via `/sbb settings` command in Discord.

## Next Steps

* Read `ARCHITECTURE.md` for system design details
* Read `IMPLEMENTATION.md` for implementation details
* Check `STATUS.md` for current progress
* Customize prompts in `src/prompts/` directory
* Customize default settings in `src/config/default-settings.json`

## Support

If you encounter issues:

1. Check the console logs for error messages
2. Verify all environment variables are set correctly (only 4 required: Discord token/guild/channel, OpenRouter key, Notion key/page)
3. Ensure OpenRouter API key is valid and has credits
4. Check that Discord bot has proper permissions and MESSAGE CONTENT INTENT is enabled
5. Verify Notion integration is shared with the database/page
6. Check that models in `default-settings.json` are valid OpenRouter model IDs

Happy brainstorming! 🚀
