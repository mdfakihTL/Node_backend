import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query, transaction } from '../database/connection';
import { authenticate, requireSuperAdmin } from '../middleware/auth';
import { AuthenticatedRequest, University, User } from '../types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get dashboard stats
router.get('/dashboard', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = await query(
      `SELECT 
        (SELECT COUNT(*) FROM universities) as total_universities,
        (SELECT COUNT(*) FROM universities WHERE is_enabled = true) as enabled_universities,
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM users WHERE role = 'admin') as total_admins,
        (SELECT COUNT(*) FROM users WHERE role = 'alumni') as total_alumni,
        (SELECT COUNT(*) FROM events WHERE is_active = true) as total_events,
        (SELECT COUNT(*) FROM groups WHERE is_active = true) as total_groups,
        (SELECT COUNT(*) FROM password_reset_requests pr JOIN users u ON pr.user_id = u.id WHERE u.role = 'admin' AND pr.status = 'pending') as pending_admin_resets`
    );
    
    const s = stats.rows[0];
    
    res.json({
      total_universities: parseInt(s.total_universities) || 0,
      enabled_universities: parseInt(s.enabled_universities) || 0,
      total_users: parseInt(s.total_users) || 0,
      total_admins: parseInt(s.total_admins) || 0,
      total_alumni: parseInt(s.total_alumni) || 0,
      total_events: parseInt(s.total_events) || 0,
      total_groups: parseInt(s.total_groups) || 0,
      pending_admin_resets: parseInt(s.pending_admin_resets) || 0,
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ detail: 'Failed to get dashboard stats' });
  }
});

// Get universities
router.get('/universities', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { search, is_enabled, page = 1, page_size = 20 } = req.query;
    
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    if (search) {
      conditions.push(`name ILIKE $${paramIndex++}`);
      values.push(`%${search}%`);
    }
    
    if (is_enabled !== undefined) {
      conditions.push(`is_enabled = $${paramIndex++}`);
      values.push(is_enabled === 'true');
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (Number(page) - 1) * Number(page_size);
    
    const countResult = await query(
      `SELECT COUNT(*) FROM universities ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);
    
    values.push(Number(page_size), offset);
    
    const result = await query(
      `SELECT * FROM universities ${whereClause}
       ORDER BY name ASC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      values
    );
    
    res.json({
      universities: result.rows,
      total,
    });
  } catch (error) {
    console.error('Get universities error:', error);
    res.status(500).json({ detail: 'Failed to get universities' });
  }
});

// Create university
router.post('/universities', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, name, logo, colors } = req.body;
    
    if (!id || !name) {
      res.status(400).json({ detail: 'ID and name are required' });
      return;
    }
    
    // Check if ID exists
    const existing = await query('SELECT id FROM universities WHERE id = $1', [id]);
    if (existing.rows.length > 0) {
      res.status(400).json({ detail: 'University ID already exists' });
      return;
    }
    
    const defaultColors = {
      light: { primary: '#3B82F6', secondary: '#6B7280', accent: '#2563EB' },
      dark: { primary: '#60A5FA', secondary: '#9CA3AF', accent: '#3B82F6' },
    };
    
    await query(
      'INSERT INTO universities (id, name, logo, colors, is_enabled) VALUES ($1, $2, $3, $4, true)',
      [id, name, logo, JSON.stringify(colors || defaultColors)]
    );
    
    const result = await query('SELECT * FROM universities WHERE id = $1', [id]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create university error:', error);
    res.status(500).json({ detail: 'Failed to create university' });
  }
});

// Update university
router.put('/universities/:universityId', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { universityId } = req.params;
    const { name, logo, colors, is_enabled } = req.body;
    
    const result = await query(
      `UPDATE universities SET 
       name = COALESCE($1, name),
       logo = COALESCE($2, logo),
       colors = COALESCE($3, colors),
       is_enabled = COALESCE($4, is_enabled)
       WHERE id = $5 RETURNING *`,
      [name, logo, colors ? JSON.stringify(colors) : null, is_enabled, universityId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'University not found' });
      return;
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update university error:', error);
    res.status(500).json({ detail: 'Failed to update university' });
  }
});

// Delete university
router.delete('/universities/:universityId', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { universityId } = req.params;
    
    // Check if university has users
    const users = await query('SELECT COUNT(*) FROM users WHERE university_id = $1', [universityId]);
    if (parseInt(users.rows[0].count) > 0) {
      res.status(400).json({ detail: 'Cannot delete university with existing users' });
      return;
    }
    
    const result = await query('DELETE FROM universities WHERE id = $1 RETURNING id', [universityId]);
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'University not found' });
      return;
    }
    
    res.json({ message: 'University deleted', success: true });
  } catch (error) {
    console.error('Delete university error:', error);
    res.status(500).json({ detail: 'Failed to delete university' });
  }
});

