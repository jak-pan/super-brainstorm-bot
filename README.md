# Super Brainstorm Bot

A Discord bot that enables collaborative brainstorming sessions with multiple AI models (Claude, ChatGPT, Grok, and optionally Cursor) working together. The bot automatically documents conversations in Notion with compressed reasoning and TLDR summaries.

## Features

- 🤖 **Multi-AI Collaboration**: Multiple AI models (Claude, ChatGPT, Grok) participate in conversations
- 💬 **Discord Integration**: Seamless integration with Discord channels
- 📝 **Automatic Documentation**: Conversations are automatically compressed and documented in Notion
- 🧠 **Context Management**: Intelligent context window management with automatic refresh from Notion
- 📊 **TLDR Summaries**: Automatic generation of concise summaries and key findings
- 🔄 **Message Threading**: Smart reply linking and message batching
- ⚙️ **Configurable**: Easy configuration via environment variables

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture documentation with Mermaid diagrams.

## Prerequisites

- Node.js 18+ and npm
- Discord Bot Token
- OpenAI API Key (for ChatGPT)
- Anthropic API Key (for Claude)
- Grok API Key (optional, for Grok)
- Notion API Key and Page IDs

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

# OpenAI
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4-turbo-preview

# Anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key_here
ANTHROPIC_MODEL=claude-3-opus-20240229

# Grok (optional)
GROK_API_KEY=your_grok_api_key_here
GROK_MODEL=grok-beta
GROK_BASE_URL=https://api.x.ai/v1

# Notion
NOTION_API_KEY=your_notion_api_key_here
NOTION_REASONING_PAGE_ID=your_reasoning_page_id_here
NOTION_TLDR_PAGE_ID=your_tldr_page_id_here

# Conversation Limits (optional, defaults shown)
MAX_MESSAGES_PER_CONVERSATION=100
MAX_TOKENS_PER_CONVERSATION=500000
MAX_CONTEXT_WINDOW_PERCENT=80
CONTEXT_REFRESH_THRESHOLD=50
CONVERSATION_TIMEOUT_MINUTES=60
MAX_AI_RESPONSES_PER_TURN=3
BATCH_REPLY_TIME_WINDOW_SECONDS=10

# Scribe Configuration
SCRIBE_UPDATE_INTERVAL=30
SCRIBE_MODEL=chatgpt

# TLDR Configuration
TLDR_UPDATE_INTERVAL=300
TLDR_MODEL=chatgpt

# Logging
LOG_LEVEL=info
```

### 3. Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the bot token
5. Enable "Message Content Intent" in the bot settings
6. Invite the bot to your server with appropriate permissions:
   - Read Messages
   - Send Messages
   - Read Message History

### 4. Notion Setup

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Create a new integration
3. Copy the API key
4. Create two pages in Notion:
   - One for reasoning documents
   - One for TLDR summaries
5. Share these pages with your integration (click "..." → "Add connections")
6. Copy the page IDs from the URLs (the part after the last `/`)

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

Simply post a message in the configured Discord channel. The AI models will automatically join the conversation and start brainstorming together.

### Commands

- `!continue` - Resume a paused conversation
- `!stop` - Stop the current conversation
- `!pause` - Pause the conversation temporarily
- `!status` - Check conversation status and limits
- `!refresh` - Force context refresh from Notion

### How It Works

1. **User posts a message** in the Discord channel
2. **AI models respond** - Multiple AIs generate responses based on the conversation context
3. **AIs interact** - AIs can respond to each other, building on previous responses
4. **Scribe bot compresses** - The conversation is automatically compressed and stored in Notion
5. **TLDR bot summarizes** - Key findings and summaries are generated periodically
6. **Context refresh** - When context windows get full, the bot automatically refreshes from Notion

## Project Structure

```
superbrainstormbot/
├── src/
│   ├── adapters/          # AI adapter implementations
│   │   ├── base-adapter.ts
│   │   ├── openai-adapter.ts
│   │   ├── anthropic-adapter.ts
│   │   ├── grok-adapter.ts
│   │   ├── cursor-adapter.ts
│   │   └── index.ts
│   ├── bot/               # Discord bot implementation
│   │   └── discord-bot.ts
│   ├── config/            # Configuration management
│   │   └── index.ts
│   ├── services/          # Core services
│   │   ├── context-manager.ts
│   │   ├── conversation-coordinator.ts
│   │   ├── notion-service.ts
│   │   ├── scribe-bot.ts
│   │   └── tldr-bot.ts
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

### Conversation Limits

- `MAX_MESSAGES_PER_CONVERSATION`: Maximum messages before stopping (default: 100)
- `MAX_TOKENS_PER_CONVERSATION`: Maximum tokens before stopping (default: 500000)
- `MAX_CONTEXT_WINDOW_PERCENT`: Context window usage threshold (default: 80%)
- `CONTEXT_REFRESH_THRESHOLD`: When to refresh context from Notion (default: 50%)
- `CONVERSATION_TIMEOUT_MINUTES`: Auto-stop after inactivity (default: 60)
- `MAX_AI_RESPONSES_PER_TURN`: Max AI responses per user message (default: 3)
- `BATCH_REPLY_TIME_WINDOW_SECONDS`: Window for batching replies (default: 10)

### Scribe & TLDR

- `SCRIBE_UPDATE_INTERVAL`: Seconds between scribe updates (default: 30)
- `SCRIBE_MODEL`: Which AI to use as scribe (default: chatgpt)
- `TLDR_UPDATE_INTERVAL`: Seconds between TLDR updates (default: 300)
- `TLDR_MODEL`: Which AI to use for TLDR (default: chatgpt)

## Troubleshooting

### Bot not responding

- Check that the bot token is correct
- Verify the bot has the correct permissions
- Ensure "Message Content Intent" is enabled
- Check logs for errors

### Notion updates failing

- Verify Notion API key is correct
- Ensure pages are shared with the integration
- Check that page IDs are correct

### AI responses not appearing

- Verify API keys are correct for each provider
- Check rate limits on API providers
- Review logs for API errors

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

