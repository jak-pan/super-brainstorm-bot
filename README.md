# Super Brainstorm Bot

A Discord bot that enables collaborative brainstorming sessions with multiple AI models (300+ models via OpenRouter including GPT-5, Claude Opus 4.1, Claude Sonnet 4.5, Grok Code Fast, Gemini 2.5 Flash, and more) working together. The bot automatically documents conversations in Notion with detailed reasoning and TLDR summaries, and includes image generation capabilities.

## Features

* 🤖 **Multi-AI Collaboration**: Multiple AI models (300+ via OpenRouter) participate in conversations
* 🎨 **Image Generation**: Generate images from prompts, message links, or attachments using GPT-5 Image and Gemini 2.5 Flash Image
* 🌐 **Built-in Web Search**: Models with web search support (via OpenRouter) for real-time information
* 💬 **Discord Integration**: Seamless integration with Discord channels and threads
* 📝 **Automatic Documentation**: Conversations are automatically documented in Notion with detailed reasoning
* 🧠 **Context Management**: Intelligent context window management with automatic refresh from Notion
* 📊 **TLDR Summaries**: Automatic generation of concise summaries extracted from detailed documentation
* 🔄 **Message Threading**: Smart reply linking, message batching, and thread support
* ⚙️ **Dynamic Model Selection**: Automatic model selection based on task type (general/coding/architecture)
* 💰 **Cost Tracking**: Separate cost tracking for conversations and image generation with automatic limits
* 🔧 **Model Management**: Slash commands for dynamic model selection and management
* 🧵 **Thread Support**: Start conversations in existing threads with automatic compilation of previous discussion

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture documentation with Mermaid diagrams.

## Prerequisites

* Node.js 18+ and npm
* Discord Bot Token
* OpenRouter API Key (provides access to 300+ AI models including OpenAI, Anthropic, Grok, and more)
* Notion API Key and Database/Page ID

## Setup

### 1. Clone and Install

```bash
git clone <repository-url>
cd superbrainstormbot
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the root directory:

```bash
# Discord
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_GUILD_ID=your_guild_id_here
DISCORD_CHANNEL_ID=your_channel_id_here

# OpenRouter (required - provides access to all AI models)
OPENROUTER_API_KEY=your_openrouter_api_key_here
# Get your API key from: https://openrouter.ai/keys

# Notion (required)
# Single database/page ID that hosts all topics as entries
# Each entry contains: Topic name, TLDR content
# Each entry has a subpage: "Reasoning & Transcript" with detailed reasoning
NOTION_API_KEY=your_notion_api_key_here
NOTION_PAGE_ID=your_notion_database_page_id_here

# Logging (optional)
LOG_LEVEL=info
```

### 3. Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the bot token
5. Enable "Message Content Intent" in the bot settings
6. Invite the bot to your server with appropriate permissions:
   * Read Messages
   * Send Messages
   * Read Message History

### 4. Notion Setup

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Create a new integration
3. Copy the API key
4. Create a database or page in Notion (this will host all conversation topics)
5. Share the database/page with your integration (click "..." → "Add connections")
6. Copy the page/database ID from the URL (the part after the last `/`)
7. The bot will automatically create entries for each conversation topic with:
   * Topic name and TLDR summaries in the main entry
   * Detailed reasoning and transcripts in a "Reasoning & Transcript" subpage

### 5. Build and Run

```bash
# Build TypeScript
npm run build

# Run the bot
npm start

