import { describe, it, expect, beforeEach } from '@jest/globals';
import { ContextManager } from '../context-manager.js';
import { NotionService } from '../notion-service.js';
import type { Config } from '../../types/index.js';

// Mock NotionService
jest.mock('../notion-service.js');

describe('ContextManager', () => {
  let contextManager: ContextManager;
  let mockNotionService: jest.Mocked<NotionService>;
  let mockConfig: Config;

  beforeEach(() => {
    mockNotionService = {
      getCompressedContext: jest.fn().mockResolvedValue(''),
    } as unknown as jest.Mocked<NotionService>;

    mockConfig = {
      limits: {
        maxMessagesPerConversation: 100,
        maxTokensPerConversation: 10000,
        maxContextWindowPercent: 80,
        contextRefreshThreshold: 50,
        conversationTimeoutMinutes: 60,
        maxAIResponsesPerTurn: 3,
        batchReplyTimeWindowSeconds: 60,
      },
    } as Config;

    contextManager = new ContextManager(mockNotionService, mockConfig);
  });

  it('should create a conversation', () => {
    const conversation = contextManager.createConversation(
      'conv-1',
      'channel-1',
      'Test topic',
      ['user-1']
    );

    expect(conversation.id).toBe('conv-1');
    expect(conversation.topic).toBe('Test topic');
    expect(conversation.status).toBe('active');
    expect(conversation.messages).toHaveLength(0);
  });

  it('should get a conversation by ID', () => {
    contextManager.createConversation('conv-1', 'channel-1', 'Topic', []);
    const conversation = contextManager.getConversation('conv-1');

    expect(conversation).toBeDefined();
    expect(conversation?.id).toBe('conv-1');
  });

  it('should add a message to a conversation', () => {
    contextManager.createConversation('conv-1', 'channel-1', 'Topic', []);
    
    const message = {
      id: 'msg-1',
      conversationId: 'conv-1',
      authorId: 'user-1',
      authorType: 'user' as const,
      content: 'Hello',
      replyTo: [],
      timestamp: new Date(),
      tokens: 10,
    };

    contextManager.addMessage('conv-1', message);

    const conversation = contextManager.getConversation('conv-1');
    expect(conversation?.messages).toHaveLength(1);
    expect(conversation?.messageCount).toBe(1);
    expect(conversation?.tokenCount).toBe(10);
  });

  it('should throw error when adding message to non-existent conversation', () => {
    const message = {
      id: 'msg-1',
      conversationId: 'conv-1',
      authorId: 'user-1',
      authorType: 'user' as const,
      content: 'Hello',
      replyTo: [],
      timestamp: new Date(),
    };

    expect(() => {
      contextManager.addMessage('conv-1', message);
    }).toThrow('Conversation conv-1 not found');
  });

  it('should check limits correctly', () => {
    const conversation = contextManager.createConversation(
      'conv-1',
      'channel-1',
      'Topic',
      []
    );

    // Should not exceed limits initially
    const limits1 = contextManager.checkLimits('conv-1');
    expect(limits1.exceeded).toBe(false);

    // Exceed message count
    conversation.messageCount = 100;
    const limits2 = contextManager.checkLimits('conv-1');
    expect(limits2.exceeded).toBe(true);
    expect(limits2.reason).toBe('Maximum message count reached');
  });

  it('should update conversation status', () => {
    contextManager.createConversation('conv-1', 'channel-1', 'Topic', []);
    contextManager.updateStatus('conv-1', 'paused');

    const conversation = contextManager.getConversation('conv-1');
    expect(conversation?.status).toBe('paused');
  });

  it('should get messages for a conversation', () => {
    contextManager.createConversation('conv-1', 'channel-1', 'Topic', []);
    
    const message = {
      id: 'msg-1',
      conversationId: 'conv-1',
      authorId: 'user-1',
      authorType: 'user' as const,
      content: 'Hello',
      replyTo: [],
      timestamp: new Date(),
    };

    contextManager.addMessage('conv-1', message);
    const messages = contextManager.getMessages('conv-1');

    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-1');
  });
});

