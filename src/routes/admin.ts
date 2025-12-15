import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query, transaction } from '../database/connection';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthenticatedRequest, User } from '../types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get dashboard stats
router.get('/dashboard', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const universityId = req.user?.university_id;
    
    const stats = await query(
      `SELECT 
        (SELECT COUNT(*) FROM users WHERE university_id = $1 AND role = 'alumni' AND is_active = true) as total_alumni,
        (SELECT COUNT(*) FROM users WHERE university_id = $1 AND is_mentor = true AND is_active = true) as active_mentors,
        (SELECT COUNT(*) FROM document_requests WHERE university_id = $1 AND status = 'pending') as pending_documents,
        (SELECT COUNT(*) FROM events WHERE university_id = $1 AND event_date >= CURRENT_DATE AND is_active = true) as upcoming_events,
        (SELECT COUNT(*) FROM password_reset_requests pr JOIN users u ON pr.user_id = u.id WHERE u.university_id = $1 AND pr.status = 'pending') as password_resets,
        (SELECT COUNT(*) FROM groups WHERE university_id = $1 AND is_active = true) as active_groups,
        (SELECT COUNT(*) FROM fundraisers WHERE university_id = $1 AND is_active = true) as active_fundraisers,
        (SELECT COUNT(*) FROM support_tickets WHERE university_id = $1 AND status IN ('open', 'in-progress')) as open_tickets`,
      [universityId]
    );
    
    const s = stats.rows[0];
    
    res.json({
      total_alumni: parseInt(s.total_alumni) || 0,
      active_mentors: parseInt(s.active_mentors) || 0,
      pending_documents: parseInt(s.pending_documents) || 0,
      upcoming_events: parseInt(s.upcoming_events) || 0,
      password_resets: parseInt(s.password_resets) || 0,
      active_groups: parseInt(s.active_groups) || 0,
      active_fundraisers: parseInt(s.active_fundraisers) || 0,
      open_tickets: parseInt(s.open_tickets) || 0,
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ detail: 'Failed to get dashboard stats' });
  }
});

// Get users
router.get('/users', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { search, graduation_year, major, is_mentor, page = 1, page_size = 20 } = req.query;
    const universityId = req.user?.university_id;
    
    const conditions: string[] = ["role = 'alumni'", 'university_id = $1'];
    const values: any[] = [universityId];
    let paramIndex = 2;
    
    if (search) {
      conditions.push(`(name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
      values.push(`%${search}%`);
      paramIndex++;
    }
    
    if (graduation_year) {
      conditions.push(`graduation_year = $${paramIndex++}`);
      values.push(graduation_year);
    }
    
    if (major) {
      conditions.push(`major = $${paramIndex++}`);
      values.push(major);
    }
    
    if (is_mentor !== undefined) {
      conditions.push(`is_mentor = $${paramIndex++}`);
      values.push(is_mentor === 'true');
    }
    
    const whereClause = conditions.join(' AND ');
    const offset = (Number(page) - 1) * Number(page_size);
    
    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM users WHERE ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);
    
    // Get users
    values.push(Number(page_size), offset);
    
    const result = await query(
      `SELECT u.*, up.job_title, up.company
       FROM users u
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      values
    );
    
    const users = result.rows.map((u: any) => {
      const { password_hash, ...safeUser } = u;
      return safeUser;
    });
    
    res.json({
      users,
      total,
      page: Number(page),
      page_size: Number(page_size),
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ detail: 'Failed to get users' });
  }
});

// Create user
router.post('/users', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, password, name, graduation_year, major } = req.body;
    
    if (!email || !password || !name) {
      res.status(400).json({ detail: 'Email, password, and name are required' });
      return;
    }
    
    // Check if email exists
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      res.status(400).json({ detail: 'Email already exists' });
      return;
    }
    
    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(email)}`;
    
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO users (id, email, password_hash, name, avatar, university_id, graduation_year, major, role, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'alumni', true)`,
        [userId, email.toLowerCase(), passwordHash, name, avatar, req.user?.university_id, graduation_year, major]
      );
      
      await client.query('INSERT INTO user_profiles (user_id) VALUES ($1)', [userId]);
    });
    
    const result = await query('SELECT * FROM users WHERE id = $1', [userId]);
    const { password_hash, ...safeUser } = result.rows[0] as any;
    
    res.status(201).json(safeUser);
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ detail: 'Failed to create user' });
  }
});

