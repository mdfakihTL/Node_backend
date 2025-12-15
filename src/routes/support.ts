import { Router, Response } from 'express';
import { query } from '../database/connection';
import { authenticate } from '../middleware/auth';
import { validate, schemas } from '../middleware/validation';
import { AuthenticatedRequest, SupportTicket, TicketResponse } from '../types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get all tickets for current user
router.get('/tickets', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, page_size = 20, status } = req.query;
    
    const conditions: string[] = ['t.user_id = $1'];
    const values: any[] = [req.userId];
    let paramIndex = 2;
    
    if (status) {
      conditions.push(`t.status = $${paramIndex++}`);
      values.push(status);
    }
    
    const whereClause = conditions.join(' AND ');
    const offset = (Number(page) - 1) * Number(page_size);
    
    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM support_tickets t WHERE ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);
    
    // Get tickets with responses
    values.push(Number(page_size), offset);
    
    const result = await query(
      `SELECT t.*,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', tr.id,
                  'message', tr.message,
                  'responder_name', CASE WHEN tr.is_admin THEN 'Admin' ELSE u.name END,
                  'is_admin', tr.is_admin,
                  'created_at', tr.created_at
                ) ORDER BY tr.created_at)
                FROM ticket_responses tr
                LEFT JOIN users u ON tr.user_id = u.id
                WHERE tr.ticket_id = t.id),
                '[]'
              ) as responses
       FROM support_tickets t
       WHERE ${whereClause}
       ORDER BY t.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      values
    );
    
    const tickets = result.rows.map((t: any) => ({
      id: t.id,
      subject: t.subject,
      category: t.category,
      priority: t.priority,
      description: t.description,
      status: t.status,
      created_at: t.created_at,
      updated_at: t.updated_at,
      responses: t.responses || [],
    }));
    
    res.json({
      tickets,
      total,
      page: Number(page),
      page_size: Number(page_size),
    });
  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({ detail: 'Failed to get tickets' });
  }
});

// Get single ticket
router.get('/tickets/:ticketId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { ticketId } = req.params;
    
    const result = await query(
      `SELECT t.*
       FROM support_tickets t
       WHERE t.id = $1 AND t.user_id = $2`,
      [ticketId, req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Ticket not found' });
      return;
    }
    
    // Get responses
    const responsesResult = await query(
      `SELECT tr.*, 
              CASE WHEN tr.is_admin THEN 'Admin' ELSE u.name END as responder_name
       FROM ticket_responses tr
       LEFT JOIN users u ON tr.user_id = u.id
       WHERE tr.ticket_id = $1
       ORDER BY tr.created_at ASC`,
      [ticketId]
    );
    
    const ticket = result.rows[0];
    
    res.json({
      id: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      description: ticket.description,
      status: ticket.status,
      created_at: ticket.created_at,
      updated_at: ticket.updated_at,
      responses: responsesResult.rows.map((r: any) => ({
        id: r.id,
        message: r.message,
        responder_name: r.responder_name,
        is_admin: r.is_admin,
        created_at: r.created_at,
      })),
    });
  } catch (error) {
    console.error('Get ticket error:', error);
    res.status(500).json({ detail: 'Failed to get ticket' });
  }
});

// Create ticket
router.post('/tickets', authenticate, validate(schemas.createTicket), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { subject, category, priority, description } = req.body;
    
    const ticketId = uuidv4();
    
    await query(
      `INSERT INTO support_tickets (id, user_id, university_id, subject, category, priority, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')`,
      [ticketId, req.userId, req.user?.university_id, subject, category, priority || 'medium', description]
    );
    
    const result = await query('SELECT * FROM support_tickets WHERE id = $1', [ticketId]);
    const ticket = result.rows[0];
    
    res.status(201).json({
      id: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      description: ticket.description,
      status: ticket.status,
      created_at: ticket.created_at,
      updated_at: ticket.updated_at,
      responses: [],
    });
  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(500).json({ detail: 'Failed to create ticket' });
  }
});

// Add response to ticket
router.post('/tickets/:ticketId/respond', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { ticketId } = req.params;
    const { message } = req.body;
    
    if (!message || message.trim().length === 0) {
      res.status(400).json({ detail: 'Message is required' });
      return;
    }
    
    // Check ticket ownership
    const ticket = await query(
      'SELECT user_id FROM support_tickets WHERE id = $1',
      [ticketId]
    );
    
    if (ticket.rows.length === 0) {
      res.status(404).json({ detail: 'Ticket not found' });
      return;
    }
    
    if (ticket.rows[0].user_id !== req.userId) {
      res.status(403).json({ detail: 'Not authorized to respond to this ticket' });
      return;
    }
    
    const responseId = uuidv4();
    
    await query(
      'INSERT INTO ticket_responses (id, ticket_id, user_id, message, is_admin) VALUES ($1, $2, $3, $4, false)',
      [responseId, ticketId, req.userId, message]
    );
    
    // Update ticket status if closed
    await query(
      "UPDATE support_tickets SET status = CASE WHEN status = 'closed' THEN 'open' ELSE status END WHERE id = $1",
      [ticketId]
    );
    
    res.json({ message: 'Response added', success: true });
  } catch (error) {
    console.error('Add response error:', error);
    res.status(500).json({ detail: 'Failed to add response' });
  }
});

// Close ticket
router.put('/tickets/:ticketId/close', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { ticketId } = req.params;
    
    const result = await query(
      "UPDATE support_tickets SET status = 'closed' WHERE id = $1 AND user_id = $2 RETURNING id",
      [ticketId, req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Ticket not found' });
      return;
    }
    
    res.json({ message: 'Ticket closed', success: true });
  } catch (error) {
    console.error('Close ticket error:', error);
    res.status(500).json({ detail: 'Failed to close ticket' });
  }
});

export default router;

