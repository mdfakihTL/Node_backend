import bcrypt from 'bcryptjs';
import { pool } from './connection';
import { v4 as uuidv4 } from 'uuid';

async function seedDatabase() {
  console.log('🌱 Seeding database...');
  
  try {
    // Create Universities
    const universities = [
      {
        id: 'mit',
        name: 'Massachusetts Institute of Technology',
        logo: 'https://images.unsplash.com/photo-1564981797816-1043664bf78d?w=200&h=200&fit=crop',
        colors: {
          light: { primary: '#A31F34', secondary: '#8A8B8C', accent: '#750014' },
          dark: { primary: '#D31F3A', secondary: '#A0A1A2', accent: '#FF4458' }
        }
      },
      {
        id: 'stanford',
        name: 'Stanford University',
        logo: 'https://images.unsplash.com/photo-1607237138185-eedd9c632b0b?w=200&h=200&fit=crop',
        colors: {
          light: { primary: '#B1810B', secondary: '#2E2D29', accent: '#E6A82D' },
          dark: { primary: '#FFD700', secondary: '#5F574F', accent: '#FFA500' }
        }
      }
    ];
    
    for (const uni of universities) {
      await pool.query(`
        INSERT INTO universities (id, name, logo, colors, is_enabled)
        VALUES ($1, $2, $3, $4, true)
        ON CONFLICT (id) DO UPDATE SET name = $2, logo = $3, colors = $4
      `, [uni.id, uni.name, uni.logo, JSON.stringify(uni.colors)]);
    }
    console.log('✅ Universities seeded');

    // Create password hash
    const passwordHash = await bcrypt.hash('password123', 10);
    const mitHash = await bcrypt.hash('mit123', 10);
    const stanfordHash = await bcrypt.hash('stanford123', 10);
    const superHash = await bcrypt.hash('super123', 10);

    // Create Super Admin
    const superAdminId = uuidv4();
    await pool.query(`
      INSERT INTO users (id, email, password_hash, name, role, is_active)
      VALUES ($1, 'superadmin@alumnihub.com', $2, 'System Administrator', 'superadmin', true)
      ON CONFLICT (email) DO UPDATE SET password_hash = $2
    `, [superAdminId, superHash]);
    console.log('✅ Super Admin created');

    // Create MIT Admin
    const mitAdminId = uuidv4();
    await pool.query(`
      INSERT INTO users (id, email, password_hash, name, university_id, role, is_active)
      VALUES ($1, 'admin@mit.edu', $2, 'MIT Administrator', 'mit', 'admin', true)
      ON CONFLICT (email) DO UPDATE SET password_hash = $2
    `, [mitAdminId, mitHash]);
    console.log('✅ MIT Admin created');

    // Create Stanford Admin
    const stanfordAdminId = uuidv4();
    await pool.query(`
      INSERT INTO users (id, email, password_hash, name, university_id, role, is_active)
      VALUES ($1, 'admin@stanford.edu', $2, 'Stanford Administrator', 'stanford', 'admin', true)
      ON CONFLICT (email) DO UPDATE SET password_hash = $2
    `, [stanfordAdminId, stanfordHash]);
    console.log('✅ Stanford Admin created');

    // Create MIT Alumni
    const mitAlumni = [
      { email: 'john.doe@mit.edu', name: 'John Doe', year: 2020, major: 'Computer Science', isMentor: true },
      { email: 'sarah.chen@mit.edu', name: 'Sarah Chen', year: 2019, major: 'Electrical Engineering', isMentor: false },
      { email: 'mike.wilson@mit.edu', name: 'Mike Wilson', year: 2021, major: 'Mechanical Engineering', isMentor: false },
    ];

    for (const alumni of mitAlumni) {
      const userId = uuidv4();
      const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${alumni.name.replace(' ', '')}`;
      
      await pool.query(`
        INSERT INTO users (id, email, password_hash, name, avatar, university_id, graduation_year, major, role, is_mentor, is_active, first_login, is_profile_complete)
        VALUES ($1, $2, $3, $4, $5, 'mit', $6, $7, 'alumni', $8, true, false, true)
        ON CONFLICT (email) DO UPDATE SET password_hash = $3, name = $4, graduation_year = $6, major = $7, is_mentor = $8, first_login = false, is_profile_complete = true
      `, [userId, alumni.email, mitHash, alumni.name, avatar, alumni.year, alumni.major, alumni.isMentor]);

      // Create profile
      await pool.query(`
        INSERT INTO user_profiles (user_id, bio, job_title, company, location)
        VALUES ($1, 'Passionate alumni making an impact in the tech industry.', 'Software Engineer', 'Tech Company', 'Boston, MA')
        ON CONFLICT (user_id) DO NOTHING
      `, [userId]);

      // Create mentor profile if mentor
      if (alumni.isMentor) {
        await pool.query(`
          INSERT INTO mentors (user_id, title, company, location, bio, expertise, availability, years_experience, is_active)
          VALUES ($1, 'Senior Software Engineer', 'Tech Company', 'Boston, MA', 'Experienced engineer passionate about mentoring.', 
                  ARRAY['Software Development', 'Career Guidance', 'Technical Interviews'], 'Weekends', 5, true)
          ON CONFLICT (user_id) DO NOTHING
        `, [userId]);
      }
    }
    console.log('✅ MIT Alumni created');

    // Create Stanford Alumni
    const stanfordAlumni = [
      { email: 'michael.smith@stanford.edu', name: 'Michael Smith', year: 2021, major: 'Business Administration', isMentor: true },
      { email: 'emily.johnson@stanford.edu', name: 'Emily Johnson', year: 2018, major: 'Data Science', isMentor: false },
      { email: 'david.brown@stanford.edu', name: 'David Brown', year: 2020, major: 'Economics', isMentor: false },
    ];

    for (const alumni of stanfordAlumni) {
      const userId = uuidv4();
      const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${alumni.name.replace(' ', '')}`;
      
      await pool.query(`
        INSERT INTO users (id, email, password_hash, name, avatar, university_id, graduation_year, major, role, is_mentor, is_active, first_login, is_profile_complete)
        VALUES ($1, $2, $3, $4, $5, 'stanford', $6, $7, 'alumni', $8, true, false, true)
        ON CONFLICT (email) DO UPDATE SET password_hash = $3, name = $4, graduation_year = $6, major = $7, is_mentor = $8, first_login = false, is_profile_complete = true
      `, [userId, alumni.email, stanfordHash, alumni.name, avatar, alumni.year, alumni.major, alumni.isMentor]);

      // Create profile
      await pool.query(`
        INSERT INTO user_profiles (user_id, bio, job_title, company, location)
        VALUES ($1, 'Stanford alumnus driving innovation in business and technology.', 'Product Manager', 'Innovation Corp', 'Palo Alto, CA')
        ON CONFLICT (user_id) DO NOTHING
      `, [userId]);

      // Create mentor profile if mentor
      if (alumni.isMentor) {
        await pool.query(`
          INSERT INTO mentors (user_id, title, company, location, bio, expertise, availability, years_experience, is_active)
          VALUES ($1, 'Product Manager', 'Innovation Corp', 'Palo Alto, CA', 'Experienced PM helping others navigate their careers.', 
                  ARRAY['Product Management', 'Business Strategy', 'Startup Advice'], 'Evenings', 4, true)
          ON CONFLICT (user_id) DO NOTHING
        `, [userId]);
      }
    }
    console.log('✅ Stanford Alumni created');

    // Create sample posts
    const users = await pool.query(`SELECT id, name, university_id FROM users WHERE role = 'alumni' LIMIT 6`);
    
    const samplePosts = [
      { type: 'text', content: "After 5 years of hard work, I'm thrilled to announce that I've been promoted to VP of Engineering at TechCorp! 🚀", tag: 'career-milestone' },
      { type: 'image', content: "Incredibly proud to share that our startup just raised $10M in Series A funding! 🎉", media_url: 'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=800&h=600&fit=crop', tag: 'success-story' },
      { type: 'text', content: 'Completed my Machine Learning specialization from Stanford Online! 📚💻', tag: 'learning' },
      { type: 'job', content: "We're expanding! Looking for talented Product Managers to join our fintech startup.", job_title: 'Product Manager', company: 'FinTech Innovations', location: 'Remote / NYC' },
      { type: 'announcement', content: '📢 Virtual Career Fair next month! Connect with 100+ top employers. All alumni welcome!', tag: null },
    ];

    for (let i = 0; i < samplePosts.length && i < users.rows.length; i++) {
      const user = users.rows[i];
      const post = samplePosts[i];
      
      await pool.query(`
        INSERT INTO posts (author_id, university_id, type, content, media_url, tag, job_title, company, location)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [user.id, user.university_id, post.type, post.content, post.media_url || null, post.tag, post.job_title || null, post.company || null, post.location || null]);
    }
    console.log('✅ Sample posts created');

    // Create sample events
    const eventData = [
      { title: 'Alumni Networking Night', description: 'Connect with fellow alumni over drinks and appetizers', category: 'Networking', location: 'Downtown Conference Center', isVirtual: false },
      { title: 'Career Development Workshop', description: 'Learn strategies for advancing your career', category: 'Workshop', location: 'Virtual', isVirtual: true, meetingLink: 'https://zoom.us/meeting123' },
      { title: 'Tech Industry Panel', description: 'Hear from alumni leaders in tech', category: 'Panel', location: 'Campus Auditorium', isVirtual: false },
    ];

    for (const event of eventData) {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + Math.floor(Math.random() * 30) + 7);
      
      await pool.query(`
        INSERT INTO events (university_id, title, description, event_date, event_time, location, is_virtual, meeting_link, category)
        VALUES ('mit', $1, $2, $3, '18:00', $4, $5, $6, $7)
      `, [event.title, event.description, futureDate.toISOString().split('T')[0], event.location, event.isVirtual, event.meetingLink || null, event.category]);
      
      // Also create for Stanford
      await pool.query(`
        INSERT INTO events (university_id, title, description, event_date, event_time, location, is_virtual, meeting_link, category)
        VALUES ('stanford', $1, $2, $3, '18:00', $4, $5, $6, $7)
      `, [event.title, event.description, futureDate.toISOString().split('T')[0], event.location, event.isVirtual, event.meetingLink || null, event.category]);
    }
    console.log('✅ Sample events created');

    // Create sample groups
    const groupData = [
      { name: 'Tech Entrepreneurs', description: 'A community for alumni building startups', category: 'Professional', isPrivate: false },
      { name: 'Class of 2020', description: 'Stay connected with your graduating class', category: 'Year', isPrivate: false },
      { name: 'Women in STEM', description: 'Supporting women in science and technology', category: 'Interest', isPrivate: false },
    ];

    for (const group of groupData) {
      const avatar = `https://api.dicebear.com/7.x/shapes/svg?seed=${group.name.replace(' ', '')}`;
      
      await pool.query(`
        INSERT INTO groups (university_id, name, description, avatar, category, is_private)
        VALUES ('mit', $1, $2, $3, $4, $5)
      `, [group.name, group.description, avatar, group.category, group.isPrivate]);
      
      // Also create for Stanford
      await pool.query(`
        INSERT INTO groups (university_id, name, description, avatar, category, is_private)
        VALUES ('stanford', $1, $2, $3, $4, $5)
      `, [group.name, group.description, avatar, group.category, group.isPrivate]);
    }
    console.log('✅ Sample groups created');

    // Create sample fundraisers
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 3);

    await pool.query(`
      INSERT INTO fundraisers (university_id, title, description, goal_amount, current_amount, start_date, end_date, is_active)
      VALUES ('mit', 'Scholarship Fund 2024', 'Help provide scholarships for deserving students', 100000, 45000, $1, $2, true)
    `, [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]);

    await pool.query(`
      INSERT INTO fundraisers (university_id, title, description, goal_amount, current_amount, start_date, end_date, is_active)
      VALUES ('stanford', 'Innovation Lab Fund', 'Support the next generation of innovators', 150000, 72000, $1, $2, true)
    `, [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]);
    console.log('✅ Sample fundraisers created');

    // Create sample ads
    await pool.query(`
      INSERT INTO ads (university_id, title, description, image, link, placement, is_active)
      VALUES ('mit', 'MIT Career Fair', 'Connect with top employers', 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=400&h=200&fit=crop', '#', 'sidebar', true)
    `);

    await pool.query(`
      INSERT INTO ads (title, description, image, link, placement, is_active, is_global)
      VALUES ('Professional Development', 'Advance your career with online courses', 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=400&h=200&fit=crop', '#', 'feed', true, true)
    `);
    console.log('✅ Sample ads created');

    console.log('\n🎉 Database seeded successfully!');
    console.log('\n📋 Demo Credentials:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Super Admin: superadmin@alumnihub.com / super123');
    console.log('MIT Admin:   admin@mit.edu / mit123');
    console.log('Stanford Admin: admin@stanford.edu / stanford123');
    console.log('MIT Alumni:  john.doe@mit.edu / mit123');
    console.log('Stanford Alumni: michael.smith@stanford.edu / stanford123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

seedDatabase().catch(console.error);

