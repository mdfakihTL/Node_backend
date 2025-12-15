import { Router, Response } from 'express';
import { query, transaction } from '../database/connection';
import { authenticate } from '../middleware/auth';
import { validate, schemas } from '../middleware/validation';
import { AuthenticatedRequest, User, UserProfile } from '../types';

const router = Router();

// Get my profile
router.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT u.*, un.name as university_name,
              p.bio, p.phone, p.location, p.job_title, p.company, 
              p.linkedin, p.website, p.banner, p.experience, p.education, p.skills,
              (SELECT COUNT(*) FROM connections WHERE user_id = u.id OR connected_user_id = u.id) as connections_count,
              (SELECT COUNT(*) FROM posts WHERE author_id = u.id AND is_active = true) as posts_count
       FROM users u
       LEFT JOIN universities un ON u.university_id = un.id
       LEFT JOIN user_profiles p ON u.id = p.user_id
       WHERE u.id = $1`,
      [req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'User not found' });
      return;
    }
    
    const user = result.rows[0] as any;
    const { password_hash, bio, phone, location, job_title, company, linkedin, website, banner, experience, education, skills, connections_count, posts_count, ...safeUser } = user;
    
    // Structure profile data
    const profile = {
      bio,
      phone,
      location,
      job_title,
      company,
      linkedin,
      website,
      banner,
      experience,
      education,
      skills,
      connections_count: parseInt(connections_count) || 0,
      posts_count: parseInt(posts_count) || 0,
    };
    
    res.json({
      ...safeUser,
      profile,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ detail: 'Failed to get profile' });
  }
});

// Update my user info
router.put('/me', authenticate, validate(schemas.updateUser), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, avatar, graduation_year, major, is_mentor } = req.body;
    
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (avatar !== undefined) {
      updates.push(`avatar = $${paramIndex++}`);
      values.push(avatar);
    }
    if (graduation_year !== undefined) {
      updates.push(`graduation_year = $${paramIndex++}`);
      values.push(graduation_year);
    }
    if (major !== undefined) {
      updates.push(`major = $${paramIndex++}`);
      values.push(major);
    }
    if (is_mentor !== undefined) {
      updates.push(`is_mentor = $${paramIndex++}`);
      values.push(is_mentor);
    }
    
    if (updates.length === 0) {
      res.status(400).json({ detail: 'No fields to update' });
      return;
    }
    
    values.push(req.userId);
    
    const result = await query<User>(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'User not found' });
      return;
    }
    
    const { password_hash, ...safeUser } = result.rows[0] as any;
    res.json(safeUser);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ detail: 'Failed to update user' });
  }
});

// Update my profile
router.put('/me/profile', authenticate, validate(schemas.updateProfile), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { bio, phone, location, job_title, company, linkedin, website, banner, experience, education } = req.body;
    
    // Check if profile exists
    const existing = await query('SELECT id FROM user_profiles WHERE user_id = $1', [req.userId]);
    
    if (existing.rows.length === 0) {
      // Create profile
      const result = await query<UserProfile>(
        `INSERT INTO user_profiles (user_id, bio, phone, location, job_title, company, linkedin, website, banner, experience, education)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [req.userId, bio, phone, location, job_title, company, linkedin, website, banner, experience, education]
      );
      res.json(result.rows[0]);
    } else {
      // Update profile
      const result = await query<UserProfile>(
        `UPDATE user_profiles SET 
         bio = COALESCE($1, bio),
         phone = COALESCE($2, phone),
         location = COALESCE($3, location),
         job_title = COALESCE($4, job_title),
         company = COALESCE($5, company),
         linkedin = COALESCE($6, linkedin),
         website = COALESCE($7, website),
         banner = COALESCE($8, banner),
         experience = COALESCE($9, experience),
         education = COALESCE($10, education)
         WHERE user_id = $11 RETURNING *`,
        [bio, phone, location, job_title, company, linkedin, website, banner, experience, education, req.userId]
      );
      res.json(result.rows[0]);
    }
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ detail: 'Failed to update profile' });
  }
});

