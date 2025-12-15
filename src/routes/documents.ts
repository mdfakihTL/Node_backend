import { Router, Response } from 'express';
import { query } from '../database/connection';
import { authenticate } from '../middleware/auth';
import { AuthenticatedRequest, DocumentRequest, GeneratedDocument } from '../types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get my document requests
router.get('/requests', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, page_size = 20, status } = req.query;
    
    const conditions: string[] = ['user_id = $1'];
    const values: any[] = [req.userId];
    let paramIndex = 2;
    
    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    
    const whereClause = conditions.join(' AND ');
    const offset = (Number(page) - 1) * Number(page_size);
    
    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM document_requests WHERE ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);
    
    // Get requests
    values.push(Number(page_size), offset);
    
    const result = await query(
      `SELECT * FROM document_requests
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      values
    );
    
    const requests = result.rows.map((r: any) => ({
      id: r.id,
      document_type: r.document_type,
      reason: r.reason,
      status: r.status,
      requested_at: r.created_at,
      estimated_completion: r.estimated_completion,
    }));
    
    res.json({
      requests,
      total,
      page: Number(page),
      page_size: Number(page_size),
    });
  } catch (error) {
    console.error('Get document requests error:', error);
    res.status(500).json({ detail: 'Failed to get document requests' });
  }
});

// Create document request
router.post('/requests', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { document_type, reason } = req.body;
    
    if (!document_type) {
      res.status(400).json({ detail: 'Document type is required' });
      return;
    }
    
    const requestId = uuidv4();
    
    // Estimate completion (5-10 business days)
    const estimatedCompletion = new Date();
    estimatedCompletion.setDate(estimatedCompletion.getDate() + Math.floor(Math.random() * 5) + 5);
    
    await query(
      `INSERT INTO document_requests (id, user_id, university_id, document_type, reason, estimated_completion)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [requestId, req.userId, req.user?.university_id, document_type, reason, estimatedCompletion]
    );
    
    const result = await query('SELECT * FROM document_requests WHERE id = $1', [requestId]);
    const r = result.rows[0];
    
    res.status(201).json({
      id: r.id,
      document_type: r.document_type,
      reason: r.reason,
      status: r.status,
      requested_at: r.created_at,
      estimated_completion: r.estimated_completion,
    });
  } catch (error) {
    console.error('Create document request error:', error);
    res.status(500).json({ detail: 'Failed to create document request' });
  }
});

// Get single request
router.get('/requests/:requestId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    
    const result = await query(
      'SELECT * FROM document_requests WHERE id = $1 AND user_id = $2',
      [requestId, req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Request not found' });
      return;
    }
    
    const r = result.rows[0];
    
    res.json({
      id: r.id,
      document_type: r.document_type,
      reason: r.reason,
      status: r.status,
      requested_at: r.created_at,
      estimated_completion: r.estimated_completion,
    });
  } catch (error) {
    console.error('Get document request error:', error);
    res.status(500).json({ detail: 'Failed to get document request' });
  }
});

// Cancel request
router.delete('/requests/:requestId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    
    const result = await query(
      "DELETE FROM document_requests WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id",
      [requestId, req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Request not found or cannot be cancelled' });
      return;
    }
    
    res.json({ message: 'Request cancelled', success: true });
  } catch (error) {
    console.error('Cancel request error:', error);
    res.status(500).json({ detail: 'Failed to cancel request' });
  }
});

// Get generated documents
router.get('/generated', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { doc_type } = req.query;
    
    const conditions: string[] = ['user_id = $1'];
    const values: any[] = [req.userId];
    let paramIndex = 2;
    
    if (doc_type) {
      conditions.push(`document_type = $${paramIndex++}`);
      values.push(doc_type);
    }
    
    const result = await query(
      `SELECT * FROM generated_documents
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC`,
      values
    );
    
    const documents = result.rows.map((d: any) => ({
      id: d.id,
      document_type: d.document_type,
      title: d.title,
      content: d.content,
      generated_at: d.created_at,
    }));
    
    res.json(documents);
  } catch (error) {
    console.error('Get generated documents error:', error);
    res.status(500).json({ detail: 'Failed to get documents' });
  }
});

// Generate document (AI)
router.post('/generated', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { document_type, target_role, company, experience, skills, additional_info } = req.body;
    
    if (!document_type) {
      res.status(400).json({ detail: 'Document type is required' });
      return;
    }
    
    // Generate a simple document (in production, this would use AI)
    const documentId = uuidv4();
    const title = `${document_type} - ${new Date().toLocaleDateString()}`;
    
    let content = '';
    
    if (document_type === 'resume') {
      content = `# ${req.user?.name}\n\n## Summary\nExperienced professional with background in ${experience || 'technology'}.\n\n## Skills\n${(skills || ['Communication', 'Leadership']).join(', ')}\n\n## Target Role\n${target_role || 'Various positions'} at ${company || 'leading companies'}`;
    } else if (document_type === 'cover_letter') {
      content = `Dear Hiring Manager,\n\nI am writing to express my interest in the ${target_role || 'position'} at ${company || 'your company'}.\n\n${additional_info || 'I believe my skills and experience make me a strong candidate.'}\n\nSincerely,\n${req.user?.name}`;
    } else {
      content = `Generated ${document_type} document for ${req.user?.name}\n\n${additional_info || 'This document was generated automatically.'}`;
    }
    
    await query(
      `INSERT INTO generated_documents (id, user_id, document_type, title, content, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [documentId, req.userId, document_type, title, content, JSON.stringify({ target_role, company, experience, skills })]
    );
    
    res.status(201).json({
      id: documentId,
      document_type,
      title,
      content,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Generate document error:', error);
    res.status(500).json({ detail: 'Failed to generate document' });
  }
});

// Get generated document
router.get('/generated/:documentId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { documentId } = req.params;
    
    const result = await query(
      'SELECT * FROM generated_documents WHERE id = $1 AND user_id = $2',
      [documentId, req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Document not found' });
      return;
    }
    
    const d = result.rows[0];
    
    res.json({
      id: d.id,
      document_type: d.document_type,
      title: d.title,
      content: d.content,
      generated_at: d.created_at,
    });
  } catch (error) {
    console.error('Get generated document error:', error);
    res.status(500).json({ detail: 'Failed to get document' });
  }
});

// Delete generated document
router.delete('/generated/:documentId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { documentId } = req.params;
    
    const result = await query(
      'DELETE FROM generated_documents WHERE id = $1 AND user_id = $2 RETURNING id',
      [documentId, req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Document not found' });
      return;
    }
    
    res.json({ message: 'Document deleted', success: true });
  } catch (error) {
    console.error('Delete generated document error:', error);
    res.status(500).json({ detail: 'Failed to delete document' });
  }
});

export default router;

