## Detailed Implementation Plan

This section provides a comprehensive, step-by-step implementation guide for developers to build the Super Brainstorm Bot system.

### Project Structure

```
superbrainstormbot/
├── src/
│   ├── index.ts                    # Main entry point
│   ├── config/
│   │   └── index.ts                # Configuration management
│   ├── types/
│   │   └── index.ts                # TypeScript type definitions
│   ├── utils/
│   │   ├── logger.ts               # Logging utility
│   │   ├── token-counter.ts         # Token counting utilities
│   │   └── prompt-loader.ts        # System prompt loader utility
│   ├── prompts/                    # System prompts directory
│   │   ├── README.md               # Prompts documentation
│   │   ├── session-planner-analyze.txt
│   │   ├── session-planner-plan.txt
│   │   ├── session-planner-drift.txt
│   │   ├── scribe-compress.txt
│   │   ├── tldr-summary.txt
│   │   └── conversation-coordinator.txt
│   ├── adapters/
│   │   ├── base-adapter.ts          # Base adapter interface
│   │   ├── openrouter-adapter.ts    # OpenRouter implementation (unified for all models)
│   │   └── index.ts                 # Adapter registry
│   ├── bot/
│   │   └── discord-bot.ts          # Discord bot core
│   ├── services/
│   │   ├── context-manager.ts       # Context management
│   │   ├── conversation-coordinator.ts  # Conversation orchestration
│   │   ├── session-planner.ts       # Session planning & moderation
│   │   ├── scribe-bot.ts            # Conversation documentation
│   │   ├── tldr-bot.ts              # Summary generation
│   │   └── notion-service.ts        # Notion integration
│   └── tests/                       # Test files
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

### Phase 1: Foundation Setup

#### Task 1.1: Project Initialization

**Priority**: Critical\
**Estimated Time**: 2-4 hours\
**Dependencies**: None

**Steps**:

1. Initialize Node.js project: `npm init -y`
2. Set up TypeScript: `npm install -D typescript @types/node ts-node`
3. Create `tsconfig.json` with strict settings
4. Set up project structure (create all directories)
5. Initialize Git repository

**Acceptance Criteria**:

* \[ ] Project compiles with TypeScript
* \[ ] All directories created
* \[ ] `.gitignore` configured
* \[ ] Basic `package.json` scripts working

**Files to Create**:

* `tsconfig.json`
* `.gitignore`
* `package.json`
* Basic directory structure

#### Task 1.2: Environment Configuration

**Priority**: Critical\
**Estimated Time**: 1-2 hours\
**Dependencies**: Task 1.1

**Steps**:

1. Install `dotenv`: `npm install dotenv`
2. Create `.env.example` with all required variables
3. Create `src/config/index.ts` for configuration management
4. Implement configuration validation
5. Add type-safe config access

**Acceptance Criteria**:

* \[ ] All environment variables documented in `.env.example`
* \[ ] Configuration loads and validates on startup
* \[ ] Missing required variables show clear error messages
* \[ ] Type-safe config access throughout codebase

**Code Structure**:

```typescript
// src/config/index.ts
export interface Config {
  discord: { token: string; guildId: string; channelId: string };
  openai: { apiKey: string; model: string };
  anthropic: { apiKey: string; model: string };
  grok: { apiKey: string; model: string };
  notion: { apiKey: string; reasoningPageId: string; tldrPageId: string };
  limits: { /* ... */ };
  scribe: { updateInterval: number; model: string };
  tldr: { updateInterval: number; model: string };
  sessionPlanner: { /* ... */ };
  moderator: { /* ... */ };
}
```

#### Task 1.3: Logging System

**Priority**: High\
**Estimated Time**: 1-2 hours\
**Dependencies**: Task 1.1

**Steps**:

1. Install logging library: `npm install winston` or use `console` with levels
2. Create `src/utils/logger.ts`
3. Implement log levels (error, warn, info, debug)
4. Add structured logging with timestamps
5. Configure log output (console/file)

**Acceptance Criteria**:

* \[ ] Logging works with different levels
* \[ ] Timestamps included
* \[ ] Can be configured for production vs development
* \[ ] Sensitive data not logged

#### Task 1.4: Type Definitions

**Priority**: Critical\
**Estimated Time**: 2-3 hours\
**Dependencies**: Task 1.1

**Steps**:

1. Create `src/types/index.ts`
2. Define all interfaces from architecture:
   * `Message`
   * `ConversationState`
   * `AIResponse`
   * `AIAdapter` interface
   * `Config`
3. Export all types

**Acceptance Criteria**:

* \[ ] All types from architecture document defined
* \[ ] Types are exported and reusable
* \[ ] No `any` types (use proper typing)
* \[ ] Types match architecture specifications
* \[ ] Planning and moderation states included

#### Task 1.5: Prompt System

**Priority**: High\
**Estimated Time**: 2-3 hours\
**Dependencies**: Task 1.1

**Steps**:

1. Create `src/prompts/` directory
2. Create `src/utils/prompt-loader.ts` utility
3. Extract all system prompts to separate `.txt` files:
   * `session-planner-analyze.txt`
   * `session-planner-plan.txt`
   * `session-planner-drift.txt`
   * `scribe-compress.txt`
   * `tldr-summary.txt`
   * `conversation-coordinator.txt`
4. Implement prompt loading with variable replacement
5. Add prompt caching for performance
6. Create `src/prompts/README.md` documentation

**Acceptance Criteria**:

* \[ ] All prompts extracted to separate files
* \[ ] Prompt loader utility works
* \[ ] Variable replacement works (`{variableName}`)
* \[ ] Prompts are cached for performance
* \[ ] Documentation created
* \[ ] All services use prompt loader

**Code Structure**:

```typescript
// src/utils/prompt-loader.ts
export class PromptLoader {
  static loadPrompt(filename: string, replacements?: Record<string, string | number>): string
  static clearCache(): void
}
```

### Phase 2: Discord Integration

#### Task 2.1: Discord Bot Setup

**Priority**: Critical\
**Estimated Time**: 3-4 hours\
**Dependencies**: Phase 1 complete

**Steps**:

1. Install `discord.js`: `npm install discord.js`
2. Create Discord application in Discord Developer Portal
3. Get bot token and configure permissions
4. Create `src/bot/discord-bot.ts` skeleton
5. Implement basic connection and ready event

**Acceptance Criteria**:

* \[ ] Bot connects to Discord successfully
* \[ ] Ready event fires and logs confirmation
* \[ ] Bot appears online in Discord
* \[ ] Error handling for connection failures

**Code Structure**:

```typescript
// src/bot/discord-bot.ts
export class DiscordBot {
  private client: Client;
  private config: Config;
  
