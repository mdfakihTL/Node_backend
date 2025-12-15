import { Router, Response } from 'express';
import { query, transaction } from '../database/connection';
import { authenticate, requireAdmin } from '../middleware/auth';
import { validate, schemas } from '../middleware/validation';
import { AuthenticatedRequest, Event } from '../types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get all events
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, page_size = 20, category, is_virtual, registered_only } = req.query;
    
    const conditions: string[] = ['e.is_active = true'];
    const values: any[] = [];
    let paramIndex = 1;
    
    // Filter by university
    if (req.user?.university_id) {
      conditions.push(`e.university_id = $${paramIndex++}`);
      values.push(req.user.university_id);
    }
    
    if (category) {
      conditions.push(`e.category = $${paramIndex++}`);
      values.push(category);
    }
    
    if (is_virtual !== undefined) {
      conditions.push(`e.is_virtual = $${paramIndex++}`);
      values.push(is_virtual === 'true');
    }
    
    if (registered_only === 'true') {
      conditions.push(`EXISTS(SELECT 1 FROM event_registrations WHERE event_id = e.id AND user_id = $${paramIndex++})`);
      values.push(req.userId);
    }
    
    const whereClause = conditions.join(' AND ');
    const offset = (Number(page) - 1) * Number(page_size);
    
    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM events e WHERE ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);
    
    // Get events
    values.push(req.userId);
    values.push(Number(page_size), offset);
    
    const result = await query(
      `SELECT e.*, 
              u.name as organizer_name,
              EXISTS(SELECT 1 FROM event_registrations WHERE event_id = e.id AND user_id = $${paramIndex}) as is_registered
       FROM events e
       LEFT JOIN users u ON e.created_by = u.id
       WHERE ${whereClause}
       ORDER BY e.event_date ASC, e.event_time ASC
       LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}`,
      values
    );
    
    const events = result.rows.map((e: any) => ({
      id: e.id,
      title: e.title,
      date: e.event_date,
      time: e.event_time,
      location: e.location,
      attendees: e.attendees_count,
      image: e.image,
      description: e.description,
      is_virtual: e.is_virtual,
      meeting_link: e.meeting_link,
      organizer: e.organizer_name || 'University Admin',
      category: e.category,
      is_registered: e.is_registered,
      created_at: e.created_at,
    }));
    
    res.json({
      events,
      total,
      page: Number(page),
      page_size: Number(page_size),
    });
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ detail: 'Failed to get events' });
  }
});

// Get my events (registered)
router.get('/my-events', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT e.*, 
              u.name as organizer_name,
              true as is_registered
       FROM events e
       JOIN event_registrations er ON e.id = er.event_id
       LEFT JOIN users u ON e.created_by = u.id
       WHERE er.user_id = $1 AND e.is_active = true
       ORDER BY e.event_date ASC`,
      [req.userId]
    );
    
    const events = result.rows.map((e: any) => ({
      id: e.id,
      title: e.title,
      date: e.event_date,
      time: e.event_time,
      location: e.location,
      attendees: e.attendees_count,
      image: e.image,
      description: e.description,
      is_virtual: e.is_virtual,
      meeting_link: e.meeting_link,
      organizer: e.organizer_name || 'University Admin',
      category: e.category,
      is_registered: true,
      created_at: e.created_at,
    }));
    
    res.json({
      events,
      total: events.length,
      page: 1,
      page_size: events.length,
    });
  } catch (error) {
    console.error('Get my events error:', error);
    res.status(500).json({ detail: 'Failed to get events' });
  }
});

// Get single event
router.get('/:eventId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { eventId } = req.params;
    
    const result = await query(
      `SELECT e.*, 
              u.name as organizer_name,
              EXISTS(SELECT 1 FROM event_registrations WHERE event_id = e.id AND user_id = $2) as is_registered
       FROM events e
       LEFT JOIN users u ON e.created_by = u.id
       WHERE e.id = $1 AND e.is_active = true`,
      [eventId, req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Event not found' });
      return;
    }
    
    const e = result.rows[0];
    
    res.json({
      id: e.id,
      title: e.title,
      date: e.event_date,
      time: e.event_time,
      location: e.location,
      attendees: e.attendees_count,
      image: e.image,
      description: e.description,
      is_virtual: e.is_virtual,
      meeting_link: e.meeting_link,
      organizer: e.organizer_name || 'University Admin',
      category: e.category,
      is_registered: e.is_registered,
      created_at: e.created_at,
    });
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ detail: 'Failed to get event' });
  }
});

// Create event (admin only)
router.post('/', authenticate, requireAdmin, validate(schemas.createEvent), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, description, image, event_date, event_time, location, is_virtual, meeting_link, category, max_attendees } = req.body;
    
    const eventId = uuidv4();
    
    await query(
      `INSERT INTO events (id, university_id, created_by, title, description, image, event_date, event_time, location, is_virtual, meeting_link, category, max_attendees)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [eventId, req.user?.university_id, req.userId, title, description, image, event_date, event_time, location, is_virtual || false, meeting_link, category, max_attendees]
    );
    
    const result = await query(
      `SELECT e.*, u.name as organizer_name
       FROM events e
       LEFT JOIN users u ON e.created_by = u.id
       WHERE e.id = $1`,
      [eventId]
    );
    
    const e = result.rows[0];
    
    res.status(201).json({
      id: e.id,
      title: e.title,
      date: e.event_date,
      time: e.event_time,
      location: e.location,
      attendees: 0,
      image: e.image,
      description: e.description,
      is_virtual: e.is_virtual,
      meeting_link: e.meeting_link,
      organizer: e.organizer_name,
      category: e.category,
      is_registered: false,
      created_at: e.created_at,
    });
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ detail: 'Failed to create event' });
  }
});

