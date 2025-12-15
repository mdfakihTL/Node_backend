import { Router, Response } from 'express';
import { query, transaction } from '../database/connection';
import { authenticate } from '../middleware/auth';
import { AuthenticatedRequest, Connection, ConnectionRequest } from '../types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get all connections
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, page_size = 20, search } = req.query;
    
    const conditions: string[] = [];
    const values: any[] = [req.userId];
    let paramIndex = 2;
    
    if (search) {
      conditions.push(`u.name ILIKE $${paramIndex++}`);
      values.push(`%${search}%`);
    }
    
    const searchCondition = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
    const offset = (Number(page) - 1) * Number(page_size);
    
    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM (
        SELECT u.id FROM connections c
        JOIN users u ON (c.connected_user_id = u.id AND c.user_id = $1) OR (c.user_id = u.id AND c.connected_user_id = $1)
        WHERE u.is_active = true ${searchCondition}
       ) as conn`,
      values
    );
    const total = parseInt(countResult.rows[0].count);
    
    // Get connections
    values.push(Number(page_size), offset);
    
    const result = await query(
      `SELECT DISTINCT ON (u.id) c.id as connection_id, c.connected_at, u.*, 
              un.name as university_name,
              up.job_title, up.company
       FROM connections c
       JOIN users u ON (c.connected_user_id = u.id AND c.user_id = $1) OR (c.user_id = u.id AND c.connected_user_id = $1)
       LEFT JOIN universities un ON u.university_id = un.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE u.is_active = true AND u.id != $1 ${searchCondition}
       ORDER BY u.id, c.connected_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      values
    );
    
    const connections = result.rows.map((c: any) => ({
      id: c.connection_id,
      user: {
        id: c.id,
        name: c.name,
        avatar: c.avatar,
        university: c.university_name,
        year: c.graduation_year?.toString(),
        major: c.major,
        job_title: c.job_title,
        company: c.company,
      },
      connected_date: c.connected_at,
    }));
    
    res.json({ connections, total });
  } catch (error) {
    console.error('Get connections error:', error);
    res.status(500).json({ detail: 'Failed to get connections' });
  }
});

// Get connection suggestions
router.get('/suggestions', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit = 10 } = req.query;
    
    // Get users from same university who are not connected
    const result = await query(
      `SELECT u.*, un.name as university_name, up.job_title, up.company
       FROM users u
       LEFT JOIN universities un ON u.university_id = un.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE u.id != $1 
         AND u.is_active = true 
         AND u.role = 'alumni'
         AND u.university_id = (SELECT university_id FROM users WHERE id = $1)
         AND u.id NOT IN (
           SELECT connected_user_id FROM connections WHERE user_id = $1
           UNION
           SELECT user_id FROM connections WHERE connected_user_id = $1
         )
         AND u.id NOT IN (
           SELECT to_user_id FROM connection_requests WHERE from_user_id = $1 AND status = 'pending'
         )
       ORDER BY RANDOM()
       LIMIT $2`,
      [req.userId, Number(limit)]
    );
    
    const connections = result.rows.map((u: any) => ({
      id: uuidv4(),
      user: {
        id: u.id,
        name: u.name,
        avatar: u.avatar,
        university: u.university_name,
        year: u.graduation_year?.toString(),
        major: u.major,
        job_title: u.job_title,
        company: u.company,
      },
      connected_date: null,
    }));
    
    res.json({ connections, total: connections.length });
  } catch (error) {
    console.error('Get suggestions error:', error);
    res.status(500).json({ detail: 'Failed to get suggestions' });
  }
});

// Send connection request
router.post('/request', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { to_user_id } = req.body;
    
    if (!to_user_id) {
      res.status(400).json({ detail: 'Target user ID is required' });
      return;
    }
    
    if (to_user_id === req.userId) {
      res.status(400).json({ detail: 'Cannot connect to yourself' });
      return;
    }
    
    // Check if already connected
    const existingConnection = await query(
      `SELECT id FROM connections 
       WHERE (user_id = $1 AND connected_user_id = $2) OR (user_id = $2 AND connected_user_id = $1)`,
      [req.userId, to_user_id]
    );
    
    if (existingConnection.rows.length > 0) {
      res.status(400).json({ detail: 'Already connected' });
      return;
    }
    
    // Check if request already exists
    const existingRequest = await query(
      `SELECT id, status FROM connection_requests 
       WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1)`,
      [req.userId, to_user_id]
    );
    
    if (existingRequest.rows.length > 0) {
      res.status(400).json({ detail: 'Request already exists' });
      return;
    }
    
    // Create request
    const requestId = uuidv4();
    await query(
      'INSERT INTO connection_requests (id, from_user_id, to_user_id, status) VALUES ($1, $2, $3, $4)',
      [requestId, req.userId, to_user_id, 'pending']
    );
    
    // Create notification for the target user
    await query(
      `INSERT INTO notifications (user_id, type, title, message, avatar, action_url, related_id)
       SELECT $1, 'connection_request', 'New Connection Request', 
              $2 || ' wants to connect with you', 
              avatar, '/connections', $3
       FROM users WHERE id = $4`,
      [to_user_id, req.user?.name, requestId, req.userId]
    );
    
    res.json({ message: 'Connection request sent', success: true });
  } catch (error) {
    console.error('Send request error:', error);
    res.status(500).json({ detail: 'Failed to send request' });
  }
});

