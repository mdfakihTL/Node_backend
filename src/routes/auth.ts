import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query, transaction } from '../database/connection';
import { authenticate, generateToken } from '../middleware/auth';
import { validate, schemas } from '../middleware/validation';
import { AuthenticatedRequest, User, University, UserProfile } from '../types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Login
router.post('/login', validate(schemas.login), async (req, res: Response) => {
  try {
    const { email, password } = req.body;
    
    // Find user
    const userResult = await query<User>(
      `SELECT u.*, un.name as university_name, un.logo, un.colors, un.is_enabled
       FROM users u
       LEFT JOIN universities un ON u.university_id = un.id
       WHERE u.email = $1`,
      [email.toLowerCase()]
    );
    
    if (userResult.rows.length === 0) {
      res.status(401).json({ detail: 'Invalid email or password' });
      return;
    }
    
    const user = userResult.rows[0] as User & { university_name?: string; logo?: string; colors?: any; is_enabled?: boolean };
    
    // Check if user is active
    if (!user.is_active) {
      res.status(401).json({ detail: 'Account is deactivated' });
      return;
    }
    
    // Check if university is enabled (for non-superadmins)
    if (user.role !== 'superadmin' && user.university_id && user.is_enabled === false) {
      res.status(401).json({ detail: 'University is currently disabled' });
      return;
    }
    
    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash || '');
    if (!validPassword) {
      res.status(401).json({ detail: 'Invalid email or password' });
      return;
    }
    
    // Generate token
    const token = generateToken(user);
    
    // Build university branding
    let universityBranding = null;
    if (user.university_id) {
      universityBranding = {
        id: user.university_id,
        name: user.university_name,
        logo: user.logo,
        colors: user.colors,
        is_enabled: user.is_enabled,
      };
    }
    
    // For superadmin, get all universities
    let universities = null;
    if (user.role === 'superadmin') {
      const uniResult = await query<University>('SELECT * FROM universities ORDER BY name');
      universities = uniResult.rows.map(u => ({
        id: u.id,
        name: u.name,
        logo: u.logo,
        colors: u.colors,
        is_enabled: u.is_enabled,
      }));
    }
    
    // Remove password_hash from response
    const { password_hash, logo, colors, is_enabled, ...safeUser } = user as any;
    
    res.json({
      access_token: token,
      token_type: 'bearer',
      user: {
        ...safeUser,
        university_name: user.university_name,
      },
      university_branding: universityBranding,
      universities,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ detail: 'Login failed' });
  }
});

