import { pool } from './connection';
import fs from 'fs';
import path from 'path';

async function initDatabase() {
  console.log('🔧 Initializing database...');
  
  try {
    // Read and execute schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Split by semicolons and execute each statement
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    for (const statement of statements) {
      try {
        await pool.query(statement);
      } catch (error: any) {
        // Ignore errors for existing objects
        if (!error.message.includes('already exists')) {
          console.error('Error executing:', statement.substring(0, 50), error.message);
        }
      }
    }
    
    console.log('✅ Database schema initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

initDatabase().catch(console.error);

