import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';

// Generic validation middleware factory
export const validate = <T>(schema: ZodSchema<T>) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessages = error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        res.status(400).json({
          detail: 'Validation failed',
          errors: errorMessages,
        });
        return;
      }
      res.status(400).json({ detail: 'Invalid request data' });
    }
  };
};

// Query params validation
export const validateQuery = <T>(schema: ZodSchema<T>) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query) as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessages = error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        res.status(400).json({
          detail: 'Invalid query parameters',
          errors: errorMessages,
        });
        return;
      }
      res.status(400).json({ detail: 'Invalid query parameters' });
    }
  };
};

// Params validation
export const validateParams = <T>(schema: ZodSchema<T>) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.params = schema.parse(req.params) as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          detail: 'Invalid URL parameters',
        });
        return;
      }
      res.status(400).json({ detail: 'Invalid URL parameters' });
    }
  };
};

// Common validation schemas
export const schemas = {
  // UUID validation
  uuid: z.string().uuid(),
  
  // Email validation
  email: z.string().email(),
  
  // Pagination
  pagination: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    page_size: z.coerce.number().int().min(1).max(100).optional().default(20),
  }),
  
  // Auth schemas
  login: z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password is required'),
  }),
  
  register: z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    name: z.string().min(1, 'Name is required'),
    university_id: z.string().optional(),
    graduation_year: z.number().int().min(1900).max(2100).optional(),
    major: z.string().optional(),
  }),
  
  // Post schemas
  createPost: z.object({
    type: z.enum(['text', 'image', 'video', 'job', 'announcement']).optional().default('text'),
    content: z.string().min(1, 'Content is required'),
    media_url: z.string().url().optional(),
    video_url: z.string().url().optional(),
    thumbnail_url: z.string().url().optional(),
    tag: z.string().optional(),
    job_title: z.string().optional(),
    company: z.string().optional(),
    location: z.string().optional(),
  }),
  
  updatePost: z.object({
    content: z.string().min(1).optional(),
    media_url: z.string().url().optional().nullable(),
    video_url: z.string().url().optional().nullable(),
    thumbnail_url: z.string().url().optional().nullable(),
    tag: z.string().optional().nullable(),
    job_title: z.string().optional().nullable(),
    company: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
  }),
  
  // Event schemas
  createEvent: z.object({
    title: z.string().min(1, 'Title is required'),
    description: z.string().optional(),
    image: z.string().url().optional(),
    event_date: z.string(),
    event_time: z.string().optional(),
    location: z.string().optional(),
    is_virtual: z.boolean().optional().default(false),
    meeting_link: z.string().url().optional(),
    category: z.string().optional(),
    max_attendees: z.number().int().positive().optional(),
  }),
  
  // Group schemas
  createGroup: z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    category: z.string().optional(),
    is_private: z.boolean().optional().default(false),
    avatar: z.string().url().optional(),
  }),
  
  // Support ticket schemas
  createTicket: z.object({
    subject: z.string().min(1, 'Subject is required'),
    category: z.string().min(1, 'Category is required'),
    priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
    description: z.string().min(1, 'Description is required'),
  }),
  
  // Profile update schemas
  updateUser: z.object({
    name: z.string().min(1).optional(),
    avatar: z.string().url().optional(),
    graduation_year: z.number().int().min(1900).max(2100).optional(),
    major: z.string().optional(),
    is_mentor: z.boolean().optional(),
  }),
  
  updateProfile: z.object({
    bio: z.string().optional(),
    phone: z.string().optional(),
    location: z.string().optional(),
    job_title: z.string().optional(),
    company: z.string().optional(),
    linkedin: z.string().url().optional(),
    website: z.string().url().optional(),
    banner: z.string().url().optional(),
    experience: z.string().optional(),
    education: z.string().optional(),
  }),
};