// Register (for alumni - admins created by superadmin)
router.post('/register', validate(schemas.register), async (req, res: Response) => {
  try {
    const { email, password, name, university_id, graduation_year, major } = req.body;
    
    // Check if university exists and is enabled
    if (university_id) {
      const uniResult = await query<University>(
        'SELECT * FROM universities WHERE id = $1 AND is_enabled = true',
        [university_id]
      );
      if (uniResult.rows.length === 0) {
        res.status(400).json({ detail: 'Invalid or disabled university' });
        return;
      }
    }
    
    // Check if email already exists
    const existingUser = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existingUser.rows.length > 0) {
      res.status(400).json({ detail: 'Email already registered' });
      return;
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Create user
    const userId = uuidv4();
    const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(email)}`;
    
    await transaction(async (client) => {
      // Insert user
      await client.query(
        `INSERT INTO users (id, email, password_hash, name, avatar, university_id, graduation_year, major, role, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'alumni', true)`,
        [userId, email.toLowerCase(), passwordHash, name, avatar, university_id, graduation_year, major]
      );
      
      // Create empty profile
      await client.query(
        'INSERT INTO user_profiles (user_id) VALUES ($1)',
        [userId]
      );
    });
    
    // Get created user with university info
    const userResult = await query<User>(
      `SELECT u.*, un.name as university_name, un.logo, un.colors
       FROM users u
       LEFT JOIN universities un ON u.university_id = un.id
       WHERE u.id = $1`,
      [userId]
    );
    
    const user = userResult.rows[0] as User & { university_name?: string; logo?: string; colors?: any };
    const token = generateToken(user);
    
    // Build branding
    let universityBranding = null;
    if (user.university_id) {
      universityBranding = {
        id: user.university_id,
        name: user.university_name,
        logo: user.logo,
        colors: user.colors,
      };
    }
    
    const { password_hash, logo, colors, ...safeUser } = user as any;
    
    res.status(201).json({
      access_token: token,
      token_type: 'bearer',
      user: {
        ...safeUser,
        university_name: user.university_name,
      },
      university_branding: universityBranding,
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ detail: 'Registration failed' });
  }
});

// Logout
router.post('/logout', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // In a more sophisticated implementation, we'd blacklist the token
    // For now, the frontend handles logout by removing the token
    res.json({ message: 'Logged out successfully', success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ detail: 'Logout failed' });
  }
});

// Get current user
router.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query<User & { university_name?: string }>(
      `SELECT u.*, un.name as university_name
       FROM users u
       LEFT JOIN universities un ON u.university_id = un.id
       WHERE u.id = $1`,
      [req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'User not found' });
      return;
    }
    
    const user = result.rows[0];
    
    // Get profile
    const profileResult = await query<UserProfile>(
      'SELECT * FROM user_profiles WHERE user_id = $1',
      [req.userId]
    );
    
    const { password_hash, ...safeUser } = user as any;
    
    res.json({
      ...safeUser,
      profile: profileResult.rows[0] || null,
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ detail: 'Failed to get user' });
  }
});

// Request password reset
router.post('/request-password-reset', async (req, res: Response) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      res.status(400).json({ detail: 'Email is required' });
      return;
    }
    
    // Find user
    const userResult = await query<User>(
      'SELECT id, email, university_id FROM users WHERE email = $1 AND is_active = true',
      [email.toLowerCase()]
    );
    
    if (userResult.rows.length === 0) {
      // Don't reveal if user exists
      res.json({
        message: 'If your email is registered, you will receive a password reset link',
        success: true,
      });
      return;
    }
    
    const user = userResult.rows[0];
    
    // Create password reset request
    await query(
      'INSERT INTO password_reset_requests (user_id, status) VALUES ($1, $2)',
      [user.id, 'pending']
    );
    
    // In production, send email here
    // For now, admin can see the request and reset the password manually
    
    res.json({
      message: 'Password reset request submitted. Please contact your university admin.',
      success: true,
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ detail: 'Failed to process request' });
  }
});

// Get available universities (for registration)
router.get('/universities', async (req, res: Response) => {
  try {
    const result = await query<University>(
      'SELECT id, name, logo, colors FROM universities WHERE is_enabled = true ORDER BY name'
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get universities error:', error);
    res.status(500).json({ detail: 'Failed to get universities' });
  }
});

// Refresh branding
router.post('/refresh-branding', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query<User & { university_name?: string; logo?: string; colors?: any }>(
      `SELECT u.*, un.name as university_name, un.logo, un.colors
       FROM users u
       LEFT JOIN universities un ON u.university_id = un.id
       WHERE u.id = $1`,
      [req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'User not found' });
      return;
    }
    
    const user = result.rows[0];
    const token = generateToken(user);
    
    let universityBranding = null;
    if (user.university_id) {
      universityBranding = {
        id: user.university_id,
        name: user.university_name,
        logo: user.logo,
        colors: user.colors,
      };
    }
    
    // For superadmin, get all universities
    let universities = null;
    if (user.role === 'superadmin') {
      const uniResult = await query<University>('SELECT * FROM universities ORDER BY name');
      universities = uniResult.rows.map(u => ({
        id: u.id,
        name: u.name,
        logo: u.logo,
        colors: u.colors,
        is_enabled: u.is_enabled,
      }));
    }
    
    const { password_hash, logo, colors, ...safeUser } = user as any;
    
    res.json({
      access_token: token,
      token_type: 'bearer',
      user: {
        ...safeUser,
        university_name: user.university_name,
      },
      university_branding: universityBranding,
      universities,
    });
  } catch (error) {
    console.error('Refresh branding error:', error);
    res.status(500).json({ detail: 'Failed to refresh branding' });
  }
});

export default router;

