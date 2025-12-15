import { Router, Response } from 'express';
import { query, transaction } from '../database/connection';
import { authenticate } from '../middleware/auth';
import { validate, schemas } from '../middleware/validation';
import { AuthenticatedRequest, Post, Comment } from '../types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Helper to format time
const formatTime = (date: Date): string => {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
};

// Get posts feed
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, page_size = 20, type, tag, search } = req.query;
    
    const conditions: string[] = ['p.is_active = true'];
    const values: any[] = [];
    let paramIndex = 1;
    
    // Filter by university for non-superadmins
    if (req.user?.role !== 'superadmin' && req.user?.university_id) {
      conditions.push(`p.university_id = $${paramIndex++}`);
      values.push(req.user.university_id);
    }
    
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
    
    // Get posts with author info and like status
    values.push(req.userId);
    values.push(Number(page_size), offset);
    
    const result = await query(
      `SELECT p.*, 
              u.name as author_name, u.avatar as author_avatar,
              up.job_title as author_title, up.company as author_company,
              EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND user_id = $${paramIndex}) as is_liked
       FROM posts p
       JOIN users u ON p.author_id = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}`,
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
      },
      type: p.type,
      content: p.content,
      media_url: p.media_url,
      video_url: p.video_url,
      thumbnail_url: p.thumbnail_url,
      tag: p.tag,
      job_title: p.job_title,
      company: p.company,
      location: p.location,
      likes_count: p.likes_count,
      comments_count: p.comments_count,
      shares_count: p.shares_count,
      is_liked: p.is_liked,
      time: formatTime(new Date(p.created_at)),
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

// Get single post
router.get('/:postId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId } = req.params;
    
    const result = await query(
      `SELECT p.*, 
              u.name as author_name, u.avatar as author_avatar,
              up.job_title as author_title, up.company as author_company,
              EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND user_id = $2) as is_liked
       FROM posts p
       JOIN users u ON p.author_id = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE p.id = $1 AND p.is_active = true`,
      [postId, req.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ detail: 'Post not found' });
      return;
    }
    
    const p = result.rows[0];
    
    res.json({
      id: p.id,
      author: {
        id: p.author_id,
        name: p.author_name,
        avatar: p.author_avatar,
        title: p.author_title,
        company: p.author_company,
      },
      type: p.type,
      content: p.content,
      media_url: p.media_url,
      video_url: p.video_url,
      thumbnail_url: p.thumbnail_url,
      tag: p.tag,
      job_title: p.job_title,
      company: p.company,
      location: p.location,
      likes_count: p.likes_count,
      comments_count: p.comments_count,
      shares_count: p.shares_count,
      is_liked: p.is_liked,
      time: formatTime(new Date(p.created_at)),
      created_at: p.created_at,
    });
  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({ detail: 'Failed to get post' });
  }
});

