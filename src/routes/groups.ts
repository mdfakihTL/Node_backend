import { Router, Response } from 'express';
import { query, transaction } from '../database/connection';
import { authenticate, requireAdmin } from '../middleware/auth';
import { validate, schemas } from '../middleware/validation';
import { AuthenticatedRequest, Group, GroupMessage } from '../types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get all groups
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, page_size = 20, category, search, joined_only } = req.query;
    
    const conditions: string[] = ['g.is_active = true'];
    const values: any[] = [];
    let paramIndex = 1;
    
    // Filter by university
    if (req.user?.university_id) {
      conditions.push(`g.university_id = $${paramIndex++}`);
      values.push(req.user.university_id);
    }
    
    if (category) {
      conditions.push(`g.category = $${paramIndex++}`);
      values.push(category);
    }
    
    if (search) {
      conditions.push(`(g.name ILIKE $${paramIndex} OR g.description ILIKE $${paramIndex})`);
      values.push(`%${search}%`);
      paramIndex++;
    }
    
    if (joined_only === 'true') {
      conditions.push(`EXISTS(SELECT 1 FROM group_members WHERE group_id = g.id AND user_id = $${paramIndex++})`);
      values.push(req.userId);
    }
    
    const whereClause = conditions.join(' AND ');
    const offset = (Number(page) - 1) * Number(page_size);
    
    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM groups g WHERE ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);
    
    // Get groups with membership status
    values.push(req.userId);
    values.push(Number(page_size), offset);
    
    const result = await query(
      `SELECT g.*, 
              EXISTS(SELECT 1 FROM group_members WHERE group_id = g.id AND user_id = $${paramIndex}) as is_joined,
              (SELECT content FROM group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1) as last_message,
              (SELECT created_at FROM group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
              0 as unread_count
       FROM groups g
       WHERE ${whereClause}
       ORDER BY g.name ASC
       LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}`,
      values
    );
    
    const groups = result.rows.map((g: any) => ({
      id: g.id,
      name: g.name,
      members: g.members_count,
      description: g.description,
      is_private: g.is_private,
      category: g.category,
      avatar: g.avatar,
      is_joined: g.is_joined,
      last_message: g.last_message,
      last_message_time: g.last_message_time,
      unread_count: g.unread_count,
      created_at: g.created_at,
    }));
    
    res.json({
      groups,
      total,
      page: Number(page),
      page_size: Number(page_size),
    });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ detail: 'Failed to get groups' });
  }
});

// Get my groups
router.get('/my-groups', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT g.*, 
              true as is_joined,
              (SELECT content FROM group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1) as last_message,
              (SELECT created_at FROM group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
              0 as unread_count
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = $1 AND g.is_active = true
       ORDER BY g.name ASC`,
      [req.userId]
    );
    
    const groups = result.rows.map((g: any) => ({
      id: g.id,
      name: g.name,
      members: g.members_count,
      description: g.description,
      is_private: g.is_private,
      category: g.category,
      avatar: g.avatar,
      is_joined: true,
      last_message: g.last_message,
      last_message_time: g.last_message_time,
      unread_count: g.unread_count,
      created_at: g.created_at,
    }));
    
    res.json({
      groups,
      total: groups.length,
      page: 1,
      page_size: groups.length,
    });
  } catch (error) {
    console.error('Get my groups error:', error);
    res.status(500).json({ detail: 'Failed to get groups' });
  }
});

// Get single group
router.get('/:groupId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    
    const result = await query(
      `SELECT g.*, 
              EXISTS(SELECT 1 FROM group_members WHERE group_id = g.id AND user_id = $2) as is_joined
       FROM groups g
       WHERE g.id = $1 AND g.is_active = true`,
      [groupId, req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Group not found' });
      return;
    }
    
    const g = result.rows[0];
    
    res.json({
      id: g.id,
      name: g.name,
      members: g.members_count,
      description: g.description,
      is_private: g.is_private,
      category: g.category,
      avatar: g.avatar,
      is_joined: g.is_joined,
      created_at: g.created_at,
    });
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({ detail: 'Failed to get group' });
  }
});

// Create group (admin only)
router.post('/', authenticate, requireAdmin, validate(schemas.createGroup), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, description, category, is_private, avatar } = req.body;
    
    const groupId = uuidv4();
    const defaultAvatar = avatar || `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(name)}`;
    
    await query(
      `INSERT INTO groups (id, university_id, created_by, name, description, avatar, category, is_private)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [groupId, req.user?.university_id, req.userId, name, description, defaultAvatar, category, is_private || false]
    );
    
    const result = await query('SELECT * FROM groups WHERE id = $1', [groupId]);
    const g = result.rows[0];
    
    res.status(201).json({
      id: g.id,
      name: g.name,
      members: 0,
      description: g.description,
      is_private: g.is_private,
      category: g.category,
      avatar: g.avatar,
      is_joined: false,
      created_at: g.created_at,
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ detail: 'Failed to create group' });
  }
});