// Get user by ID
router.get('/:userId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req.params;
    
    const result = await query(
      `SELECT u.*, un.name as university_name,
              p.bio, p.phone, p.location, p.job_title, p.company, 
              p.linkedin, p.website, p.banner, p.experience, p.education, p.skills,
              (SELECT COUNT(*) FROM connections WHERE user_id = u.id OR connected_user_id = u.id) as connections_count,
              (SELECT COUNT(*) FROM posts WHERE author_id = u.id AND is_active = true) as posts_count
       FROM users u
       LEFT JOIN universities un ON u.university_id = un.id
       LEFT JOIN user_profiles p ON u.id = p.user_id
       WHERE u.id = $1 AND u.is_active = true`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'User not found' });
      return;
    }
    
    const user = result.rows[0] as any;
    const { password_hash, bio, phone, location, job_title, company, linkedin, website, banner, experience, education, skills, connections_count, posts_count, ...safeUser } = user;
    
    const profile = {
      bio,
      phone,
      location,
      job_title,
      company,
      linkedin,
      website,
      banner,
      experience,
      education,
      skills,
      connections_count: parseInt(connections_count) || 0,
      posts_count: parseInt(posts_count) || 0,
    };
    
    res.json({
      ...safeUser,
      profile,
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ detail: 'Failed to get user' });
  }
});