  constructor(config: Config) { /* ... */ }
  async start(): Promise<void> { /* ... */ }
  async stop(): Promise<void> { /* ... */ }
}
```

#### Task 2.2: Message Listening

**Priority**: Critical\
**Estimated Time**: 2-3 hours\
**Dependencies**: Task 2.1

**Steps**:

1. Implement `messageCreate` event handler
2. Filter messages (ignore bots, check channel)
3. Parse commands (messages starting with `!`)
4. Route to appropriate handlers
5. Add error handling

**Acceptance Criteria**:

* \[ ] Receives messages from configured channel
* \[ ] Ignores bot messages (except own)
* \[ ] Commands parsed correctly
* \[ ] Errors handled gracefully

#### Task 2.3: Message Posting & Threading

**Priority**: Critical\
**Estimated Time**: 3-4 hours\
**Dependencies**: Task 2.2

**Steps**:

1. Implement `postAIResponse` method
2. Handle message references (reply-to)
3. Support thread replies
4. Format AI responses with model name
5. Handle rate limiting errors

**Acceptance Criteria**:

* \[ ] Can post messages to Discord
* \[ ] Reply references work correctly
* \[ ] Thread replies work
* \[ ] Rate limiting handled (queue/retry)
* \[ ] Messages formatted properly

#### Task 2.4: Command Handling Framework

**Priority**: High\
**Estimated Time**: 2-3 hours\
**Dependencies**: Task 2.2

**Steps**:

1. Create command parser
2. Implement command registry pattern
3. Add command validation
4. Create base command handler interface
5. Implement basic commands (!status, !help)

**Acceptance Criteria**:

* \[ ] Commands parsed and routed correctly
* \[ ] Unknown commands show helpful message
* \[ ] Command structure extensible
* \[ ] Basic commands work

### Phase 3: AI Adapter System

#### Task 3.1: Base Adapter Interface

**Priority**: Critical\
**Estimated Time**: 2-3 hours\
**Dependencies**: Phase 1, Phase 2

**Steps**:

1. Create `src/adapters/base-adapter.ts`
2. Define `AIAdapter` interface with methods:
   * `generateResponse(messages, systemPrompt, replyTo): Promise<AIResponse>`
   * `getModelName(): string`
   * `checkContextWindow(): number`
3. Create abstract base class with common functionality
4. Add error handling structure

**Acceptance Criteria**:

* \[ ] Interface clearly defined
* \[ ] All adapters can implement interface
* \[ ] Common functionality in base class
* \[ ] Error types defined

**Code Structure**:

```typescript
// src/adapters/base-adapter.ts
export interface AIAdapter {
  generateResponse(
    messages: Message[],
    systemPrompt: string,
    replyTo: string[]
  ): Promise<AIResponse>;
  getModelName(): string;
  checkContextWindow(): number;
}