// Toggle university status
router.post('/universities/:universityId/toggle-status', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { universityId } = req.params;
    
    const result = await query(
      'UPDATE universities SET is_enabled = NOT is_enabled WHERE id = $1 RETURNING *',
      [universityId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'University not found' });
      return;
    }
    
    res.json({ message: 'University status toggled', success: true, is_enabled: result.rows[0].is_enabled });
  } catch (error) {
    console.error('Toggle university status error:', error);
    res.status(500).json({ detail: 'Failed to toggle status' });
  }
});

// Get admins
router.get('/admins', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { university_id, search, page = 1, page_size = 20 } = req.query;
    
    const conditions: string[] = ["role = 'admin'"];
    const values: any[] = [];
    let paramIndex = 1;
    
    if (university_id) {
      conditions.push(`university_id = $${paramIndex++}`);
      values.push(university_id);
    }
    
    if (search) {
      conditions.push(`(name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
      values.push(`%${search}%`);
      paramIndex++;
    }
    
    const whereClause = conditions.join(' AND ');
    const offset = (Number(page) - 1) * Number(page_size);
    
    const countResult = await query(
      `SELECT COUNT(*) FROM users WHERE ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);
    
    values.push(Number(page_size), offset);
    
    const result = await query(
      `SELECT u.*, un.name as university_name
       FROM users u
       LEFT JOIN universities un ON u.university_id = un.id
       WHERE ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      values
    );
    
    const admins = result.rows.map((a: any) => {
      const { password_hash, ...safeAdmin } = a;
      return safeAdmin;
    });
    
    res.json({ admins, total });
  } catch (error) {
    console.error('Get admins error:', error);
    res.status(500).json({ detail: 'Failed to get admins' });
  }
});

// Create admin
router.post('/admins', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, password, name, university_id } = req.body;
    
    if (!email || !password || !name || !university_id) {
      res.status(400).json({ detail: 'Email, password, name, and university_id are required' });
      return;
    }
    
    // Check if email exists
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      res.status(400).json({ detail: 'Email already exists' });
      return;
    }
    
    // Check if university exists
    const uni = await query('SELECT id FROM universities WHERE id = $1', [university_id]);
    if (uni.rows.length === 0) {
      res.status(400).json({ detail: 'University not found' });
      return;
    }
    
    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(email)}`;
    
    await query(
      `INSERT INTO users (id, email, password_hash, name, avatar, university_id, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, 'admin', true)`,
      [userId, email.toLowerCase(), passwordHash, name, avatar, university_id]
    );
    
    const result = await query(
      `SELECT u.*, un.name as university_name
       FROM users u
       LEFT JOIN universities un ON u.university_id = un.id
       WHERE u.id = $1`,
      [userId]
    );
    
    const { password_hash, ...safeAdmin } = result.rows[0] as any;
    
    res.status(201).json(safeAdmin);
  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({ detail: 'Failed to create admin' });
  }
});

// Update admin
router.put('/admins/:adminId', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { adminId } = req.params;
    const { name, email, university_id } = req.body;
    
    const result = await query(
      `UPDATE users SET 
       name = COALESCE($1, name),
       email = COALESCE($2, email),
       university_id = COALESCE($3, university_id)
       WHERE id = $4 AND role = 'admin' RETURNING *`,
      [name, email?.toLowerCase(), university_id, adminId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Admin not found' });
      return;
    }
    
    const { password_hash, ...safeAdmin } = result.rows[0] as any;
    
    res.json(safeAdmin);
  } catch (error) {
    console.error('Update admin error:', error);
    res.status(500).json({ detail: 'Failed to update admin' });
  }
});

// Deactivate admin
router.delete('/admins/:adminId', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { adminId } = req.params;
    
    const result = await query(
      "UPDATE users SET is_active = false WHERE id = $1 AND role = 'admin' RETURNING id",
      [adminId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Admin not found' });
      return;
    }
    
    res.json({ message: 'Admin deactivated', success: true });
  } catch (error) {
    console.error('Deactivate admin error:', error);
    res.status(500).json({ detail: 'Failed to deactivate admin' });
  }
});