// Get received requests
router.get('/requests/received', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT cr.*, u.name, u.avatar, un.name as university_name, u.graduation_year
       FROM connection_requests cr
       JOIN users u ON cr.from_user_id = u.id
       LEFT JOIN universities un ON u.university_id = un.id
       WHERE cr.to_user_id = $1 AND cr.status = 'pending'
       ORDER BY cr.created_at DESC`,
      [req.userId]
    );
    
    const requests = result.rows.map((r: any) => ({
      id: r.id,
      from_user: {
        id: r.from_user_id,
        name: r.name,
        avatar: r.avatar,
        university: r.university_name,
        year: r.graduation_year?.toString(),
      },
      to_user_id: r.to_user_id,
      status: r.status,
      date: r.created_at,
    }));
    
    res.json({ requests });
  } catch (error) {
    console.error('Get received requests error:', error);
    res.status(500).json({ detail: 'Failed to get requests' });
  }
});

// Get sent requests
router.get('/requests/sent', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT cr.*, u.name, u.avatar, un.name as university_name, u.graduation_year
       FROM connection_requests cr
       JOIN users u ON cr.to_user_id = u.id
       LEFT JOIN universities un ON u.university_id = un.id
       WHERE cr.from_user_id = $1 AND cr.status = 'pending'
       ORDER BY cr.created_at DESC`,
      [req.userId]
    );
    
    const requests = result.rows.map((r: any) => ({
      id: r.id,
      from_user: {
        id: req.userId,
        name: req.user?.name,
        avatar: req.user?.avatar,
      },
      to_user_id: r.to_user_id,
      status: r.status,
      date: r.created_at,
    }));
    
    res.json({ requests });
  } catch (error) {
    console.error('Get sent requests error:', error);
    res.status(500).json({ detail: 'Failed to get requests' });
  }
});

// Accept request
router.put('/requests/:requestId/accept', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    
    await transaction(async (client) => {
      // Get the request
      const request = await client.query(
        'SELECT * FROM connection_requests WHERE id = $1 AND to_user_id = $2 AND status = $3',
        [requestId, req.userId, 'pending']
      );
      
      if (request.rows.length === 0) {
        throw new Error('Request not found or already processed');
      }
      
      const req_ = request.rows[0];
      
      // Update request status
      await client.query(
        'UPDATE connection_requests SET status = $1 WHERE id = $2',
        ['accepted', requestId]
      );
      
      // Create connection (both directions)
      const connId = uuidv4();
      await client.query(
        'INSERT INTO connections (id, user_id, connected_user_id) VALUES ($1, $2, $3)',
        [connId, req_.from_user_id, req_.to_user_id]
      );
      
      // Notify the requester
      await client.query(
        `INSERT INTO notifications (user_id, type, title, message, avatar, action_url)
         SELECT $1, 'connection_accepted', 'Connection Accepted', 
                name || ' accepted your connection request', 
                avatar, '/connections'
         FROM users WHERE id = $2`,
        [req_.from_user_id, req.userId]
      );
    });
    
    res.json({ message: 'Request accepted', success: true });
  } catch (error: any) {
    console.error('Accept request error:', error);
    res.status(400).json({ detail: error.message || 'Failed to accept request' });
  }
});

// Reject request
router.put('/requests/:requestId/reject', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    
    const result = await query(
      'UPDATE connection_requests SET status = $1 WHERE id = $2 AND to_user_id = $3 AND status = $4 RETURNING id',
      ['rejected', requestId, req.userId, 'pending']
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Request not found or already processed' });
      return;
    }
    
    res.json({ message: 'Request rejected', success: true });
  } catch (error) {
    console.error('Reject request error:', error);
    res.status(500).json({ detail: 'Failed to reject request' });
  }
});

// Remove connection
router.delete('/:connectionId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { connectionId } = req.params;
    
    // connectionId here is the connected user's ID
    await query(
      `DELETE FROM connections 
       WHERE (user_id = $1 AND connected_user_id = $2) OR (user_id = $2 AND connected_user_id = $1)`,
      [req.userId, connectionId]
    );
    
    res.json({ message: 'Connection removed', success: true });
  } catch (error) {
    console.error('Remove connection error:', error);
    res.status(500).json({ detail: 'Failed to remove connection' });
  }
});

// Check connection status
router.get('/check/:userId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req.params;
    
    // Check if connected
    const connection = await query(
      `SELECT id FROM connections 
       WHERE (user_id = $1 AND connected_user_id = $2) OR (user_id = $2 AND connected_user_id = $1)`,
      [req.userId, userId]
    );
    
    if (connection.rows.length > 0) {
      res.json({ is_connected: true });
      return;
    }
    
    // Check if request pending
    const request = await query(
      `SELECT id, status FROM connection_requests 
       WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1)`,
      [req.userId, userId]
    );
    
    if (request.rows.length > 0) {
      res.json({ is_connected: false, request_status: request.rows[0].status });
      return;
    }
    
    res.json({ is_connected: false });
  } catch (error) {
    console.error('Check connection error:', error);
    res.status(500).json({ detail: 'Failed to check connection' });
  }
});

export default router;