// Bulk import users
router.post('/users/bulk-import', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const users = req.body;
    
    if (!Array.isArray(users) || users.length === 0) {
      res.status(400).json({ detail: 'Users array is required' });
      return;
    }
    
    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];
    
    for (const user of users) {
      try {
        const { email, password, name, graduation_year, major } = user;
        
        if (!email || !password || !name) {
          errors.push(`Missing required fields for user: ${email || 'unknown'}`);
          failedCount++;
          continue;
        }
        
        // Check if email exists
        const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
        if (existing.rows.length > 0) {
          errors.push(`Email already exists: ${email}`);
          failedCount++;
          continue;
        }
        
        const userId = uuidv4();
        const passwordHash = await bcrypt.hash(password, 10);
        const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(email)}`;
        
        await transaction(async (client) => {
          await client.query(
            `INSERT INTO users (id, email, password_hash, name, avatar, university_id, graduation_year, major, role, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'alumni', true)`,
            [userId, email.toLowerCase(), passwordHash, name, avatar, req.user?.university_id, graduation_year, major]
          );
          
          await client.query('INSERT INTO user_profiles (user_id) VALUES ($1)', [userId]);
        });
        
        successCount++;
      } catch (err: any) {
        errors.push(`Failed to import: ${user.email}: ${err.message}`);
        failedCount++;
      }
    }
    
    res.json({
      success_count: successCount,
      failed_count: failedCount,
      errors,
    });
  } catch (error) {
    console.error('Bulk import error:', error);
    res.status(500).json({ detail: 'Failed to import users' });
  }
});

// Deactivate user
router.delete('/users/:userId', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req.params;
    
    const result = await query(
      "UPDATE users SET is_active = false WHERE id = $1 AND university_id = $2 AND role = 'alumni' RETURNING id",
      [userId, req.user?.university_id]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'User not found' });
      return;
    }
    
    res.json({ message: 'User deactivated', success: true });
  } catch (error) {
    console.error('Deactivate user error:', error);
    res.status(500).json({ detail: 'Failed to deactivate user' });
  }
});

// Get password resets
router.get('/password-resets', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, page_size = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(page_size);
    
    const countResult = await query(
      `SELECT COUNT(*) FROM password_reset_requests pr
       JOIN users u ON pr.user_id = u.id
       WHERE u.university_id = $1 AND pr.status = 'pending'`,
      [req.user?.university_id]
    );
    const total = parseInt(countResult.rows[0].count);
    
    const result = await query(
      `SELECT pr.id, pr.created_at as requested_at, u.id as user_id, u.name as user_name, u.email as user_email
       FROM password_reset_requests pr
       JOIN users u ON pr.user_id = u.id
       WHERE u.university_id = $1 AND pr.status = 'pending'
       ORDER BY pr.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user?.university_id, Number(page_size), offset]
    );
    
    res.json({
      requests: result.rows,
      total,
      page: Number(page),
      page_size: Number(page_size),
    });
  } catch (error) {
    console.error('Get password resets error:', error);
    res.status(500).json({ detail: 'Failed to get password resets' });
  }
});

// Reset user password
router.post('/password-resets/:userId/reset', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { new_password } = req.body;
    
    if (!new_password || new_password.length < 6) {
      res.status(400).json({ detail: 'Password must be at least 6 characters' });
      return;
    }
    
    const passwordHash = await bcrypt.hash(new_password, 10);
    
    await transaction(async (client) => {
      // Update password
      const result = await client.query(
        "UPDATE users SET password_hash = $1 WHERE id = $2 AND university_id = $3 AND role = 'alumni' RETURNING id",
        [passwordHash, userId, req.user?.university_id]
      );
      
      if (result.rows.length === 0) {
        throw new Error('User not found');
      }
      
      // Mark requests as completed
      await client.query(
        "UPDATE password_reset_requests SET status = 'completed' WHERE user_id = $1",
        [userId]
      );
    });
    
    res.json({ message: 'Password reset successful', success: true });
  } catch (error: any) {
    console.error('Reset password error:', error);
    res.status(400).json({ detail: error.message || 'Failed to reset password' });
  }
});

