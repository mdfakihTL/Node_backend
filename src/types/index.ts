import { Request } from 'express';

// User types
export interface User {
  id: string;
  email: string;
  password_hash?: string;
  name: string;
  avatar?: string;
  university_id?: string;
  graduation_year?: number;
  major?: string;
  role: 'alumni' | 'admin' | 'superadmin';
  is_mentor: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UserProfile {
  id: string;
  user_id: string;
  bio?: string;
  phone?: string;
  location?: string;
  job_title?: string;
  company?: string;
  linkedin?: string;
  website?: string;
  banner?: string;
  experience?: string;
  education?: string;
  skills?: string[];
  created_at: Date;
  updated_at: Date;
}

export interface UserWithProfile extends User {
  profile?: UserProfile;
  university_name?: string;
}

// University types
export interface University {
  id: string;
  name: string;
  logo?: string;
  colors?: {
    light: { primary: string; secondary: string; accent: string };
    dark: { primary: string; secondary: string; accent: string };
  };
  is_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

// Post types
export interface Post {
  id: string;
  author_id: string;
  university_id: string;
  type: 'text' | 'image' | 'video' | 'job' | 'announcement';
  content: string;
  media_url?: string;
  video_url?: string;
  thumbnail_url?: string;
  tag?: string;
  job_title?: string;
  company?: string;
  location?: string;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: Date;
  updated_at: Date;
}

// Event types
export interface Event {
  id: string;
  university_id: string;
  created_by?: string;
  title: string;
  description?: string;
  image?: string;
  event_date: Date;
  event_time?: string;
  location?: string;
  is_virtual: boolean;
  meeting_link?: string;
  category?: string;
  max_attendees?: number;
  attendees_count: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// Group types
export interface Group {
  id: string;
  university_id: string;
  created_by?: string;
  name: string;
  description?: string;
  avatar?: string;
  category?: string;
  is_private: boolean;
  members_count: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface GroupMessage {
  id: string;
  group_id: string;
  sender_id: string;
  content: string;
  created_at: Date;
}

// Connection types
export interface Connection {
  id: string;
  user_id: string;
  connected_user_id: string;
  connected_at: Date;
}

export interface ConnectionRequest {
  id: string;
  from_user_id: string;
  to_user_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: Date;
  updated_at: Date;
}

// Message types
export interface Conversation {
  id: string;
  participant1_id: string;
  participant2_id: string;
  last_message_at: Date;
  created_at: Date;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  is_read: boolean;
  created_at: Date;
}

// Support types
export interface SupportTicket {
  id: string;
  user_id: string;
  university_id: string;
  subject: string;
  category: string;
  priority: 'low' | 'medium' | 'high';
  description: string;
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  admin_notes?: string;
  created_at: Date;
  updated_at: Date;
}

export interface TicketResponse {
  id: string;
  ticket_id: string;
  user_id: string;
  message: string;
  is_admin: boolean;
  created_at: Date;
}

// Notification types
export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  avatar?: string;
  is_read: boolean;
  action_url?: string;
  related_id?: string;
  created_at: Date;
}

// Document types
export interface DocumentRequest {
  id: string;
  user_id: string;
  university_id: string;
  document_type: string;
  reason?: string;
  status: 'pending' | 'processing' | 'completed' | 'rejected';
  estimated_completion?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface GeneratedDocument {
  id: string;
  user_id: string;
  document_type: string;
  title: string;
  content?: string;
  metadata?: Record<string, any>;
  created_at: Date;
}

// Mentor types
export interface Mentor {
  id: string;
  user_id: string;
  title?: string;
  company?: string;
  location?: string;
  bio?: string;
  expertise: string[];
  availability: string;
  years_experience: number;
  mentees_count: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface MentorshipRequest {
  id: string;
  mentor_id: string;
  mentee_id: string;
  message?: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: Date;
  updated_at: Date;
}

// Fundraiser types
export interface Fundraiser {
  id: string;
  university_id: string;
  title: string;
  description?: string;
  image?: string;
  goal_amount: number;
  current_amount: number;
  donation_link?: string;
  start_date: Date;
  end_date: Date;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// Ad types
export interface Ad {
  id: string;
  university_id?: string;
  title: string;
  description?: string;
  image?: string;
  link?: string;
  placement: string;
  is_active: boolean;
  is_global: boolean;
  created_at: Date;
  updated_at: Date;
}

// Express extended request type
export interface AuthenticatedRequest extends Request {
  user?: User;
  userId?: string;
}

// JWT Payload
export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  universityId?: string;
}

// Pagination
export interface PaginationParams {
  page?: number;
  page_size?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