// Search users
router.get('/search', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { search, university_id, graduation_year, is_mentor, page = 1, page_size = 20 } = req.query;
    
    const conditions: string[] = ['u.is_active = true', 'u.role = $1'];
    const values: any[] = ['alumni'];
    let paramIndex = 2;
    
    // Alumni can only see users from their own university
    if (req.user?.role === 'alumni' && req.user?.university_id) {
      conditions.push(`u.university_id = $${paramIndex++}`);
      values.push(req.user.university_id);
    } else if (university_id) {
      conditions.push(`u.university_id = $${paramIndex++}`);
      values.push(university_id);
    }
    
    if (search) {
      conditions.push(`(u.name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex} OR u.major ILIKE $${paramIndex})`);
      values.push(`%${search}%`);
      paramIndex++;
    }
    
    if (graduation_year) {
      conditions.push(`u.graduation_year = $${paramIndex++}`);
      values.push(graduation_year);
    }
    
    if (is_mentor !== undefined) {
      conditions.push(`u.is_mentor = $${paramIndex++}`);
      values.push(is_mentor === 'true');
    }
    
    const whereClause = conditions.join(' AND ');
    const offset = (Number(page) - 1) * Number(page_size);
    
    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM users u WHERE ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);
    
    // Get users
    values.push(Number(page_size), offset);
    const result = await query(
      `SELECT u.*, un.name as university_name,
              p.job_title, p.company, p.location
       FROM users u
       LEFT JOIN universities un ON u.university_id = un.id
       LEFT JOIN user_profiles p ON u.id = p.user_id
       WHERE ${whereClause}
       ORDER BY u.name
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
    console.error('Search users error:', error);
    res.status(500).json({ detail: 'Failed to search users' });
  }
});

// Toggle mentor status
router.post('/me/toggle-mentor', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query<User>(
      'UPDATE users SET is_mentor = NOT is_mentor WHERE id = $1 RETURNING *',
      [req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'User not found' });
      return;
    }
    
    const user = result.rows[0];
    
    // If becoming a mentor, create mentor profile if doesn't exist
    if (user.is_mentor) {
      await query(
        `INSERT INTO mentors (user_id, is_active) VALUES ($1, true) ON CONFLICT (user_id) DO UPDATE SET is_active = true`,
        [req.userId]
      );
    } else {
      // If no longer a mentor, deactivate mentor profile
      await query('UPDATE mentors SET is_active = false WHERE user_id = $1', [req.userId]);
    }
    
    res.json({ message: `Mentor status updated`, success: true, is_mentor: user.is_mentor });
  } catch (error) {
    console.error('Toggle mentor error:', error);
    res.status(500).json({ detail: 'Failed to toggle mentor status' });
  }
});

// Update avatar
router.put('/me/avatar', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { avatar } = req.body;
    
    if (!avatar) {
      res.status(400).json({ detail: 'Avatar URL is required' });
      return;
    }
    
    const result = await query<User>(
      'UPDATE users SET avatar = $1 WHERE id = $2 RETURNING *',
      [avatar, req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'User not found' });
      return;
    }
    
    const { password_hash, ...safeUser } = result.rows[0] as any;
    res.json(safeUser);
  } catch (error) {
    console.error('Update avatar error:', error);
    res.status(500).json({ detail: 'Failed to update avatar' });
  }
});

// Update banner
router.put('/me/banner', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { banner } = req.body;
    
    if (!banner) {
      res.status(400).json({ detail: 'Banner URL is required' });
      return;
    }
    
    const result = await query(
      'UPDATE user_profiles SET banner = $1 WHERE user_id = $2 RETURNING *',
      [banner, req.userId]
    );
    
    if (result.rows.length === 0) {
      // Profile doesn't exist, create it
      await query(
        'INSERT INTO user_profiles (user_id, banner) VALUES ($1, $2)',
        [req.userId, banner]
      );
    }
    
    res.json({ message: 'Banner updated', success: true, banner });
  } catch (error) {
    console.error('Update banner error:', error);
    res.status(500).json({ detail: 'Failed to update banner' });
  }
});

// Mark profile as complete
router.post('/me/complete-profile', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await query(
      'UPDATE users SET is_profile_complete = true, first_login = false WHERE id = $1',
      [req.userId]
    );
    
    res.json({ message: 'Profile marked as complete', success: true });
  } catch (error) {
    console.error('Complete profile error:', error);
    res.status(500).json({ detail: 'Failed to mark profile complete' });
  }
});

// Check if first login
router.get('/me/first-login', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT first_login, is_profile_complete FROM users WHERE id = $1',
      [req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'User not found' });
      return;
    }
    
    res.json({
      first_login: result.rows[0].first_login,
      is_profile_complete: result.rows[0].is_profile_complete,
    });
  } catch (error) {
    console.error('Check first login error:', error);
    res.status(500).json({ detail: 'Failed to check first login' });
  }
});

// Acknowledge first login (so prompt doesn't show again)
router.post('/me/acknowledge-first-login', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await query('UPDATE users SET first_login = false WHERE id = $1', [req.userId]);
    res.json({ message: 'First login acknowledged', success: true });
  } catch (error) {
    console.error('Acknowledge first login error:', error);
    res.status(500).json({ detail: 'Failed to acknowledge' });
  }
});

// Get alumni locations (for world map) - filtered by university
router.get('/locations', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const universityId = req.user?.role === 'superadmin' ? null : req.user?.university_id;
    
    let locationQuery = `
      SELECT up.location, COUNT(*) as count,
             array_agg(json_build_object('id', u.id, 'name', u.name, 'avatar', u.avatar, 'job_title', up.job_title, 'company', up.company)) as alumni
      FROM users u
      JOIN user_profiles up ON u.id = up.user_id
      WHERE u.is_active = true AND up.location IS NOT NULL AND up.location != ''`;
    
    const values: any[] = [];
    
    if (universityId) {
      locationQuery += ' AND u.university_id = $1';
      values.push(universityId);
    }
    
    locationQuery += ' GROUP BY up.location ORDER BY count DESC';
    
    const result = await query(locationQuery, values);
    
    // Transform to coordinates (simplified - in production use geocoding)
    const locationCoordinates: Record<string, [number, number]> = {
      'San Francisco, CA': [37.7749, -122.4194],
      'New York, NY': [40.7128, -74.0060],
      'Los Angeles, CA': [34.0522, -118.2437],
      'Seattle, WA': [47.6062, -122.3321],
      'Boston, MA': [42.3601, -71.0589],
      'Chicago, IL': [41.8781, -87.6298],
      'Austin, TX': [30.2672, -97.7431],
      'Denver, CO': [39.7392, -104.9903],
      'Miami, FL': [25.7617, -80.1918],
      'Atlanta, GA': [33.7490, -84.3880],
      'London, UK': [51.5074, -0.1278],
      'Singapore': [1.3521, 103.8198],
      'Tokyo, Japan': [35.6762, 139.6503],
      'Sydney, Australia': [-33.8688, 151.2093],
      'Toronto, Canada': [43.6532, -79.3832],
    };
    
    const locations = result.rows.map((row: any) => {
      const coords = locationCoordinates[row.location] || [0, 0];
      return {
        location: row.location,
        count: parseInt(row.count),
        lat: coords[0],
        lng: coords[1],
        alumni: row.alumni.slice(0, 10), // Limit to 10 alumni per location
      };
    });
    
    res.json({ locations, total: locations.reduce((sum: number, l: any) => sum + l.count, 0) });
  } catch (error) {
    console.error('Get locations error:', error);
    res.status(500).json({ detail: 'Failed to get locations' });
  }
});

export default router;