// Create post
router.post('/', authenticate, validate(schemas.createPost), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { type, content, media_url, video_url, thumbnail_url, tag, job_title, company, location } = req.body;
    
    const postId = uuidv4();
    
    await query(
      `INSERT INTO posts (id, author_id, university_id, type, content, media_url, video_url, thumbnail_url, tag, job_title, company, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [postId, req.userId, req.user?.university_id, type, content, media_url, video_url, thumbnail_url, tag, job_title, company, location]
    );
    
    // Get created post
    const result = await query(
      `SELECT p.*, 
              u.name as author_name, u.avatar as author_avatar,
              up.job_title as author_title, up.company as author_company
       FROM posts p
       JOIN users u ON p.author_id = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE p.id = $1`,
      [postId]
    );
    
    const p = result.rows[0];
    
    res.status(201).json({
      id: p.id,
      author: {
        id: p.author_id,
        name: p.author_name,
        avatar: p.author_avatar,
        title: p.author_title,
        company: p.author_company,
      },
      type: p.type,
      content: p.content,
      media_url: p.media_url,
      video_url: p.video_url,
      thumbnail_url: p.thumbnail_url,
      tag: p.tag,
      job_title: p.job_title,
      company: p.company,
      location: p.location,
      likes_count: 0,
      comments_count: 0,
      shares_count: 0,
      is_liked: false,
      time: 'Just now',
      created_at: p.created_at,
    });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ detail: 'Failed to create post' });
  }
});

// Update post
router.put('/:postId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId } = req.params;
    const { content, media_url, video_url, thumbnail_url, tag, job_title, company, location } = req.body;
    
    // Check ownership
    const existing = await query('SELECT author_id FROM posts WHERE id = $1', [postId]);
    if (existing.rows.length === 0) {
      res.status(404).json({ detail: 'Post not found' });
      return;
    }
    
    if (existing.rows[0].author_id !== req.userId && req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
      res.status(403).json({ detail: 'Not authorized to update this post' });
      return;
    }
    
    const result = await query(
      `UPDATE posts SET 
       content = COALESCE($1, content),
       media_url = $2,
       video_url = $3,
       thumbnail_url = $4,
       tag = $5,
       job_title = $6,
       company = $7,
       location = $8
       WHERE id = $9 RETURNING *`,
      [content, media_url, video_url, thumbnail_url, tag, job_title, company, location, postId]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update post error:', error);
    res.status(500).json({ detail: 'Failed to update post' });
  }
});

// Delete post
router.delete('/:postId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId } = req.params;
    
    // Check ownership
    const existing = await query('SELECT author_id FROM posts WHERE id = $1', [postId]);
    if (existing.rows.length === 0) {
      res.status(404).json({ detail: 'Post not found' });
      return;
    }
    
    if (existing.rows[0].author_id !== req.userId && req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
      res.status(403).json({ detail: 'Not authorized to delete this post' });
      return;
    }
    
    await query('UPDATE posts SET is_active = false WHERE id = $1', [postId]);
    
    res.json({ message: 'Post deleted', success: true });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ detail: 'Failed to delete post' });
  }
});

// Like post
router.post('/:postId/like', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId } = req.params;
    
    await transaction(async (client) => {
      // Check if already liked
      const existing = await client.query(
        'SELECT id FROM post_likes WHERE post_id = $1 AND user_id = $2',
        [postId, req.userId]
      );
      
      if (existing.rows.length > 0) {
        // Already liked
        return;
      }
      
      // Add like
      await client.query(
        'INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)',
        [postId, req.userId]
      );
      
      // Update count
      await client.query(
        'UPDATE posts SET likes_count = likes_count + 1 WHERE id = $1',
        [postId]
      );
    });
    
    res.json({ message: 'Post liked', success: true });
  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({ detail: 'Failed to like post' });
  }
});

// Unlike post
router.delete('/:postId/like', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId } = req.params;
    
    await transaction(async (client) => {
      // Delete like
      const result = await client.query(
        'DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2 RETURNING id',
        [postId, req.userId]
      );
      
      if (result.rows.length > 0) {
        // Update count
        await client.query(
          'UPDATE posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = $1',
          [postId]
        );
      }
    });
    
    res.json({ message: 'Post unliked', success: true });
  } catch (error) {
    console.error('Unlike post error:', error);
    res.status(500).json({ detail: 'Failed to unlike post' });
  }
});

// Get comments
router.get('/:postId/comments', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId } = req.params;
    const { page = 1, page_size = 20 } = req.query;
    
    const offset = (Number(page) - 1) * Number(page_size);
    
    // Get total count
    const countResult = await query(
      'SELECT COUNT(*) FROM comments WHERE post_id = $1',
      [postId]
    );
    const total = parseInt(countResult.rows[0].count);
    
    // Get comments
    const result = await query(
      `SELECT c.*, u.name as author_name, u.avatar as author_avatar,
              up.job_title as author_title, up.company as author_company
       FROM comments c
       JOIN users u ON c.author_id = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE c.post_id = $1
       ORDER BY c.created_at ASC
       LIMIT $2 OFFSET $3`,
      [postId, Number(page_size), offset]
    );
    
    const comments = result.rows.map((c: any) => ({
      id: c.id,
      author: {
        id: c.author_id,
        name: c.author_name,
        avatar: c.author_avatar,
        title: c.author_title,
        company: c.author_company,
      },
      content: c.content,
      created_at: c.created_at,
    }));
    
    res.json({ comments, total });
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ detail: 'Failed to get comments' });
  }
});

// Add comment
router.post('/:postId/comments', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId } = req.params;
    const { content } = req.body;
    
    if (!content || content.trim().length === 0) {
      res.status(400).json({ detail: 'Comment content is required' });
      return;
    }
    
    const commentId = uuidv4();
    
    await transaction(async (client) => {
      // Add comment
      await client.query(
        'INSERT INTO comments (id, post_id, author_id, content) VALUES ($1, $2, $3, $4)',
        [commentId, postId, req.userId, content]
      );
      
      // Update count
      await client.query(
        'UPDATE posts SET comments_count = comments_count + 1 WHERE id = $1',
        [postId]
      );
    });
    
    // Get created comment
    const result = await query(
      `SELECT c.*, u.name as author_name, u.avatar as author_avatar,
              up.job_title as author_title, up.company as author_company
       FROM comments c
       JOIN users u ON c.author_id = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE c.id = $1`,
      [commentId]
    );
    
    const c = result.rows[0];
    
    res.status(201).json({
      id: c.id,
      author: {
        id: c.author_id,
        name: c.author_name,
        avatar: c.author_avatar,
        title: c.author_title,
        company: c.author_company,
      },
      content: c.content,
      created_at: c.created_at,
    });
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ detail: 'Failed to add comment' });
  }
});

// Delete comment
router.delete('/:postId/comments/:commentId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId, commentId } = req.params;
    
    // Check ownership
    const existing = await query('SELECT author_id FROM comments WHERE id = $1', [commentId]);
    if (existing.rows.length === 0) {
      res.status(404).json({ detail: 'Comment not found' });
      return;
    }
    
    if (existing.rows[0].author_id !== req.userId && req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
      res.status(403).json({ detail: 'Not authorized to delete this comment' });
      return;
    }
    
    await transaction(async (client) => {
      // Delete comment
      await client.query('DELETE FROM comments WHERE id = $1', [commentId]);
      
      // Update count
      await client.query(
        'UPDATE posts SET comments_count = GREATEST(0, comments_count - 1) WHERE id = $1',
        [postId]
      );
    });
    
    res.json({ message: 'Comment deleted', success: true });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ detail: 'Failed to delete comment' });
  }
});

export default router;

