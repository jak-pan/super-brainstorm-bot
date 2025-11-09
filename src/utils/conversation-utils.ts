import type { ConversationState } from "../types/index.js";

/**
 * Get the appropriate channel ID for a conversation
 * Returns thread ID if conversation is in a thread, otherwise returns channel ID
 *
 * @param conversation - The conversation state
 * @returns The channel ID (thread ID if in thread, channel ID otherwise), or null if not available
 */
export function getConversationChannelId(
  conversation: ConversationState | undefined
): string | null {
  if (!conversation) {
    return null;
  }

  // Use thread ID if conversation is in a thread, otherwise use channel ID
  return conversation.isThread && conversation.threadId
    ? conversation.threadId
    : conversation.channelId || null;
}

/**
 * Check if a conversation has exceeded its cost limit
 *
 * @param conversation - The conversation state
 * @param costType - Type of cost to check ('conversation' or 'image')
 * @param defaultLimit - Default cost limit if not set on conversation
 * @returns Object with exceeded status, current cost, and limit
 */
export function checkCostLimit(
  conversation: ConversationState | undefined,
  costType: "conversation" | "image",
  defaultLimit: number
): {
  exceeded: boolean;
  current: number;
  limit: number;
} {
  if (!conversation) {
    return { exceeded: false, current: 0, limit: defaultLimit };
  }

  const limit =
    costType === "conversation"
      ? conversation.costLimit || defaultLimit
      : conversation.imageCostLimit || defaultLimit;

  const current =
    costType === "conversation"
      ? conversation.costTracking?.totalCost || 0
      : conversation.imageCostTracking?.totalCost || 0;

  return {
    exceeded: current >= limit,
    current,
    limit,
  };
}