// Update event (admin only)
router.put('/:eventId', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { eventId } = req.params;
    const { title, description, image, event_date, event_time, location, is_virtual, meeting_link, category, max_attendees } = req.body;
    
    const result = await query(
      `UPDATE events SET 
       title = COALESCE($1, title),
       description = COALESCE($2, description),
       image = COALESCE($3, image),
       event_date = COALESCE($4, event_date),
       event_time = COALESCE($5, event_time),
       location = COALESCE($6, location),
       is_virtual = COALESCE($7, is_virtual),
       meeting_link = COALESCE($8, meeting_link),
       category = COALESCE($9, category),
       max_attendees = COALESCE($10, max_attendees)
       WHERE id = $11 AND university_id = $12 RETURNING *`,
      [title, description, image, event_date, event_time, location, is_virtual, meeting_link, category, max_attendees, eventId, req.user?.university_id]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Event not found' });
      return;
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ detail: 'Failed to update event' });
  }
});

// Delete event (admin only)
router.delete('/:eventId', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { eventId } = req.params;
    
    const result = await query(
      'UPDATE events SET is_active = false WHERE id = $1 AND university_id = $2 RETURNING id',
      [eventId, req.user?.university_id]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Event not found' });
      return;
    }
    
    res.json({ message: 'Event deleted', success: true });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({ detail: 'Failed to delete event' });
  }
});

// Register for event
router.post('/:eventId/register', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { eventId } = req.params;
    
    await transaction(async (client) => {
      // Check if event exists and has capacity
      const event = await client.query(
        'SELECT max_attendees, attendees_count FROM events WHERE id = $1 AND is_active = true',
        [eventId]
      );
      
      if (event.rows.length === 0) {
        throw new Error('Event not found');
      }
      
      if (event.rows[0].max_attendees && event.rows[0].attendees_count >= event.rows[0].max_attendees) {
        throw new Error('Event is at full capacity');
      }
      
      // Check if already registered
      const existing = await client.query(
        'SELECT id FROM event_registrations WHERE event_id = $1 AND user_id = $2',
        [eventId, req.userId]
      );
      
      if (existing.rows.length > 0) {
        throw new Error('Already registered');
      }
      
      // Register
      await client.query(
        'INSERT INTO event_registrations (event_id, user_id) VALUES ($1, $2)',
        [eventId, req.userId]
      );
      
      // Update count
      await client.query(
        'UPDATE events SET attendees_count = attendees_count + 1 WHERE id = $1',
        [eventId]
      );
    });
    
    res.json({ message: 'Registered for event', success: true });
  } catch (error: any) {
    console.error('Register for event error:', error);
    res.status(400).json({ detail: error.message || 'Failed to register for event' });
  }
});

// Unregister from event
router.delete('/:eventId/register', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { eventId } = req.params;
    
    await transaction(async (client) => {
      const result = await client.query(
        'DELETE FROM event_registrations WHERE event_id = $1 AND user_id = $2 RETURNING id',
        [eventId, req.userId]
      );
      
      if (result.rows.length > 0) {
        await client.query(
          'UPDATE events SET attendees_count = GREATEST(0, attendees_count - 1) WHERE id = $1',
          [eventId]
        );
      }
    });
    
    res.json({ message: 'Unregistered from event', success: true });
  } catch (error) {
    console.error('Unregister from event error:', error);
    res.status(500).json({ detail: 'Failed to unregister from event' });
  }
});

export default router;