// Get document requests
router.get('/documents', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, page = 1, page_size = 20 } = req.query;
    
    const conditions: string[] = ['dr.university_id = $1'];
    const values: any[] = [req.user?.university_id];
    let paramIndex = 2;
    
    if (status) {
      conditions.push(`dr.status = $${paramIndex++}`);
      values.push(status);
    }
    
    const whereClause = conditions.join(' AND ');
    const offset = (Number(page) - 1) * Number(page_size);
    
    const countResult = await query(
      `SELECT COUNT(*) FROM document_requests dr WHERE ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);
    
    values.push(Number(page_size), offset);
    
    const result = await query(
      `SELECT dr.*, u.name as user_name, u.email as user_email
       FROM document_requests dr
       JOIN users u ON dr.user_id = u.id
       WHERE ${whereClause}
       ORDER BY dr.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      values
    );
    
    res.json({
      requests: result.rows,
      total,
      page: Number(page),
      page_size: Number(page_size),
    });
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ detail: 'Failed to get document requests' });
  }
});

// Update document status
router.put('/documents/:requestId/status', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const { status } = req.body;
    
    const validStatuses = ['pending', 'processing', 'completed', 'rejected'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ detail: 'Invalid status' });
      return;
    }
    
    const result = await query(
      'UPDATE document_requests SET status = $1 WHERE id = $2 AND university_id = $3 RETURNING id',
      [status, requestId, req.user?.university_id]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Request not found' });
      return;
    }
    
    res.json({ message: 'Status updated', success: true });
  } catch (error) {
    console.error('Update document status error:', error);
    res.status(500).json({ detail: 'Failed to update status' });
  }
});

// Get support tickets
router.get('/tickets', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, priority, page = 1, page_size = 20 } = req.query;
    
    const conditions: string[] = ['t.university_id = $1'];
    const values: any[] = [req.user?.university_id];
    let paramIndex = 2;
    
    if (status) {
      conditions.push(`t.status = $${paramIndex++}`);
      values.push(status);
    }
    
    if (priority) {
      conditions.push(`t.priority = $${paramIndex++}`);
      values.push(priority);
    }
    
    const whereClause = conditions.join(' AND ');
    const offset = (Number(page) - 1) * Number(page_size);
    
    const countResult = await query(
      `SELECT COUNT(*) FROM support_tickets t WHERE ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);
    
    values.push(Number(page_size), offset);
    
    const result = await query(
      `SELECT t.*, u.name as user_name, u.email as user_email
       FROM support_tickets t
       JOIN users u ON t.user_id = u.id
       WHERE ${whereClause}
       ORDER BY 
         CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         t.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      values
    );
    
    res.json({
      tickets: result.rows,
      total,
      page: Number(page),
      page_size: Number(page_size),
    });
  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({ detail: 'Failed to get tickets' });
  }
});

// Update ticket status
router.put('/tickets/:ticketId/status', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { ticketId } = req.params;
    const { status, admin_notes } = req.body;
    
    const validStatuses = ['open', 'in-progress', 'resolved', 'closed'];
    if (status && !validStatuses.includes(status)) {
      res.status(400).json({ detail: 'Invalid status' });
      return;
    }
    
    const result = await query(
      `UPDATE support_tickets SET 
       status = COALESCE($1, status),
       admin_notes = COALESCE($2, admin_notes)
       WHERE id = $3 AND university_id = $4 RETURNING id`,
      [status, admin_notes, ticketId, req.user?.university_id]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Ticket not found' });
      return;
    }
    
    res.json({ message: 'Ticket updated', success: true });
  } catch (error) {
    console.error('Update ticket status error:', error);
    res.status(500).json({ detail: 'Failed to update ticket' });
  }
});

// Respond to ticket
router.post('/tickets/:ticketId/respond', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { ticketId } = req.params;
    const { message } = req.query;
    
    if (!message) {
      res.status(400).json({ detail: 'Message is required' });
      return;
    }
    
    // Check ticket exists
    const ticket = await query(
      'SELECT id FROM support_tickets WHERE id = $1 AND university_id = $2',
      [ticketId, req.user?.university_id]
    );
    
    if (ticket.rows.length === 0) {
      res.status(404).json({ detail: 'Ticket not found' });
      return;
    }
    
    const responseId = uuidv4();
    
    await query(
      'INSERT INTO ticket_responses (id, ticket_id, user_id, message, is_admin) VALUES ($1, $2, $3, $4, true)',
      [responseId, ticketId, req.userId, message]
    );
    
    // Update ticket status to in-progress if open
    await query(
      "UPDATE support_tickets SET status = CASE WHEN status = 'open' THEN 'in-progress' ELSE status END WHERE id = $1",
      [ticketId]
    );
    
    res.json({ message: 'Response added', success: true });
  } catch (error) {
    console.error('Respond to ticket error:', error);
    res.status(500).json({ detail: 'Failed to respond' });
  }
});

