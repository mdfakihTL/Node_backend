import { Router, Response } from 'express';
import { query } from '../database/connection';
import { authenticate, optionalAuth } from '../middleware/auth';
import { AuthenticatedRequest, University, Fundraiser, Ad } from '../types';

const router = Router();

// Get all universities (public)
router.get('/', async (req, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM universities WHERE is_enabled = true ORDER BY name'
    );
    
    res.json({
      universities: result.rows,
      total: result.rows.length,
    });
  } catch (error) {
    console.error('Get universities error:', error);
    res.status(500).json({ detail: 'Failed to get universities' });
  }
});

// Get single university
router.get('/:universityId', async (req, res: Response) => {
  try {
    const { universityId } = req.params;
    
    const result = await query(
      'SELECT * FROM universities WHERE id = $1',
      [universityId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'University not found' });
      return;
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get university error:', error);
    res.status(500).json({ detail: 'Failed to get university' });
  }
});

// Get university branding
router.get('/:universityId/branding', async (req, res: Response) => {
  try {
    const { universityId } = req.params;
    
    const result = await query(
      'SELECT id, name, logo, colors, is_enabled FROM universities WHERE id = $1',
      [universityId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'University not found' });
      return;
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get branding error:', error);
    res.status(500).json({ detail: 'Failed to get branding' });
  }
});

// Get university fundraisers
router.get('/:universityId/fundraisers', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { universityId } = req.params;
    
    const result = await query(
      'SELECT * FROM fundraisers WHERE university_id = $1 ORDER BY created_at DESC',
      [universityId]
    );
    
    const fundraisers = result.rows.map((f: any) => ({
      id: f.id,
      university_id: f.university_id,
      title: f.title,
      description: f.description,
      image: f.image,
      goal_amount: parseFloat(f.goal_amount),
      current_amount: parseFloat(f.current_amount),
      donation_link: f.donation_link,
      start_date: f.start_date,
      end_date: f.end_date,
      is_active: f.is_active,
      created_at: f.created_at,
    }));
    
    res.json(fundraisers);
  } catch (error) {
    console.error('Get fundraisers error:', error);
    res.status(500).json({ detail: 'Failed to get fundraisers' });
  }
});

// Get active fundraisers
router.get('/:universityId/fundraisers/active', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { universityId } = req.params;
    
    const result = await query(
      `SELECT * FROM fundraisers 
       WHERE university_id = $1 
         AND is_active = true 
         AND start_date <= CURRENT_DATE 
         AND end_date >= CURRENT_DATE
       ORDER BY end_date ASC`,
      [universityId]
    );
    
    const fundraisers = result.rows.map((f: any) => ({
      id: f.id,
      university_id: f.university_id,
      title: f.title,
      description: f.description,
      image: f.image,
      goal_amount: parseFloat(f.goal_amount),
      current_amount: parseFloat(f.current_amount),
      donation_link: f.donation_link,
      start_date: f.start_date,
      end_date: f.end_date,
      is_active: f.is_active,
      created_at: f.created_at,
    }));
    
    res.json(fundraisers);
  } catch (error) {
    console.error('Get active fundraisers error:', error);
    res.status(500).json({ detail: 'Failed to get fundraisers' });
  }
});

// Get ads (university-specific and global)
router.get('/ads', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { university_id } = req.query;
    
    let result;
    
    if (university_id) {
      result = await query(
        `SELECT * FROM ads 
         WHERE is_active = true AND (university_id = $1 OR is_global = true)
         ORDER BY is_global ASC, created_at DESC`,
        [university_id]
      );
    } else {
      result = await query(
        `SELECT * FROM ads WHERE is_active = true AND is_global = true ORDER BY created_at DESC`
      );
    }
    
    const ads = result.rows.map((a: any) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      image: a.image,
      link: a.link,
      placement: a.placement,
      is_active: a.is_active,
    }));
    
    res.json(ads);
  } catch (error) {
    console.error('Get ads error:', error);
    res.status(500).json({ detail: 'Failed to get ads' });
  }
});

export default router;

