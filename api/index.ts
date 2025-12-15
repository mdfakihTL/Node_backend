import app from '../src/app';
import { initPool } from '../src/database/connection';

// Initialize database pool for serverless
let isPoolInitialized = false;

const initializePool = async () => {
  if (!isPoolInitialized) {
    try {
      await initPool();
      isPoolInitialized = true;
    } catch (error) {
      console.error('Failed to initialize database pool:', error);
      throw error;
    }
  }
};

// Middleware to ensure pool is initialized
app.use(async (req, res, next) => {
  try {
    await initializePool();
    next();
  } catch (error) {
    res.status(500).json({ detail: 'Database connection failed' });
  }
});

export default app;