// Get fundraisers
router.get('/fundraisers', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM fundraisers WHERE university_id = $1 ORDER BY created_at DESC',
      [req.user?.university_id]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get fundraisers error:', error);
    res.status(500).json({ detail: 'Failed to get fundraisers' });
  }
});

// Create fundraiser
router.post('/fundraisers', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, description, image, goal_amount, donation_link, start_date, end_date } = req.body;
    
    if (!title || !goal_amount || !start_date || !end_date) {
      res.status(400).json({ detail: 'Title, goal amount, start date, and end date are required' });
      return;
    }
    
    const fundraiserId = uuidv4();
    
    await query(
      `INSERT INTO fundraisers (id, university_id, title, description, image, goal_amount, donation_link, start_date, end_date, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
      [fundraiserId, req.user?.university_id, title, description, image, goal_amount, donation_link, start_date, end_date]
    );
    
    const result = await query('SELECT * FROM fundraisers WHERE id = $1', [fundraiserId]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create fundraiser error:', error);
    res.status(500).json({ detail: 'Failed to create fundraiser' });
  }
});

// Update fundraiser
router.put('/fundraisers/:fundraiserId', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { fundraiserId } = req.params;
    const { title, description, image, goal_amount, donation_link, is_active } = req.body;
    
    const result = await query(
      `UPDATE fundraisers SET 
       title = COALESCE($1, title),
       description = COALESCE($2, description),
       image = COALESCE($3, image),
       goal_amount = COALESCE($4, goal_amount),
       donation_link = COALESCE($5, donation_link),
       is_active = COALESCE($6, is_active)
       WHERE id = $7 AND university_id = $8 RETURNING *`,
      [title, description, image, goal_amount, donation_link, is_active, fundraiserId, req.user?.university_id]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Fundraiser not found' });
      return;
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update fundraiser error:', error);
    res.status(500).json({ detail: 'Failed to update fundraiser' });
  }
});

// Delete fundraiser
router.delete('/fundraisers/:fundraiserId', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { fundraiserId } = req.params;
    
    const result = await query(
      'DELETE FROM fundraisers WHERE id = $1 AND university_id = $2 RETURNING id',
      [fundraiserId, req.user?.university_id]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Fundraiser not found' });
      return;
    }
    
    res.json({ message: 'Fundraiser deleted', success: true });
  } catch (error) {
    console.error('Delete fundraiser error:', error);
    res.status(500).json({ detail: 'Failed to delete fundraiser' });
  }
});

// Get ads
router.get('/ads', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM ads WHERE university_id = $1 AND is_global = false ORDER BY created_at DESC',
      [req.user?.university_id]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get ads error:', error);
    res.status(500).json({ detail: 'Failed to get ads' });
  }
});

// Create ad
router.post('/ads', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, description, image, link, placement } = req.body;
    
    if (!title) {
      res.status(400).json({ detail: 'Title is required' });
      return;
    }
    
    const adId = uuidv4();
    
    await query(
      `INSERT INTO ads (id, university_id, title, description, image, link, placement, is_active, is_global)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, false)`,
      [adId, req.user?.university_id, title, description, image, link, placement || 'sidebar']
    );
    
    const result = await query('SELECT * FROM ads WHERE id = $1', [adId]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create ad error:', error);
    res.status(500).json({ detail: 'Failed to create ad' });
  }
});

// Update ad
router.put('/ads/:adId', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { adId } = req.params;
    const { title, description, image, link, placement, is_active } = req.body;
    
    const result = await query(
      `UPDATE ads SET 
       title = COALESCE($1, title),
       description = COALESCE($2, description),
       image = COALESCE($3, image),
       link = COALESCE($4, link),
       placement = COALESCE($5, placement),
       is_active = COALESCE($6, is_active)
       WHERE id = $7 AND university_id = $8 RETURNING *`,
      [title, description, image, link, placement, is_active, adId, req.user?.university_id]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Ad not found' });
      return;
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update ad error:', error);
    res.status(500).json({ detail: 'Failed to update ad' });
  }
});

// Delete ad
router.delete('/ads/:adId', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { adId } = req.params;
    
    const result = await query(
      'DELETE FROM ads WHERE id = $1 AND university_id = $2 RETURNING id',
      [adId, req.user?.university_id]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Ad not found' });
      return;
    }
    
    res.json({ message: 'Ad deleted', success: true });
  } catch (error) {
    console.error('Delete ad error:', error);
    res.status(500).json({ detail: 'Failed to delete ad' });
  }
});

// Update university branding
router.put('/branding', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, logo, colors } = req.body;
    
    const result = await query(
      `UPDATE universities SET 
       name = COALESCE($1, name),
       logo = COALESCE($2, logo),
       colors = COALESCE($3, colors)
       WHERE id = $4 RETURNING *`,
      [name, logo, colors ? JSON.stringify(colors) : null, req.user?.university_id]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'University not found' });
      return;
    }
    
    res.json({ message: 'Branding updated', success: true });
  } catch (error) {
    console.error('Update branding error:', error);
    res.status(500).json({ detail: 'Failed to update branding' });
  }
});

// Create admin user
router.post('/admins', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password || !name) {
      res.status(400).json({ detail: 'Email, password, and name are required' });
      return;
    }
    
    // Check if email exists
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      res.status(400).json({ detail: 'Email already exists' });
      return;
    }
    
    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(email)}`;
    
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO users (id, email, password_hash, name, avatar, university_id, role, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, 'admin', true)`,
        [userId, email.toLowerCase(), passwordHash, name, avatar, req.user?.university_id]
      );
      
      await client.query('INSERT INTO user_profiles (user_id) VALUES ($1)', [userId]);
    });
    
    const result = await query('SELECT * FROM users WHERE id = $1', [userId]);
    const { password_hash, ...safeUser } = result.rows[0] as any;
    
    res.status(201).json(safeUser);
  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({ detail: 'Failed to create admin' });
  }
});

// Get posts (with filters for mentor, date range, user, type)
router.get('/posts', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { 
      page = 1, 
      page_size = 20, 
      type, 
      tag, 
      search,
      is_mentor,
      user_id,
      date_from,
      date_to
    } = req.query;
    
    const conditions: string[] = ['p.university_id = $1'];
    const values: any[] = [req.user?.university_id];
    let paramIndex = 2;
    
    if (type) {
      conditions.push(`p.type = $${paramIndex++}`);
      values.push(type);
    }
    
    if (tag) {
      conditions.push(`p.tag = $${paramIndex++}`);
      values.push(tag);
    }
    
    if (search) {
      conditions.push(`(p.content ILIKE $${paramIndex} OR u.name ILIKE $${paramIndex})`);
      values.push(`%${search}%`);
      paramIndex++;
    }
    
    if (is_mentor === 'true') {
      conditions.push('u.is_mentor = true');
    }
    
    if (user_id) {
      conditions.push(`p.author_id = $${paramIndex++}`);
      values.push(user_id);
    }
    
    if (date_from) {
      conditions.push(`p.created_at >= $${paramIndex++}`);
      values.push(date_from);
    }
    
    if (date_to) {
      conditions.push(`p.created_at <= $${paramIndex++}`);
      values.push(date_to);
    }
    
    const whereClause = conditions.join(' AND ');
    const offset = (Number(page) - 1) * Number(page_size);
    
    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM posts p 
       JOIN users u ON p.author_id = u.id
       WHERE ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);
    
    // Get posts
    values.push(Number(page_size), offset);
    
    const result = await query(
      `SELECT p.*, 
              u.name as author_name, u.avatar as author_avatar, u.is_mentor,
              up.job_title as author_title, up.company as author_company
       FROM posts p
       JOIN users u ON p.author_id = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      values
    );
    
    const posts = result.rows.map((p: any) => ({
      id: p.id,
      author: {
        id: p.author_id,
        name: p.author_name,
        avatar: p.author_avatar,
        title: p.author_title,
        company: p.author_company,
        is_mentor: p.is_mentor,
      },
      type: p.type,
      content: p.content,
      media_url: p.media_url,
      video_url: p.video_url,
      thumbnail_url: p.thumbnail_url,
      tag: p.tag,
      likes_count: p.likes_count,
      comments_count: p.comments_count,
      is_active: p.is_active,
      created_at: p.created_at,
    }));
    
    res.json({
      posts,
      total,
      page: Number(page),
      page_size: Number(page_size),
    });
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({ detail: 'Failed to get posts' });
  }
});

// Delete any post in university
router.delete('/posts/:postId', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId } = req.params;
    
    const result = await query(
      'UPDATE posts SET is_active = false WHERE id = $1 AND university_id = $2 RETURNING id',
      [postId, req.user?.university_id]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Post not found' });
      return;
    }
    
    res.json({ message: 'Post deleted', success: true });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ detail: 'Failed to delete post' });
  }
});

export default router;

