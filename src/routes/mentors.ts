import { Router, Response } from 'express';
import { query, transaction } from '../database/connection';
import { authenticate } from '../middleware/auth';
import { AuthenticatedRequest, Mentor, MentorshipRequest } from '../types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get available mentors
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { expertise, availability, search, page = 1, page_size = 20 } = req.query;
    
    const conditions: string[] = ['m.is_active = true', 'u.is_mentor = true', 'u.is_active = true'];
    const values: any[] = [];
    let paramIndex = 1;
    
    // Filter by university
    if (req.user?.university_id) {
      conditions.push(`u.university_id = $${paramIndex++}`);
      values.push(req.user.university_id);
    }
    
    if (expertise) {
      conditions.push(`$${paramIndex} = ANY(m.expertise)`);
      values.push(expertise);
      paramIndex++;
    }
    
    if (availability) {
      conditions.push(`m.availability = $${paramIndex++}`);
      values.push(availability);
    }
    
    if (search) {
      conditions.push(`(u.name ILIKE $${paramIndex} OR m.bio ILIKE $${paramIndex} OR m.title ILIKE $${paramIndex})`);
      values.push(`%${search}%`);
      paramIndex++;
    }
    
    const whereClause = conditions.join(' AND ');
    const offset = (Number(page) - 1) * Number(page_size);
    
    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM mentors m
       JOIN users u ON m.user_id = u.id
       WHERE ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);
    
    // Get mentors with match score
    values.push(Number(page_size), offset);
    
    const result = await query(
      `SELECT m.*, u.id as user_id, u.name, u.avatar,
              ROUND(RANDOM() * 30 + 70) as match_score
       FROM mentors m
       JOIN users u ON m.user_id = u.id
       WHERE ${whereClause}
       ORDER BY m.years_experience DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      values
    );
    
    const mentors = result.rows.map((m: any) => ({
      id: m.id,
      user_id: m.user_id,
      name: m.name,
      avatar: m.avatar,
      title: m.title,
      company: m.company,
      location: m.location,
      bio: m.bio,
      expertise: m.expertise || [],
      availability: m.availability,
      years_experience: m.years_experience,
      mentees_count: m.mentees_count,
      match_score: parseInt(m.match_score),
    }));
    
    res.json({ mentors, total });
  } catch (error) {
    console.error('Get mentors error:', error);
    res.status(500).json({ detail: 'Failed to get mentors' });
  }
});

// Get mentor by ID
router.get('/:mentorId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mentorId } = req.params;
    
    const result = await query(
      `SELECT m.*, u.id as user_id, u.name, u.avatar
       FROM mentors m
       JOIN users u ON m.user_id = u.id
       WHERE m.id = $1 AND m.is_active = true`,
      [mentorId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Mentor not found' });
      return;
    }
    
    const m = result.rows[0];
    
    res.json({
      id: m.id,
      user_id: m.user_id,
      name: m.name,
      avatar: m.avatar,
      title: m.title,
      company: m.company,
      location: m.location,
      bio: m.bio,
      expertise: m.expertise || [],
      availability: m.availability,
      years_experience: m.years_experience,
      mentees_count: m.mentees_count,
      match_score: Math.floor(Math.random() * 30) + 70,
    });
  } catch (error) {
    console.error('Get mentor error:', error);
    res.status(500).json({ detail: 'Failed to get mentor' });
  }
});

// Get my mentor profile
router.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT m.*, u.id as user_id, u.name, u.avatar
       FROM mentors m
       JOIN users u ON m.user_id = u.id
       WHERE m.user_id = $1`,
      [req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Mentor profile not found' });
      return;
    }
    
    const m = result.rows[0];
    
    res.json({
      id: m.id,
      user_id: m.user_id,
      name: m.name,
      avatar: m.avatar,
      title: m.title,
      company: m.company,
      location: m.location,
      bio: m.bio,
      expertise: m.expertise || [],
      availability: m.availability,
      years_experience: m.years_experience,
      mentees_count: m.mentees_count,
      match_score: 100,
    });
  } catch (error) {
    console.error('Get my mentor profile error:', error);
    res.status(500).json({ detail: 'Failed to get mentor profile' });
  }
});

// Update my mentor profile
router.put('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, company, location, bio, expertise, availability } = req.body;
    
    const result = await query(
      `UPDATE mentors SET 
       title = COALESCE($1, title),
       company = COALESCE($2, company),
       location = COALESCE($3, location),
       bio = COALESCE($4, bio),
       expertise = COALESCE($5, expertise),
       availability = COALESCE($6, availability)
       WHERE user_id = $7 RETURNING *`,
      [title, company, location, bio, expertise, availability, req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Mentor profile not found' });
      return;
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update mentor profile error:', error);
    res.status(500).json({ detail: 'Failed to update mentor profile' });
  }
});

