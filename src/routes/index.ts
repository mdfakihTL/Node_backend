import { Router } from 'express';

import authRoutes from './auth';
import userRoutes from './users';
import postRoutes from './posts';
import eventRoutes from './events';
import groupRoutes from './groups';
import connectionRoutes from './connections';
import messageRoutes from './messages';
import supportRoutes from './support';
import notificationRoutes from './notifications';
import mentorRoutes from './mentors';
import documentRoutes from './documents';
import universityRoutes from './universities';
import adminRoutes from './admin';
import superadminRoutes from './superadmin';

const router = Router();

// Mount routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/posts', postRoutes);
router.use('/events', eventRoutes);
router.use('/groups', groupRoutes);
router.use('/connections', connectionRoutes);
router.use('/messages', messageRoutes);
router.use('/support', supportRoutes);
router.use('/notifications', notificationRoutes);
router.use('/mentors', mentorRoutes);
router.use('/documents', documentRoutes);
router.use('/universities', universityRoutes);
router.use('/admin', adminRoutes);
router.use('/superadmin', superadminRoutes);

export default router;