export abstract class BaseAdapter implements AIAdapter {
  protected apiKey: string;
  protected model: string;
  // Common implementation
}
```

#### Task 3.2: OpenRouter Adapter

**Priority**: Critical\
**Estimated Time**: 4-5 hours\
**Dependencies**: Task 3.1

**Steps**:

1. Install OpenRouter SDK: `npm install @openrouter/ai-sdk-provider`
2. Create `src/adapters/openrouter-adapter.ts`
3. Implement OpenRouter provider using `createOpenRouter`
4. Support model ID format: `"provider/model-id"` (e.g., `"openai/gpt-4o"`)
5. Implement `generateResponse` method
6. Handle rate limiting and retries with circuit breaker
7. Implement token counting
8. Format responses for Discord

**Acceptance Criteria**:

* \[x] Successfully calls OpenRouter API for any model
* \[x] Handles rate limits with retries
* \[x] Token counting accurate
* \[x] Responses formatted correctly
* \[x] Error handling comprehensive
* \[x] Supports on-demand model creation

**Technical Details**:

* Model format: `"provider/model-id"` (e.g., `"openai/gpt-4o"`, `"anthropic/claude-3-5-sonnet"`)
* Context window: Varies by model (OpenRouter normalizes this)
* Implement exponential backoff for retries
* Use circuit breaker pattern for resilience
* See: https://openrouter.ai/docs/api-reference/overview

#### Task 3.3: Adapter Registry

**Priority**: Critical\
**Estimated Time**: 2-3 hours\
**Dependencies**: Task 3.2

**Steps**:

1. Create `src/adapters/index.ts`
2. Implement adapter registry with OpenRouter
3. Register default models (OpenAI, Anthropic, Grok) with aliases
4. Add on-demand adapter creation for any OpenRouter model ID
5. Handle missing adapters gracefully
6. Add logging

**Acceptance Criteria**:

* \[x] Registry can create and retrieve adapters
* \[x] Supports both aliases (`chatgpt`, `claude`) and model IDs (`openai/gpt-4o`)
* \[x] Creates adapters on-demand for any OpenRouter model
* \[x] Handles missing adapters gracefully
* \[x] Provides clear error messages

### Phase 4: Session Planner Bot (Planning Phase)

#### Task 4.1: Message Analysis

**Priority**: Critical\
**Estimated Time**: 3-4 hours\
**Dependencies**: Phase 3, Task 1.5 (Prompt System)

**Steps**:

1. Create `src/services/session-planner.ts`
2. Implement `analyzeMessage` method
3. Use AI adapter with prompt from `session-planner-analyze.txt`
4. Identify gaps and ambiguities
5. Return analysis results

**Acceptance Criteria**:

* \[ ] Analyzes messages correctly
* \[ ] Identifies areas needing clarification
* \[ ] Returns structured analysis
* \[ ] Uses prompt from file system

**Prompt Location**: `src/prompts/session-planner-analyze.txt`

#### Task 4.2: Clarification Question Generation

**Priority**: Critical\
**Estimated Time**: 3-4 hours\
**Dependencies**: Task 4.1, Task 1.5 (Prompt System)

**Steps**:

1. Implement `generateClarifyingQuestions` method
2. Use AI with prompt from `session-planner-analyze.txt` (includes variable replacement for maxQuestions)
3. Generate questions based on analysis
4. Limit to MAX\_QUESTIONS (configurable)
5. Format questions for Discord
6. Post as thread reply

**Acceptance Criteria**:

* \[ ] Generates relevant questions
* \[ ] Questions posted as thread replies
* \[ ] Respects max questions limit
* \[ ] Questions are clear and helpful
* \[ ] Uses prompt from file system

#### Task 4.3: Parameter Assessment

**Priority**: Critical\
**Estimated Time**: 4-5 hours\
**Dependencies**: Task 4.1

**Steps**:

1. Implement `assessConversationParameters` method
2. Analyze topic complexity
3. Estimate required resources:
   * Max messages (based on scope)
   * Max tokens (based on complexity)
   * Timeout (based on expected duration)
   * Context window percentage
4. Return parameter object

**Acceptance Criteria**:

* \[ ] Parameters assessed accurately
* \[ ] Based on topic analysis
* \[ ] Within reasonable bounds
* \[ ] Configurable defaults available

**Algorithm**:

```typescript
// Pseudo-code
function assessParameters(topic, analysis) {
  const complexity = estimateComplexity(topic, analysis);
  return {
    maxMessages: Math.min(1000, Math.max(100, complexity * 50)),
    maxTokens: Math.min(5000000, Math.max(100000, complexity * 100000)),
    timeoutMinutes: Math.min(120, Math.max(30, complexity * 10)),
    maxContextWindowPercent: 70 + (complexity * 10)
  };
}
```

#### Task 4.4: Conversation Plan Generation

**Priority**: Critical\
**Estimated Time**: 4-5 hours\
**Dependencies**: Task 4.3, Task 1.5 (Prompt System)

**Steps**:

1. Implement `createConversationPlan` method
2. Use AI with prompt from `session-planner-plan.txt` to generate structured plan
3. Include: objectives, key areas, expected flow, parameters
4. Format plan for display
5. Store in conversation state

**Acceptance Criteria**:

* \[ ] Plan generated with clear structure
* \[ ] Includes all required elements
* \[ ] Formatted for Discord display
* \[ ] Stored in conversation state
* \[ ] Uses prompt from file system

**Prompt Location**: `src/prompts/session-planner-plan.txt`

#### Task 4.5: Message Expansion

**Priority**: High\
**Estimated Time**: 3-4 hours\
**Dependencies**: Task 4.4

**Steps**:

1. Implement `expandMessage` method
2. Use AI to expand on original message
3. Incorporate user responses to questions
4. Create comprehensive topic description
5. Store expanded message

**Acceptance Criteria**:

* \[ ] Expands message meaningfully
* \[ ] Incorporates clarifications
* \[ ] Creates comprehensive description
* \[ ] Stored for conversation initialization

#### Task 4.6: Approval Mechanism

**Priority**: Critical\
**Estimated Time**: 2-3 hours\
**Dependencies**: Task 4.4, Task 2.4

**Steps**:

1. Implement approval waiting logic
2. Listen for `!start` or `!approve` commands
3. Handle timeout (30 minutes default)
4. Create conversation on approval
5. Transition to active state

**Acceptance Criteria**:

* \[ ] Waits for approval correctly
* \[ ] Handles timeout
* \[ ] Creates conversation on approval
* \[ ] Transitions to active state

### Phase 5: Session Moderator (Moderation Phase)

#### Task 5.1: Message Monitoring

**Priority**: Critical\
**Estimated Time**: 3-4 hours\
**Dependencies**: Phase 4, Phase 2

**Steps**:

1. Implement `monitorMessage` method
2. Hook into message flow from coordinator
3. Track all messages (AI and human)
4. Maintain moderation state
5. Trigger checks at intervals

**Acceptance Criteria**:

* \[ ] Monitors all messages
* \[ ] Tracks in moderation state
* \[ ] Checks triggered at intervals
* \[ ] Non-blocking (async)

#### Task 5.2: Topic Drift Detection

**Priority**: Critical\
**Estimated Time**: 5-6 hours\
**Dependencies**: Task 5.1, Task 1.5 (Prompt System)

**Steps**:

1. Implement semantic similarity analysis
2. Compare message content to original objectives
3. Use AI with prompt from `session-planner-drift.txt` to assess relevance
4. Calculate drift score
5. Threshold-based detection

**Acceptance Criteria**:

* \[ ] Detects topic drift accurately
* \[ ] Uses semantic similarity
* \[ ] Configurable threshold
* \[ ] Returns drift severity
* \[ ] Uses prompt from file system

**Implementation**:

* Use AI to compare message to original plan
* Calculate similarity score (0-1)
* Compare to `MODERATOR_TOPIC_DRIFT_THRESHOLD`
* Track drift count

**Prompt Location**: `src/prompts/session-planner-drift.txt`

#### Task 5.3: Gentle Redirect Generation

**Priority**: High\
**Estimated Time**: 3-4 hours\
**Dependencies**: Task 5.2

**Steps**:

1. Implement `generateRedirectMessage` method
2. Use AI to create polite redirect
3. Acknowledge current discussion
4. Remind of objectives
5. Suggest returning to topic

**Acceptance Criteria**:

* \[ ] Redirects are polite and helpful
* \[ ] Acknowledge current discussion
* \[ ] Reference original plan
* \[ ] Posted as thread reply

#### Task 5.4: Limit Monitoring

**Priority**: Critical\
**Estimated Time**: 3-4 hours\
**Dependencies**: Task 5.1

**Steps**:

1. Implement limit checking:
   * Time limits
   * Message count
   * Token usage
   * Context window
2. Check against conversation parameters
3. Trigger assessment when limits reached
4. Log limit status

**Acceptance Criteria**:

* \[ ] All limits monitored
* \[ ] Checks against parameters
* \[ ] Triggers assessment correctly
* \[ ] Logs status

#### Task 5.5: Quality Assessment

**Priority**: High\
**Estimated Time**: 4-5 hours\
**Dependencies**: Task 5.4

**Steps**:

1. Implement `assessConversationQuality` method
2. Use AI to evaluate:
   * Goals achieved
   * Key insights
   * Participant engagement
   * Productivity
3. Generate quality score
4. Return assessment

**Acceptance Criteria**:

* \[ ] Assesses quality accurately
* \[ ] Evaluates all criteria
* \[ ] Generates score
* \[ ] Returns structured assessment

#### Task 5.6: Graceful Termination

**Priority**: Critical\
**Estimated Time**: 4-5 hours\
**Dependencies**: Task 5.5

**Steps**:

1. Implement `terminateConversation` method
2. Generate conversation summary
3. Highlight key outcomes
4. Post summary to Discord
5. Set status to 'completed'
6. Thank participants

**Acceptance Criteria**:

* \[ ] Summary generated
* \[ ] Key outcomes highlighted
* \[ ] Posted to Discord
* \[ ] Status updated
* \[ ] Participants notified

### Phase 6: Conversation Management

#### Task 6.1: Context Manager

**Priority**: Critical\
**Estimated Time**: 5-6 hours\
**Dependencies**: Phase 1, Phase 9 (Notion)

**Steps**:

1. Create `src/services/context-manager.ts`
2. Implement conversation state storage (in-memory Map)
3. Implement `createConversation` method
4. Implement `addMessage` method
5. Implement context window tracking
6. Implement token counting
7. Implement `shouldRefreshContext` logic
8. Implement `refreshContext` from Notion

**Acceptance Criteria**:

* \[ ] Conversations stored and retrieved
* \[ ] Messages added correctly
* \[ ] Context window tracked
* \[ ] Token counting accurate
* \[ ] Refresh logic works

**Code Structure**:

```typescript
export class ContextManager {
  private conversations: Map<string, ConversationState>;
  