# Or run in development mode with auto-reload
npm run dev
```

## Usage

### Starting a Conversation

Use `/sbb start` to begin a new conversation, or `/sbb start-thread` to start in an existing Discord thread. The bot will automatically detect the task type and select appropriate AI models.

### Commands

All commands use the `/sbb` prefix:

#### Conversation Management

* `/sbb start [topic]` - Start a new conversation (creates a new thread)
* `/sbb start-thread [topic]` - Start a conversation in the current thread (compiles previous discussion)
* `/sbb continue` - Continue a paused conversation

#### Model Management

* `/sbb select-models [task-type] [models] [scribe-model] [tldr-model]` - Select AI models for the conversation
  * `task-type`: Choose from `general`, `coding`, or `architecture` to auto-select models
  * `models`: Comma-separated list of model IDs (e.g., `openai/gpt-5,anthropic/claude-opus-4.1`)
  * `scribe-model`: Override Scribe bot model
  * `tldr-model`: Override TLDR bot model
* `/sbb add-model <model-id>` - Add a model to the current conversation
* `/sbb remove-model <model-id>` - Remove a model from the conversation
* `/sbb list-models` - List all models in the current conversation
* `/sbb fetch-models [provider]` - Fetch available models from OpenRouter API

#### Agent Control

* `/sbb stop <agent>` - Stop a specific agent (model ID) or use `all` to stop all agents
  * Protected agents (Manager, Scribe, TLDR, Image Bot) cannot be stopped

#### Image Generation

* `/sbb image [message-link] [prompt] [attachment]` - Generate images from:
  * A Discord message link
  * A text prompt
  * An image attachment (as reference)
* `/sbb unblock-image` - Unblock image generation if it was blocked due to cost limit

#### Settings

* `/sbb settings` - View and modify bot settings (default models, limits, intervals)

### How It Works

1. **User posts a message** in the Discord channel or thread
2. **Task type detection** - Bot automatically detects task type (general/coding/architecture) and selects appropriate models
3. **AI models respond** - Multiple AIs generate responses based on the conversation context
4. **AIs interact** - AIs can respond to each other, building on previous responses
5. **Scribe bot documents** - The conversation is automatically documented in detail and stored in Notion
6. **TLDR bot summarizes** - Key findings and summaries are extracted from Scribe's detailed documentation
7. **Cost tracking** - All costs are tracked directly from OpenRouter API responses (in USD) and aggregated per conversation
8. **Automatic limits** - Conversations pause automatically when conversation cost limit ($22 default) is reached; image generation is blocked when image cost limit ($2 default) is reached
9. **Unblock image generation** - Use `/sbb unblock-image` to resume image generation after it's been blocked
10. **Context refresh** - When message count threshold is reached, the bot automatically refreshes context from Notion

## Project Structure

```
superbrainstormbot/
├── src/
│   ├── adapters/          # AI adapter implementations (OpenRouter)
│   │   ├── base-adapter.ts
│   │   ├── openrouter-adapter.ts  # Unified adapter for all models
│   │   └── index.ts
│   ├── bot/               # Discord bot implementation
│   │   └── discord-bot.ts
│   ├── config/            # Configuration management
│   │   ├── index.ts
│   │   ├── default-settings.json  # Default configuration (models, limits, intervals)
│   │   └── settings-loader.ts     # Settings loader utility
│   ├── services/          # Core services
│   │   ├── context-manager.ts
│   │   ├── conversation-coordinator.ts
│   │   ├── notion-service.ts
│   │   ├── scribe-bot.ts
│   │   ├── tldr-bot.ts
│   │   ├── image-bot.ts   # Image generation service
│   │   ├── model-selector.ts  # Dynamic model selection
│   │   └── session-planner.ts
│   ├── types/             # TypeScript type definitions
│   │   └── index.ts
│   ├── utils/             # Utility functions
│   │   └── logger.ts
│   └── index.ts           # Main entry point
├── ARCHITECTURE.md        # Architecture documentation
├── package.json
├── tsconfig.json
└── README.md
```

## Configuration Options

Most configuration is stored in `src/config/default-settings.json` and can be modified via `/sbb settings` in Discord. The following are the main configuration categories:

### Model Presets

Default models are selected based on task type:

* **General**: Grok Code Fast, Claude Opus 4.1, Claude Sonnet 4.5, Gemini 2.5 Flash, GPT-5
* **Coding**: Grok Code Fast, Claude Opus 4.1, GPT-5 Codex, Claude Sonnet 4.5
* **Architecture**: Grok Code Fast, Claude Opus 4.1, GPT-5 Codex, Claude Sonnet 4.5

Default image models: GPT-5 Image, Gemini 2.5 Flash Image

### Conversation Limits

* `maxMessagesPerConversation`: Maximum messages before stopping (default: 1000)
* `conversationTimeoutMinutes`: Auto-stop after inactivity (default: 60)
* `maxAIResponsesPerTurn`: Max AI responses per user message (default: 3)
* `batchReplyTimeWindowSeconds`: Window for batching replies (default: 60)

### Cost Limits

* `conversation`: USD limit for conversation costs (default: $22)
* `image`: USD limit for image generation costs (default: $2)
* Costs are tracked directly from OpenRouter API responses (no manual calculation)
* Conversations automatically pause when conversation cost limit is reached
* Image generation is blocked when image cost limit is reached
* Use `/sbb unblock-image` to unblock image generation after it's been blocked

### Scribe & TLDR

* `scribe.updateInterval`: Seconds between scribe updates (default: 30)
* `tldr.updateInterval`: Seconds between TLDR updates (default: 300)
* Models are automatically selected based on task type
* Can be overridden via `/sbb select-models` command

### Web Search

* **OpenRouter**: Supports web search for compatible models
  * See: [OpenRouter Web Search Documentation](https://openrouter.ai/docs/features/web-search)
  * Available for models that support it (e.g., Grok models)
  * No additional configuration needed - enabled automatically when supported

## Troubleshooting

### Bot not responding

* Check that the bot token is correct
* Verify the bot has the correct permissions
* Ensure "Message Content Intent" is enabled
* Check logs for errors

### Notion updates failing

* Verify Notion API key is correct
* Ensure pages are shared with the integration
* Check that page IDs are correct

### AI responses not appearing

* Verify OpenRouter API key is correct
* Check rate limits on OpenRouter
* Review logs for API errors
* Ensure models are selected (use `/sbb list-models` to check)

## Development

```bash
# Type check
npm run type-check

# Lint
npm run lint

# Build
npm run build
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