// Update group (admin only)
router.put('/:groupId', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const { name, description, category, is_private, avatar } = req.body;
    
    const result = await query(
      `UPDATE groups SET 
       name = COALESCE($1, name),
       description = COALESCE($2, description),
       category = COALESCE($3, category),
       is_private = COALESCE($4, is_private),
       avatar = COALESCE($5, avatar)
       WHERE id = $6 AND university_id = $7 RETURNING *`,
      [name, description, category, is_private, avatar, groupId, req.user?.university_id]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Group not found' });
      return;
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({ detail: 'Failed to update group' });
  }
});

// Delete group (admin only)
router.delete('/:groupId', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    
    const result = await query(
      'UPDATE groups SET is_active = false WHERE id = $1 AND university_id = $2 RETURNING id',
      [groupId, req.user?.university_id]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Group not found' });
      return;
    }
    
    res.json({ message: 'Group deleted', success: true });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({ detail: 'Failed to delete group' });
  }
});

// Join group
router.post('/:groupId/join', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    
    await transaction(async (client) => {
      // Check if already a member
      const existing = await client.query(
        'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, req.userId]
      );
      
      if (existing.rows.length > 0) {
        throw new Error('Already a member');
      }
      
      // Join group
      await client.query(
        'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)',
        [groupId, req.userId]
      );
      
      // Update count
      await client.query(
        'UPDATE groups SET members_count = members_count + 1 WHERE id = $1',
        [groupId]
      );
    });
    
    res.json({ message: 'Joined group', success: true });
  } catch (error: any) {
    console.error('Join group error:', error);
    res.status(400).json({ detail: error.message || 'Failed to join group' });
  }
});

// Leave group
router.delete('/:groupId/leave', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    
    await transaction(async (client) => {
      const result = await client.query(
        'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 RETURNING id',
        [groupId, req.userId]
      );
      
      if (result.rows.length > 0) {
        await client.query(
          'UPDATE groups SET members_count = GREATEST(0, members_count - 1) WHERE id = $1',
          [groupId]
        );
      }
    });
    
    res.json({ message: 'Left group', success: true });
  } catch (error) {
    console.error('Leave group error:', error);
    res.status(500).json({ detail: 'Failed to leave group' });
  }
});

// Get group messages
router.get('/:groupId/messages', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const { page = 1, page_size = 50 } = req.query;
    
    // Check membership
    const member = await query(
      'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.userId]
    );
    
    if (member.rows.length === 0) {
      res.status(403).json({ detail: 'Not a member of this group' });
      return;
    }
    
    const offset = (Number(page) - 1) * Number(page_size);
    
    // Get total count
    const countResult = await query(
      'SELECT COUNT(*) FROM group_messages WHERE group_id = $1',
      [groupId]
    );
    const total = parseInt(countResult.rows[0].count);
    
    // Get messages
    const result = await query(
      `SELECT gm.*, u.name as sender_name, u.avatar as sender_avatar
       FROM group_messages gm
       JOIN users u ON gm.sender_id = u.id
       WHERE gm.group_id = $1
       ORDER BY gm.created_at DESC
       LIMIT $2 OFFSET $3`,
      [groupId, Number(page_size), offset]
    );
    
    const messages = result.rows.reverse().map((m: any) => ({
      id: m.id,
      content: m.content,
      sender: {
        id: m.sender_id,
        name: m.sender_name,
        avatar: m.sender_avatar,
      },
      timestamp: m.created_at,
      is_own: m.sender_id === req.userId,
      created_at: m.created_at,
    }));
    
    res.json({ messages, total });
  } catch (error) {
    console.error('Get group messages error:', error);
    res.status(500).json({ detail: 'Failed to get messages' });
  }
});

// Send group message
router.post('/:groupId/messages', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const { content } = req.body;
    
    if (!content || content.trim().length === 0) {
      res.status(400).json({ detail: 'Message content is required' });
      return;
    }
    
    // Check membership
    const member = await query(
      'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.userId]
    );
    
    if (member.rows.length === 0) {
      res.status(403).json({ detail: 'Not a member of this group' });
      return;
    }
    
    const messageId = uuidv4();
    
    await query(
      'INSERT INTO group_messages (id, group_id, sender_id, content) VALUES ($1, $2, $3, $4)',
      [messageId, groupId, req.userId, content]
    );
    
    // Get created message
    const result = await query(
      `SELECT gm.*, u.name as sender_name, u.avatar as sender_avatar
       FROM group_messages gm
       JOIN users u ON gm.sender_id = u.id
       WHERE gm.id = $1`,
      [messageId]
    );
    
    const m = result.rows[0];
    
    res.status(201).json({
      id: m.id,
      content: m.content,
      sender: {
        id: m.sender_id,
        name: m.sender_name,
        avatar: m.sender_avatar,
      },
      timestamp: m.created_at,
      is_own: true,
      created_at: m.created_at,
    });
  } catch (error) {
    console.error('Send group message error:', error);
    res.status(500).json({ detail: 'Failed to send message' });
  }
});

export default router;

