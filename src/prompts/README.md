# System Prompts

This directory contains all system prompts used by the various bots in the Super Brainstorm Bot system.

## Prompt Files

### Session Planner Prompts

- **`session-planner-analyze.txt`** - Used to analyze initial messages and generate clarifying questions
  - Variables: `{maxQuestions}` - Maximum number of questions to generate

- **`session-planner-plan.txt`** - Used to create detailed conversation plans with parameters
  - No variables

- **`session-planner-drift.txt`** - Used to detect topic drift in active conversations
  - Variables: `{topic}` - Original conversation topic, `{currentFocus}` - Current conversation focus

### Scribe Bot Prompt

- **`scribe-compress.txt`** - Used to compress and summarize conversations for Notion documentation
  - No variables

### TLDR Bot Prompt

- **`tldr-summary.txt`** - Used to generate executive summaries and key findings
  - No variables

### Conversation Coordinator Prompt

- **`conversation-coordinator.txt`** - Used as the system prompt for AI participants in conversations
  - Variables: `{topic}` - Current conversation topic

## How to Edit Prompts

1. Simply edit the `.txt` files in this directory
2. Changes take effect on the next bot restart (prompts are cached in memory)
3. For development, you can call `PromptLoader.clearCache()` to reload prompts without restarting

## Variable Replacement

Prompts support variable replacement using `{variableName}` syntax. Variables are replaced at runtime with actual values.

Example:
```
Original topic: {topic}
Current focus: {currentFocus}
```

Will be replaced with:
```
Original topic: Building a new web application
Current focus: Frontend architecture decisions
```

## Best Practices

- Keep prompts clear and specific
- Include output format instructions when JSON is expected
- Test prompt changes in a development environment first
- Document any new variables you add to prompts