// Get all users (global)
router.get('/users', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { university_id, role, search, page = 1, page_size = 20 } = req.query;
    
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    if (university_id) {
      conditions.push(`university_id = $${paramIndex++}`);
      values.push(university_id);
    }
    
    if (role) {
      conditions.push(`role = $${paramIndex++}`);
      values.push(role);
    }
    
    if (search) {
      conditions.push(`(name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
      values.push(`%${search}%`);
      paramIndex++;
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (Number(page) - 1) * Number(page_size);
    
    const countResult = await query(
      `SELECT COUNT(*) FROM users ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);
    
    values.push(Number(page_size), offset);
    
    const result = await query(
      `SELECT u.*, un.name as university_name
       FROM users u
       LEFT JOIN universities un ON u.university_id = un.id
       ${whereClause}
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

// Get admin password resets
router.get('/password-resets', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT pr.id, pr.created_at as requested_at, u.id as user_id, u.name as user_name, u.email as user_email, un.name as university_name
       FROM password_reset_requests pr
       JOIN users u ON pr.user_id = u.id
       LEFT JOIN universities un ON u.university_id = un.id
       WHERE u.role = 'admin' AND pr.status = 'pending'
       ORDER BY pr.created_at DESC`
    );
    
    res.json({ requests: result.rows });
  } catch (error) {
    console.error('Get admin password resets error:', error);
    res.status(500).json({ detail: 'Failed to get password resets' });
  }
});

// Reset admin password
router.post('/password-resets/:adminId/reset', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { adminId } = req.params;
    const { new_password } = req.body;
    
    if (!new_password || new_password.length < 6) {
      res.status(400).json({ detail: 'Password must be at least 6 characters' });
      return;
    }
    
    const passwordHash = await bcrypt.hash(new_password, 10);
    
    await transaction(async (client) => {
      const result = await client.query(
        "UPDATE users SET password_hash = $1 WHERE id = $2 AND role = 'admin' RETURNING id",
        [passwordHash, adminId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Admin not found');
      }
      
      await client.query(
        "UPDATE password_reset_requests SET status = 'completed' WHERE user_id = $1",
        [adminId]
      );
    });
    
    res.json({ message: 'Password reset successful', success: true });
  } catch (error: any) {
    console.error('Reset admin password error:', error);
    res.status(400).json({ detail: error.message || 'Failed to reset password' });
  }
});

// Get global ads
router.get('/ads', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM ads WHERE is_global = true ORDER BY created_at DESC');
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get global ads error:', error);
    res.status(500).json({ detail: 'Failed to get ads' });
  }
});

// Create global ad
router.post('/ads', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, description, image, link, placement } = req.body;
    
    if (!title) {
      res.status(400).json({ detail: 'Title is required' });
      return;
    }
    
    const adId = uuidv4();
    
    await query(
      `INSERT INTO ads (id, title, description, image, link, placement, is_active, is_global)
       VALUES ($1, $2, $3, $4, $5, $6, true, true)`,
      [adId, title, description, image, link, placement || 'feed']
    );
    
    const result = await query('SELECT * FROM ads WHERE id = $1', [adId]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create global ad error:', error);
    res.status(500).json({ detail: 'Failed to create ad' });
  }
});

// Update global ad
router.put('/ads/:adId', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
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
       WHERE id = $7 AND is_global = true RETURNING *`,
      [title, description, image, link, placement, is_active, adId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Ad not found' });
      return;
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update global ad error:', error);
    res.status(500).json({ detail: 'Failed to update ad' });
  }
});

// Delete global ad
router.delete('/ads/:adId', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { adId } = req.params;
    
    const result = await query('DELETE FROM ads WHERE id = $1 AND is_global = true RETURNING id', [adId]);
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Ad not found' });
      return;
    }
    
    res.json({ message: 'Ad deleted', success: true });
  } catch (error) {
    console.error('Delete global ad error:', error);
    res.status(500).json({ detail: 'Failed to delete ad' });
  }
});

// Get analytics
router.get('/analytics', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { start_date, end_date, university_id } = req.query;
    
    // Basic analytics - in production, this would be more sophisticated
    const userGrowth = await query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM users
       WHERE role = 'alumni'
       GROUP BY DATE(created_at)
       ORDER BY date DESC
       LIMIT 30`
    );
    
    const postActivity = await query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM posts
       WHERE is_active = true
       GROUP BY DATE(created_at)
       ORDER BY date DESC
       LIMIT 30`
    );
    
    const eventParticipation = await query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM event_registrations
       GROUP BY DATE(created_at)
       ORDER BY date DESC
       LIMIT 30`
    );
    
    const universityStats = await query(
      `SELECT u.id, u.name,
              (SELECT COUNT(*) FROM users WHERE university_id = u.id AND role = 'alumni') as alumni_count,
              (SELECT COUNT(*) FROM posts WHERE university_id = u.id AND is_active = true) as posts_count,
              (SELECT COUNT(*) FROM events WHERE university_id = u.id AND is_active = true) as events_count
       FROM universities u
       WHERE u.is_enabled = true
       ORDER BY alumni_count DESC`
    );
    
    res.json({
      user_growth: userGrowth.rows,
      post_activity: postActivity.rows,
      event_participation: eventParticipation.rows,
      university_stats: universityStats.rows,
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ detail: 'Failed to get analytics' });
  }
});

export default router;

