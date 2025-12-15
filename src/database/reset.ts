import { pool } from './connection';

async function resetDatabase() {
  console.log('🔄 Resetting database...');
  
  try {
    // Drop all tables in reverse order of dependencies
    const tables = [
      'session_tokens',
      'ticket_responses',
      'support_tickets',
      'notifications',
      'generated_documents',
      'document_requests',
      'mentorship_requests',
      'mentors',
      'ads',
      'fundraisers',
      'messages',
      'conversations',
      'connection_requests',
      'connections',
      'group_messages',
      'group_members',
      'groups',
      'event_registrations',
      'events',
      'comments',
      'post_likes',
      'posts',
      'password_reset_requests',
      'user_profiles',
      'users',
      'universities'
    ];
    
    for (const table of tables) {
      await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
      console.log(`Dropped table: ${table}`);
    }
    
    // Drop function
    await pool.query('DROP FUNCTION IF EXISTS update_updated_at_column CASCADE');
    
    console.log('✅ All tables dropped');
    console.log('💡 Run npm run db:init to recreate schema');
    console.log('💡 Run npm run db:seed to add sample data');
    
  } catch (error) {
    console.error('❌ Error resetting database:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

resetDatabase().catch(console.error);