// Request mentorship
router.post('/:mentorId/request', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mentorId } = req.params;
    const { message } = req.body;
    
    // Check if already requested
    const existing = await query(
      'SELECT id FROM mentorship_requests WHERE mentor_id = $1 AND mentee_id = $2',
      [mentorId, req.userId]
    );
    
    if (existing.rows.length > 0) {
      res.status(400).json({ detail: 'Request already sent' });
      return;
    }
    
    // Check if mentor exists
    const mentor = await query(
      'SELECT user_id FROM mentors WHERE id = $1 AND is_active = true',
      [mentorId]
    );
    
    if (mentor.rows.length === 0) {
      res.status(404).json({ detail: 'Mentor not found' });
      return;
    }
    
    // Cannot request mentorship from yourself
    if (mentor.rows[0].user_id === req.userId) {
      res.status(400).json({ detail: 'Cannot request mentorship from yourself' });
      return;
    }
    
    const requestId = uuidv4();
    
    await query(
      'INSERT INTO mentorship_requests (id, mentor_id, mentee_id, message, status) VALUES ($1, $2, $3, $4, $5)',
      [requestId, mentorId, req.userId, message, 'pending']
    );
    
    // Create notification for mentor
    await query(
      `INSERT INTO notifications (user_id, type, title, message, avatar, action_url, related_id)
       SELECT $1, 'mentorship_request', 'New Mentorship Request', 
              $2 || ' wants to be your mentee', 
              avatar, '/mentorship', $3
       FROM users WHERE id = $4`,
      [mentor.rows[0].user_id, req.user?.name, requestId, req.userId]
    );
    
    res.json({ message: 'Mentorship request sent', success: true });
  } catch (error) {
    console.error('Request mentorship error:', error);
    res.status(500).json({ detail: 'Failed to send request' });
  }
});

// Get my mentorship requests (as mentee)
router.get('/my-requests', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT mr.*, m.title, u.name as mentor_name, u.avatar as mentor_avatar
       FROM mentorship_requests mr
       JOIN mentors m ON mr.mentor_id = m.id
       JOIN users u ON m.user_id = u.id
       WHERE mr.mentee_id = $1
       ORDER BY mr.created_at DESC`,
      [req.userId]
    );
    
    res.json({ requests: result.rows });
  } catch (error) {
    console.error('Get my requests error:', error);
    res.status(500).json({ detail: 'Failed to get requests' });
  }
});

// Get incoming requests (as mentor)
router.get('/incoming-requests', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT mr.*, u.name as mentee_name, u.avatar as mentee_avatar, up.job_title, up.company
       FROM mentorship_requests mr
       JOIN users u ON mr.mentee_id = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       JOIN mentors m ON mr.mentor_id = m.id
       WHERE m.user_id = $1 AND mr.status = 'pending'
       ORDER BY mr.created_at DESC`,
      [req.userId]
    );
    
    res.json({ requests: result.rows });
  } catch (error) {
    console.error('Get incoming requests error:', error);
    res.status(500).json({ detail: 'Failed to get requests' });
  }
});

// Accept mentorship request
router.put('/requests/:requestId/accept', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    
    await transaction(async (client) => {
      // Get request and verify ownership
      const request = await client.query(
        `SELECT mr.*, m.user_id as mentor_user_id
         FROM mentorship_requests mr
         JOIN mentors m ON mr.mentor_id = m.id
         WHERE mr.id = $1 AND mr.status = 'pending'`,
        [requestId]
      );
      
      if (request.rows.length === 0) {
        throw new Error('Request not found or already processed');
      }
      
      if (request.rows[0].mentor_user_id !== req.userId) {
        throw new Error('Not authorized');
      }
      
      // Update request
      await client.query(
        "UPDATE mentorship_requests SET status = 'accepted' WHERE id = $1",
        [requestId]
      );
      
      // Update mentor's mentee count
      await client.query(
        'UPDATE mentors SET mentees_count = mentees_count + 1 WHERE id = $1',
        [request.rows[0].mentor_id]
      );
      
      // Notify mentee
      await client.query(
        `INSERT INTO notifications (user_id, type, title, message, avatar, action_url)
         SELECT $1, 'mentorship_accepted', 'Mentorship Request Accepted', 
                name || ' accepted your mentorship request', 
                avatar, '/mentorship'
         FROM users WHERE id = $2`,
        [request.rows[0].mentee_id, req.userId]
      );
    });
    
    res.json({ message: 'Request accepted', success: true });
  } catch (error: any) {
    console.error('Accept request error:', error);
    res.status(400).json({ detail: error.message || 'Failed to accept request' });
  }
});

// Reject mentorship request
router.put('/requests/:requestId/reject', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    
    // Verify ownership
    const request = await query(
      `SELECT mr.* FROM mentorship_requests mr
       JOIN mentors m ON mr.mentor_id = m.id
       WHERE mr.id = $1 AND m.user_id = $2 AND mr.status = 'pending'`,
      [requestId, req.userId]
    );
    
    if (request.rows.length === 0) {
      res.status(404).json({ detail: 'Request not found or already processed' });
      return;
    }
    
    await query(
      "UPDATE mentorship_requests SET status = 'rejected' WHERE id = $1",
      [requestId]
    );
    
    res.json({ message: 'Request rejected', success: true });
  } catch (error) {
    console.error('Reject request error:', error);
    res.status(500).json({ detail: 'Failed to reject request' });
  }
});

export default router;