  createConversation(id, channelId, topic, participants): ConversationState
  addMessage(conversationId, message): void
  getMessages(conversationId): Message[]
  shouldRefreshContext(conversationId): boolean
  async refreshContext(conversationId): Promise<void>
  checkLimits(conversationId): { exceeded: boolean; reason?: string }
}
```

#### Task 6.2: Conversation Coordinator

**Priority**: Critical\
**Estimated Time**: 6-8 hours\
**Dependencies**: Task 6.1, Phase 3, Task 1.5 (Prompt System)

**Steps**:

1. Create `src/services/conversation-coordinator.ts`
2. Implement `handleNewMessage` method
3. Implement `shouldAIsRespond` logic
4. Implement `triggerAIResponses` method
5. Implement parallel response queue (use `p-queue`)
6. Implement batching logic
7. Implement reply-to calculation
8. Implement `buildSystemPrompt` using prompt from `conversation-coordinator.txt`
9. Add error handling

**Acceptance Criteria**:

* \[ ] Handles new messages correctly
* \[ ] Determines when AIs should respond
* \[ ] Queues responses in parallel
* \[ ] Batching works correctly
* \[ ] Reply-to calculated properly
* \[ ] System prompt loaded from file with topic variable replacement
* \[ ] Errors handled gracefully

**Key Implementation Details**:

* Use `p-queue` for parallel processing (concurrency: 3)
* Track recent messages for batching
* Calculate reply-to based on time window
* Limit to max 5 references
* System prompt uses `conversation-coordinator.txt` with `{topic}` variable

**Prompt Location**: `src/prompts/conversation-coordinator.txt`

#### Task 6.3: Turn-Taking Logic

**Priority**: High\
**Estimated Time**: 3-4 hours\
**Dependencies**: Task 6.2

**Steps**:

1. Implement logic to determine which AIs respond
2. Track recent AI responses
3. Limit responses per turn
4. Handle AI-to-AI responses
5. Prevent infinite loops

**Acceptance Criteria**:

* \[ ] Turn-taking works correctly
* \[ ] Limits respected
* \[ ] No infinite loops
* \[ ] Balanced participation

### Phase 7: Scribe Bot

#### Task 7.1: Conversation Monitoring

**Priority**: High\
**Estimated Time**: 2-3 hours\
**Dependencies**: Phase 6

**Steps**:

1. Create `src/services/scribe-bot.ts`
2. Implement `notifyNewMessages` method
3. Set up debouncing with timeout queue
4. Track conversations being updated
5. Clear timeouts on new messages

**Acceptance Criteria**:

* \[ ] Monitors conversations
* \[ ] Debouncing works correctly
* \[ ] Timeouts managed properly
* \[ ] Non-blocking

#### Task 7.2: Conversation Documentation (Verbose)

**Priority**: Critical\
**Estimated Time**: 4-5 hours\
**Dependencies**: Task 7.1, Phase 3, Task 1.5 (Prompt System)

**Steps**:

1. Implement `compressConversation` method
2. Format conversation for documentation
3. Use AI adapter with verbose prompt to document conversation
4. Preserve ALL key reasoning and thought processes (keep verbose)
5. Maintain complete discussion flow with context
6. Highlight important insights while keeping details
7. Handle documentation failures (fallback)

**Acceptance Criteria**:

* \[ ] Documents conversations in verbose detail
* \[ ] Preserves all key reasoning and thought processes
* \[ ] Maintains complete discussion flow
* \[ ] Keeps technical details and examples
* \[ ] Fallback on failure
* \[ ] Formatted correctly

**Note**: The Scribe bot now creates **verbose, detailed documentation** rather than compressed summaries. This detailed documentation is then used by the TLDR bot to extract concise summaries.

**Prompt Location**: `src/prompts/scribe-compress.txt`

#### Task 7.3: Notion Integration (Scribe)

**Priority**: Critical\
**Estimated Time**: 3-4 hours\
**Dependencies**: Task 7.2, Phase 9

**Steps**:

1. Implement `updateReasoningDocument` in NotionService
2. Format compressed content
3. Append to Notion page
4. Handle errors and retries
5. Add metadata (timestamp, stats)

**Acceptance Criteria**:

* \[ ] Updates Notion successfully
* \[ ] Content formatted correctly
* \[ ] Errors handled
* \[ ] Metadata included

### Phase 8: TLDR Bot

#### Task 8.1: Update Interval Management

**Priority**: High\
**Estimated Time**: 2-3 hours\
**Dependencies**: Phase 6

**Steps**:

1. Create `src/services/tldr-bot.ts`
2. Implement `checkAndUpdate` method
3. Track last update time per conversation
4. Check interval before updating
5. Skip if too soon

**Acceptance Criteria**:

* \[ ] Interval checking works
* \[ ] Tracks last update
* \[ ] Skips when too soon
* \[ ] Non-blocking

#### Task 8.2: TLDR Generation from Notion

**Priority**: Critical\
**Estimated Time**: 4-5 hours\
**Dependencies**: Task 8.1, Phase 3, Phase 7, Phase 9, Task 1.5 (Prompt System)

**Steps**:

1. Implement `generateTLDR` method
2. **Read detailed documentation from Notion** (scribe's verbose content)
3. Use AI to extract concise summary from detailed documentation
4. Extract key findings from the detailed documentation
5. Parse JSON response (with fallback)
6. Handle case when scribe content not yet available

**Acceptance Criteria**:

* \[ ] Reads scribe's detailed documentation from Notion
* \[ ] Extracts concise summary from verbose documentation
* \[ ] Extracts key findings
* \[ ] Parses JSON correctly
* \[ ] Fallback to text extraction
* \[ ] Handles missing scribe content gracefully

**Note**: The TLDR bot now **extracts summaries from the Scribe bot's detailed Notion documentation** rather than generating from the raw conversation. This creates a two-tier documentation system:

* **Scribe**: Verbose, detailed documentation (preserves all important information)
* **TLDR**: Concise executive summary extracted from the detailed documentation

**Prompt Location**: `src/prompts/tldr-summary.txt`

#### Task 8.3: Notion Integration (TLDR)

**Priority**: Critical\
**Estimated Time**: 2-3 hours\
**Dependencies**: Task 8.2, Phase 9

**Steps**:

1. Implement `updateTLDR` in NotionService
2. Format summary and findings
3. Append to TLDR page
4. Handle errors

**Acceptance Criteria**:

* \[ ] Updates Notion successfully
* \[ ] Formatted correctly
* \[ ] Errors handled

### Phase 9: Notion Integration

#### Task 9.1: Notion API Client

**Priority**: Critical\
**Estimated Time**: 3-4 hours\
**Dependencies**: Phase 1

**Steps**:

1. Install Notion SDK: `npm install @notionhq/client`
2. Create `src/services/notion-service.ts`
3. Initialize Notion client
4. Implement authentication
5. Test connection

**Acceptance Criteria**:

* \[ ] Notion client initialized
* \[ ] Authentication works
* \[ ] Can connect to Notion
* \[ ] Error handling

#### Task 9.2: Page Structure Setup

**Priority**: High\
**Estimated Time**: 2-3 hours\
**Dependencies**: Task 9.1

**Steps**:

1. Create Notion pages manually (or via API)
2. Get page IDs
3. Document page structure
4. Create templates if needed
5. Configure in environment

**Acceptance Criteria**:

* \[ ] Pages created
* \[ ] Page IDs configured
* \[ ] Structure documented
* \[ ] Ready for updates

#### Task 9.3: Document Update Logic

**Priority**: Critical\
**Estimated Time**: 4-5 hours\
**Dependencies**: Task 9.1

**Steps**:

1. Implement `updateReasoningDocument` method
2. Implement `updateTLDR` method
3. Implement `getCompressedContext` method
4. **Implement `getLatestReasoningContent` method** (for TLDR bot)
5. Format content for Notion blocks
6. Handle block appending
7. Add error handling and retries

**Acceptance Criteria**:

* \[ ] All methods implemented
* \[ ] Content formatted correctly
* \[ ] Blocks appended successfully
* \[ ] Can retrieve latest reasoning content for conversations
* \[ ] Errors handled
* \[ ] Retries work

**Code Structure**:

```typescript
export class NotionService {
  async updateReasoningDocument(conversation, compressedContent): Promise<void>
  async updateTLDR(summary, keyFindings): Promise<void>
  async getCompressedContext(conversationId): Promise<string>
  async getLatestReasoningContent(conversation): Promise<string>  // New method
}
```

### Phase 10: Integration & Testing

#### Task 10.1: Component Integration

**Priority**: Critical\
**Estimated Time**: 6-8 hours\
**Dependencies**: All previous phases

**Steps**:

1. Wire all components together in `src/index.ts`
2. Initialize all services
3. Connect Discord bot to services
4. Set up service dependencies
5. Test end-to-end flow

**Acceptance Criteria**:

* \[ ] All components integrated
* \[ ] Services initialized correctly
* \[ ] Dependencies resolved
* \[ ] Basic flow works

**Integration Order**:

1. Config → Logger
2. Config → All Services
3. Services → Discord Bot
4. Discord Bot → Services (callbacks)

#### Task 10.2: Error Handling Enhancement

**Priority**: High\
**Estimated Time**: 4-5 hours\
**Dependencies**: Task 10.1

**Steps**:

1. Add comprehensive error handling
2. Implement retry logic with exponential backoff
3. Add circuit breakers for failing adapters
4. Implement error logging
5. Add graceful degradation

**Acceptance Criteria**:

* \[ ] All errors handled
* \[ ] Retries work correctly
* \[ ] Circuit breakers functional
* \[ ] Errors logged properly
* \[ ] System degrades gracefully

#### Task 10.3: Unit Testing

**Priority**: High\
**Estimated Time**: 8-10 hours\
**Dependencies**: All phases

**Steps**:

1. Set up testing framework: `npm install -D jest @types/jest ts-jest`
2. Write unit tests for each service
3. Test adapters (with mocks)
4. Test utility functions
5. Achieve >80% code coverage

**Acceptance Criteria**:

* \[ ] Test framework configured
* \[ ] Unit tests for all services
* \[ ] Adapters tested (mocked)
* \[ ] >80% coverage
* \[ ] Tests pass

#### Task 10.4: Integration Testing

**Priority**: High\
**Estimated Time**: 6-8 hours\
**Dependencies**: Task 10.3

**Steps**:

1. Create integration test suite
2. Test conversation flow end-to-end
3. Test error scenarios
4. Test limit enforcement
5. Test moderation features

**Acceptance Criteria**:

* \[ ] Integration tests written
* \[ ] End-to-end flows tested
* \[ ] Error scenarios covered
* \[ ] All tests pass

#### Task 10.5: Performance Optimization

**Priority**: Medium\
**Estimated Time**: 4-6 hours\
**Dependencies**: Task 10.1

**Steps**:

1. Profile application
2. Optimize bottlenecks
3. Implement caching where appropriate
4. Optimize API calls
5. Reduce memory usage

**Acceptance Criteria**:

* \[ ] Performance profiled
* \[ ] Bottlenecks identified and fixed
* \[ ] Caching implemented
* \[ ] Memory usage optimized

### Phase 11: Documentation & Deployment

#### Task 11.1: Code Documentation

**Priority**: Medium\
**Estimated Time**: 4-6 hours\
**Dependencies**: All phases

**Steps**:

1. Add JSDoc comments to all public methods
2. Document complex algorithms
3. Add inline comments where needed
4. Document configuration options
5. Create API documentation

**Acceptance Criteria**:

* \[ ] All public methods documented
* \[ ] Complex logic explained
* \[ ] Configuration documented
* \[ ] API docs generated

#### Task 11.2: User Documentation

**Priority**: High\
**Estimated Time**: 3-4 hours\
**Dependencies**: All phases

**Steps**:

1. Create user guide
2. Document all commands
3. Create setup instructions
4. Add troubleshooting guide
5. Create examples

**Acceptance Criteria**:

* \[ ] User guide complete
* \[ ] All commands documented
* \[ ] Setup instructions clear
* \[ ] Troubleshooting guide helpful

#### Task 11.3: Deployment Configuration

**Priority**: High\
**Estimated Time**: 3-4 hours\
**Dependencies**: All phases

**Steps**:

1. Create Docker configuration (optional)
2. Create deployment scripts
3. Set up environment variable templates
4. Create production configuration
5. Document deployment process

**Acceptance Criteria**:

* \[ ] Deployment config ready
* \[ ] Scripts functional
* \[ ] Environment templates complete
* \[ ] Deployment documented

### Implementation Checklist Summary

**Phase 1: Foundation** (8-13 hours)

* \[x] Project initialization
* \[x] Environment configuration
* \[x] Logging system
* \[x] Type definitions
* \[x] Prompt system (extract prompts to files)

**Phase 2: Discord Integration** (10-14 hours)

* \[ ] Discord bot setup
* \[ ] Message listening
* \[ ] Message posting & threading
* \[ ] Command handling framework

**Phase 3: AI Adapter System** (8-12 hours)

* \[x] Base adapter interface
* \[x] OpenRouter adapter (unified for all models)
* \[x] Adapter registry with on-demand creation

**Phase 4: Session Planner (Planning)** (19-25 hours)

* \[ ] Message analysis
* \[ ] Clarification questions
* \[ ] Parameter assessment
* \[ ] Plan generation
* \[ ] Message expansion
* \[ ] Approval mechanism

**Phase 5: Session Moderator** (22-28 hours)

* \[ ] Message monitoring
* \[ ] Topic drift detection
* \[ ] Redirect generation
* \[ ] Limit monitoring
* \[ ] Quality assessment
* \[ ] Graceful termination

**Phase 6: Conversation Management** (14-18 hours)

* \[ ] Context manager
* \[ ] Conversation coordinator
* \[ ] Turn-taking logic

**Phase 7: Scribe Bot** (9-12 hours)

* \[x] Conversation monitoring
* \[x] Conversation documentation (verbose, detailed)
* \[x] Notion integration

**Phase 8: TLDR Bot** (8-11 hours)

* \[x] Update interval management
* \[x] TLDR generation from Notion (extract from scribe's detailed docs)
* \[x] Notion integration

**Phase 9: Notion Integration** (9-12 hours)

* \[x] Notion API client
* \[x] Page structure setup
* \[x] Document update logic
* \[x] Get latest reasoning content method (for TLDR)

**Phase 10: Integration & Testing** (24-32 hours)

* \[ ] Component integration
* \[ ] Error handling
* \[ ] Unit testing
* \[ ] Integration testing
* \[ ] Performance optimization

**Phase 11: Documentation & Deployment** (10-14 hours)

* \[ ] Code documentation
* \[ ] User documentation
* \[ ] Deployment configuration

**Total Estimated Time**: 151-208 hours (~4-5 weeks for one developer, or 2-3 weeks for a team)

### Important Implementation Notes

#### Two-Tier Documentation System

The system uses a two-tier documentation approach:

1. **Scribe Bot** (Verbose Layer):
   * Creates detailed, verbose documentation of conversations
   * Preserves ALL key reasoning, thought processes, and technical details
   * Maintains complete discussion flow with context
   * Stores in Notion reasoning document
   * Goal: Comprehensive record for future reference

2. **TLDR Bot** (Summary Layer):
   * Extracts concise executive summaries from Scribe's detailed documentation
   * Reads from Notion (not raw conversation)
   * Creates 2-3 paragraph summaries and 3-5 key findings
   * Goal: Quick overview for decision-makers

This approach ensures:

* Detailed information is preserved (Scribe)
* Quick summaries are available (TLDR)
* TLDR is always based on the most complete documentation available
* No information loss in the summarization process

#### Prompt System

All system prompts are stored in `src/prompts/` as separate `.txt` files for easy editing:

* Prompts can be updated without code changes
* Variable replacement supported (`{variableName}`)
* Cached for performance
* Documented in `src/prompts/README.md`

### Development Best Practices

1. **Version Control**: Use Git with meaningful commit messages
2. **Code Reviews**: All code should be reviewed before merging
3. **Testing**: Write tests alongside code, not after
4. **Documentation**: Document as you go, not at the end
5. **Incremental Development**: Complete one phase before moving to next
6. **Error Handling**: Always handle errors explicitly
7. **Logging**: Log important events and errors
8. **Configuration**: Keep all configurable values in config, not hardcoded
9. **Type Safety**: Use TypeScript strictly, avoid `any`
10. **Performance**: Consider performance from the start, optimize later

### Dependencies Between Phases

```
Phase 1 (Foundation)
  ↓
Phase 2 (Discord) ──┐
  ↓                 │
Phase 3 (Adapters) ─┤
  ↓                 │
Phase 4 (Planner) ──┤
  ↓                 │
Phase 5 (Moderator)─┤
  ↓                 │
Phase 6 (Conv Mgmt) ─┤
  ↓                 │
Phase 9 (Notion) ────┤
  ↓                 │
Phase 7 (Scribe) ────┤
  ↓                 │
Phase 8 (TLDR) ─────┤
  ↓                 │
Phase 10 (Integration) ← All phases
  ↓
Phase 11 (Deployment)
```

### Critical Path

The critical path for getting a working system:

1. Phase 1 (Foundation)
2. Phase 2 (Discord) - Basic message handling
3. Phase 3 (Adapters) - At least one adapter (OpenAI)
4. Phase 4 (Planner) - Basic planning
5. Phase 6 (Conv Mgmt) - Basic conversation
6. Phase 10 (Integration) - Wire together

This gives a minimal working system. Other phases can be added incrementally.
