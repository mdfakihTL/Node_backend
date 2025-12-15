import { Router, Response } from 'express';
import { query, transaction } from '../database/connection';
import { authenticate } from '../middleware/auth';
import { AuthenticatedRequest, Conversation, Message } from '../types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get all conversations
router.get('/conversations', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT c.*, 
              CASE WHEN c.participant1_id = $1 THEN u2.id ELSE u1.id END as other_user_id,
              CASE WHEN c.participant1_id = $1 THEN u2.name ELSE u1.name END as other_user_name,
              CASE WHEN c.participant1_id = $1 THEN u2.avatar ELSE u1.avatar END as other_user_avatar,
              (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
              (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
              (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id != $1 AND is_read = false) as unread_count
       FROM conversations c
       JOIN users u1 ON c.participant1_id = u1.id
       JOIN users u2 ON c.participant2_id = u2.id
       WHERE c.participant1_id = $1 OR c.participant2_id = $1
       ORDER BY c.last_message_at DESC`,
      [req.userId]
    );
    
    const conversations = result.rows.map((c: any) => ({
      id: c.id,
      user: {
        id: c.other_user_id,
        name: c.other_user_name,
        avatar: c.other_user_avatar,
      },
      last_message: c.last_message,
      time: c.last_message_time,
      unread: parseInt(c.unread_count) || 0,
      is_group: false,
    }));
    
    res.json({ conversations });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ detail: 'Failed to get conversations' });
  }
});

// Get conversation with messages
router.get('/conversations/:conversationId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { conversationId } = req.params;
    
    // Get conversation
    const convResult = await query(
      `SELECT c.*, 
              CASE WHEN c.participant1_id = $2 THEN u2.id ELSE u1.id END as other_user_id,
              CASE WHEN c.participant1_id = $2 THEN u2.name ELSE u1.name END as other_user_name,
              CASE WHEN c.participant1_id = $2 THEN u2.avatar ELSE u1.avatar END as other_user_avatar
       FROM conversations c
       JOIN users u1 ON c.participant1_id = u1.id
       JOIN users u2 ON c.participant2_id = u2.id
       WHERE c.id = $1 AND (c.participant1_id = $2 OR c.participant2_id = $2)`,
      [conversationId, req.userId]
    );
    
    if (convResult.rows.length === 0) {
      res.status(404).json({ detail: 'Conversation not found' });
      return;
    }
    
    const conv = convResult.rows[0];
    
    // Get messages
    const msgResult = await query(
      `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId]
    );
    
    // Mark messages as read
    await query(
      'UPDATE messages SET is_read = true WHERE conversation_id = $1 AND sender_id != $2',
      [conversationId, req.userId]
    );
    
    const conversation = {
      id: conv.id,
      user: {
        id: conv.other_user_id,
        name: conv.other_user_name,
        avatar: conv.other_user_avatar,
      },
      is_group: false,
    };
    
    const messages = msgResult.rows.map((m: any) => ({
      id: m.id,
      content: m.content,
      sender: m.sender_id,
      timestamp: m.created_at,
      is_own: m.sender_id === req.userId,
    }));
    
    res.json({ conversation, messages });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ detail: 'Failed to get conversation' });
  }
});

// Get or create conversation with user
router.post('/conversations', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { user_id } = req.body;
    
    if (!user_id) {
      res.status(400).json({ detail: 'User ID is required' });
      return;
    }
    
    // Check if conversation exists
    const existing = await query(
      `SELECT c.*, 
              CASE WHEN c.participant1_id = $1 THEN u2.id ELSE u1.id END as other_user_id,
              CASE WHEN c.participant1_id = $1 THEN u2.name ELSE u1.name END as other_user_name,
              CASE WHEN c.participant1_id = $1 THEN u2.avatar ELSE u1.avatar END as other_user_avatar
       FROM conversations c
       JOIN users u1 ON c.participant1_id = u1.id
       JOIN users u2 ON c.participant2_id = u2.id
       WHERE (c.participant1_id = $1 AND c.participant2_id = $2) OR (c.participant1_id = $2 AND c.participant2_id = $1)`,
      [req.userId, user_id]
    );
    
    if (existing.rows.length > 0) {
      const conv = existing.rows[0];
      
      // Get messages
      const msgResult = await query(
        'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
        [conv.id]
      );
      
      const conversation = {
        id: conv.id,
        user: {
          id: conv.other_user_id,
          name: conv.other_user_name,
          avatar: conv.other_user_avatar,
        },
        is_group: false,
      };
      
      const messages = msgResult.rows.map((m: any) => ({
        id: m.id,
        content: m.content,
        sender: m.sender_id,
        timestamp: m.created_at,
        is_own: m.sender_id === req.userId,
      }));
      
      res.json({ conversation, messages });
      return;
    }
    
    // Create new conversation
    const conversationId = uuidv4();
    
    await query(
      'INSERT INTO conversations (id, participant1_id, participant2_id) VALUES ($1, $2, $3)',
      [conversationId, req.userId, user_id]
    );
    
    // Get other user info
    const userResult = await query('SELECT id, name, avatar FROM users WHERE id = $1', [user_id]);
    
    if (userResult.rows.length === 0) {
      res.status(404).json({ detail: 'User not found' });
      return;
    }
    
    const otherUser = userResult.rows[0];
    
    res.json({
      conversation: {
        id: conversationId,
        user: {
          id: otherUser.id,
          name: otherUser.name,
          avatar: otherUser.avatar,
        },
        is_group: false,
      },
      messages: [],
    });
  } catch (error) {
    console.error('Get or create conversation error:', error);
    res.status(500).json({ detail: 'Failed to get conversation' });
  }
});

// Send message
router.post('/conversations/:conversationId/messages', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { conversationId } = req.params;
    const { content } = req.body;
    
    if (!content || content.trim().length === 0) {
      res.status(400).json({ detail: 'Message content is required' });
      return;
    }
    
    // Check if participant
    const conv = await query(
      'SELECT * FROM conversations WHERE id = $1 AND (participant1_id = $2 OR participant2_id = $2)',
      [conversationId, req.userId]
    );
    
    if (conv.rows.length === 0) {
      res.status(403).json({ detail: 'Not a participant of this conversation' });
      return;
    }
    
    const messageId = uuidv4();
    
    await transaction(async (client) => {
      // Insert message
      await client.query(
        'INSERT INTO messages (id, conversation_id, sender_id, content) VALUES ($1, $2, $3, $4)',
        [messageId, conversationId, req.userId, content]
      );
      
      // Update conversation last_message_at
      await client.query(
        'UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP WHERE id = $1',
        [conversationId]
      );
    });
    
    res.status(201).json({
      id: messageId,
      content,
      sender: req.userId,
      timestamp: new Date().toISOString(),
      is_own: true,
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ detail: 'Failed to send message' });
  }
});

// Mark conversation as read
router.put('/conversations/:conversationId/read', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { conversationId } = req.params;
    
    await query(
      'UPDATE messages SET is_read = true WHERE conversation_id = $1 AND sender_id != $2',
      [conversationId, req.userId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ detail: 'Failed to mark as read' });
  }
});

// Get unread count
router.get('/unread-count', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT COUNT(*) FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE (c.participant1_id = $1 OR c.participant2_id = $1)
         AND m.sender_id != $1
         AND m.is_read = false`,
      [req.userId]
    );
    
    res.json({ count: parseInt(result.rows[0].count) || 0 });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ detail: 'Failed to get unread count' });
  }
});

export default router;

