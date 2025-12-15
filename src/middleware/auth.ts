import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { query } from '../database/connection';
import { AuthenticatedRequest, User, JWTPayload } from '../types';

// Verify JWT and attach user to request
export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ detail: 'Authentication required' });
      return;
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;
    
    // Get user from database
    const result = await query<User>(
      'SELECT * FROM users WHERE id = $1 AND is_active = true',
      [decoded.userId]
    );
    
    if (result.rows.length === 0) {
      res.status(401).json({ detail: 'User not found or inactive' });
      return;
    }
    
    req.user = result.rows[0];
    req.userId = decoded.userId;
    
    next();
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError') {
      res.status(401).json({ detail: 'Invalid token' });
      return;
    }
    if (error.name === 'TokenExpiredError') {
      res.status(401).json({ detail: 'Token expired' });
      return;
    }
    console.error('Auth middleware error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
};

// Optional authentication - doesn't fail if no token
export const optionalAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next();
      return;
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;
      
      const result = await query<User>(
        'SELECT * FROM users WHERE id = $1 AND is_active = true',
        [decoded.userId]
      );
      
      if (result.rows.length > 0) {
        req.user = result.rows[0];
        req.userId = decoded.userId;
      }
    } catch {
      // Token invalid, but that's okay for optional auth
    }
    
    next();
  } catch (error) {
    next();
  }
};

// Check if user is admin
export const requireAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'superadmin')) {
    res.status(403).json({ detail: 'Admin access required' });
    return;
  }
  next();
};

// Check if user is superadmin
export const requireSuperAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user || req.user.role !== 'superadmin') {
    res.status(403).json({ detail: 'Super admin access required' });
    return;
  }
  next();
};

// Check if user belongs to the same university (for admin routes)
export const requireSameUniversity = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const targetUniversityId = req.params.universityId || req.body.university_id;
  
  // Superadmins can access all universities
  if (req.user?.role === 'superadmin') {
    next();
    return;
  }
  
  // Admins can only access their own university
  if (req.user?.role === 'admin' && targetUniversityId && req.user.university_id !== targetUniversityId) {
    res.status(403).json({ detail: 'Access denied to this university' });
    return;
  }
  
  next();
};

// Generate JWT token
export const generateToken = (user: User): string => {
  const payload: JWTPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    universityId: user.university_id,
  };
  
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as string | number,
  } as jwt.SignOptions);
};

