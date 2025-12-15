import { Router, Response } from 'express';
import { query } from '../database/connection';
import { authenticate } from '../middleware/auth';
import { AuthenticatedRequest, Notification } from '../types';

const router = Router();

// Helper to format time
const formatTime = (date: Date): string => {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
};

// Get all notifications
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, page_size = 20, unread_only } = req.query;
    
    const conditions: string[] = ['user_id = $1'];
    const values: any[] = [req.userId];
    let paramIndex = 2;
    
    if (unread_only === 'true') {
      conditions.push('is_read = false');
    }
    
    const whereClause = conditions.join(' AND ');
    const offset = (Number(page) - 1) * Number(page_size);
    
    // Get total and unread counts
    const countResult = await query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_read = false) as unread_count
       FROM notifications WHERE user_id = $1`,
      [req.userId]
    );
    const total = parseInt(countResult.rows[0].total);
    const unreadCount = parseInt(countResult.rows[0].unread_count);
    
    // Get notifications
    values.push(Number(page_size), offset);
    
    const result = await query(
      `SELECT * FROM notifications
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      values
    );
    
    const notifications = result.rows.map((n: any) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      avatar: n.avatar,
      read: n.is_read,
      time: formatTime(new Date(n.created_at)),
      created_at: n.created_at,
      action_url: n.action_url,
      related_id: n.related_id,
    }));
    
    res.json({
      notifications,
      total,
      unread_count: unreadCount,
      page: Number(page),
      page_size: Number(page_size),
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ detail: 'Failed to get notifications' });
  }
});

// Mark notification as read
router.put('/:notificationId/read', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { notificationId } = req.params;
    
    const result = await query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING id',
      [notificationId, req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Notification not found' });
      return;
    }
    
    res.json({ message: 'Notification marked as read', success: true });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ detail: 'Failed to mark as read' });
  }
});

// Mark all as read
router.put('/read-all', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1',
      [req.userId]
    );
    
    res.json({ message: 'All notifications marked as read', success: true });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({ detail: 'Failed to mark all as read' });
  }
});

// Delete notification
router.delete('/:notificationId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { notificationId } = req.params;
    
    const result = await query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id',
      [notificationId, req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Notification not found' });
      return;
    }
    
    res.json({ message: 'Notification deleted', success: true });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ detail: 'Failed to delete notification' });
  }
});

// Clear all notifications
router.delete('/clear-all', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await query('DELETE FROM notifications WHERE user_id = $1', [req.userId]);
    
    res.json({ message: 'All notifications cleared', success: true });
  } catch (error) {
    console.error('Clear all error:', error);
    res.status(500).json({ detail: 'Failed to clear notifications' });
  }
});

// Get unread count
router.get('/unread-count', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
      [req.userId]
    );
    
    res.json({ count: parseInt(result.rows[0].count) || 0 });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ detail: 'Failed to get unread count' });
  }
});

export default router;

