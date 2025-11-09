/**
 * Application constants
 */

// Discord channel types (from discord.js)
export const DISCORD_CHANNEL_TYPES = {
  GUILD_TEXT: 0,
  GUILD_PUBLIC_THREAD: 11,
} as const;

// Message reference limits
export const MAX_MESSAGE_REFERENCES = 5;

// Context refresh settings
export const CONTEXT_REFRESH_KEEP_MESSAGES = 10;
