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

### How It Works

1. **User starts conversation** with `/sbb start` in a channel or thread
2. **Planning starts immediately** - Planner analyzes the first message using promise-based approach
3. **Thread messages** (if in thread): Previous messages are added to context but not compiled yet
4. **Task type detection** - Bot automatically detects task type (general/coding/architecture) and selects appropriate models
5. **Clarification flow**:
   * **If questions are asked**: Conversation stays in planning mode, user responds via messages or `/sbb edit`
   * **After user responds**: Plan is created automatically, conversation waits for `/sbb start` approval
   * **If no questions**: Plan is created immediately
6. **Auto-start or approval**:
   * **With `/sbb start`**: If plan exists, auto-starts conversation (compiles thread messages if needed)
   * **With `/sbb plan`**: Creates plan and waits for `/sbb start` approval
7. **Thread compilation** (on approval, if in thread): Previous messages are compiled by Scribe (detailed) and TLDR (summary)
8. **Conversation starts** - All bots become active and the conversation begins
9. **AI models respond** - Multiple AIs generate responses based on the conversation context
10. **AIs interact** - AIs can respond to each other, building on previous responses
11. **Scribe bot documents** - The conversation is automatically documented in detail and stored in Notion (async, non-blocking)
12. **TLDR bot summarizes** - Key findings and summaries are extracted from Scribe's detailed documentation (async, non-blocking)
13. **Cost tracking** - All costs are tracked directly from OpenRouter API responses (in USD) and aggregated per conversation
14. **Automatic limits** - Conversations pause automatically when conversation cost limit ($22 default) is reached; image generation is blocked when image cost limit ($2 default) is reached
15. **Unblock image generation** - Use `/sbb unblock-image` to resume image generation after it's been blocked
16. **Context refresh** - When message count threshold is reached, the bot automatically refreshes context from Notion

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture documentation with Mermaid diagrams.

## Prerequisites

* Node.js 18+ and npm
* Discord Bot Token
* OpenRouter API Key (provides access to 300+ AI models including OpenAI, Anthropic, Grok, and more)
* Notion API Key and Database/Page ID

## Setup

See [SETUP.md](./SETUP.md) for detailed setup instructions.

## Implementation Status

See [STATUS.md](./STATUS.md) for current implementation progress and feature status.

## Usage

### Commands

All commands use the `/sbb` prefix:

#### Conversation Management

* `/sbb start [topic]` - Start conversation (auto-starts if no plan exists, approves if plan exists)
  * **In a channel**: Topic is required, starts planning immediately using promise-based approach
  * **In a thread**: Topic is optional (uses thread name), fetches all previous messages and adds them to context
  * **If no plan exists**: Creates plan using promise-based approach (no timeout/polling)
    * **If questions are asked**: Conversation stays in planning mode, respond via messages or `/sbb edit`, then plan is created automatically
    * **If no questions**: Creates plan immediately and auto-starts conversation
  * **If plan exists**: Approves plan and starts conversation
    * **In a thread**: Compiles previous messages using Scribe (detailed documentation) and TLDR (summary) before starting
  * The bot automatically detects task type (general/coding/architecture) and selects appropriate AI models
* `/sbb plan [topic]` - Start planning mode (creates plan and waits for approval)
  * Creates a plan using promise-based approach (no timeout/polling)
  * If questions are asked, waits for your response before creating plan
  * Waits for you to approve with `/sbb start`
  * Topic optional in threads (uses thread name)
* `/sbb edit [message]` - Edit the planning message while in planning mode
  * Updates the plan based on your changes
  * If plan is created after edit, waits for `/sbb start` approval
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
