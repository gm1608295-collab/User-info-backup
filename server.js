require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'secretkey',
  resave: false,
  saveUninitialized: true
}));
app.use(passport.initialize());
app.use(passport.session());

// Database connection - Force IPv4 by using direct parameters
const pool = new Pool({
  user: 'postgres',
  password: 'g2iHgVDJlcqPObie',
  host: 'db.jdntekwhahnkoshitvdh.supabase.co',
  port: 5432,
  database: 'postgres',
  ssl: {
    rejectUnauthorized: false,
    require: true
  },
  keepAlive: true,
  connectionTimeoutMillis: 10000
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection error:', err.message);
  } else {
    console.log('✅ Database connected successfully');
    release();
  }
});

// Initialize database tables
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS local_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50),
        phone VARCHAR(20),
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS google_users (
        id SERIAL PRIMARY KEY,
        google_id VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS user_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        action VARCHAR(255),
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Database tables initialized');
  } catch (err) {
    console.error('❌ DB init error:', err.message);
  }
}
initDatabase();

// Google OAuth
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback'
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const result = await pool.query('SELECT * FROM google_users WHERE google_id = $1', [profile.id]);
    if (result.rows.length > 0) {
      return done(null, result.rows[0]);
    }
    const insert = await pool.query(
      'INSERT INTO google_users (google_id, email, name) VALUES ($1, $2, $3) RETURNING *',
      [profile.id, profile.emails[0].value, profile.displayName]
    );
    done(null, insert.rows[0]);
  } catch (err) {
    done(err);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query('SELECT * FROM google_users WHERE id = $1', [id]);
    done(null, result.rows[0]);
  } catch (err) {
    done(err);
  }
});

// Captcha bypass
app.post('/api/verify-captcha', async (req, res) => {
  res.json({ success: true });
});

// Signup
app.post('/api/signup', async (req, res) => {
  const { username, phone, email, password, confirmPassword } = req.body;
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }
  try {
    const hashed = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO local_users (username, phone, email, password_hash) VALUES ($1, $2, $3, $4)',
      [username, phone, email, hashed]
    );
    res.json({ message: 'Signup successful!' });
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).json({ error: 'Email already exists' });
    } else {
      res.status(500).json({ error: 'Database error' });
    }
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM local_users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'jwtsecret'
    );
    res.json({ token, role: user.role });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Guest login
app.post('/api/guest', (req, res) => {
  const token = jwt.sign(
    { type: 'guest', email: 'guest@example.com', role: 'guest' },
    process.env.JWT_SECRET || 'jwtsecret'
  );
  res.json({ token, role: 'guest' });
});

// Google Auth routes
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { session: false, failureRedirect: '/' }), (req, res) => {
  const token = jwt.sign(
    { id: req.user.id, email: req.user.email, name: req.user.name, role: 'user' },
    process.env.JWT_SECRET || 'jwtsecret'
  );
  res.redirect(`/dashboard.html?token=${token}`);
});

// Admin verify
app.post('/api/admin/verify', (req, res) => {
  const { adminId } = req.body;
  const validIds = ['ADMIN001', 'ADMIN002', 'MASTER2024'];
  if (validIds.includes(adminId)) {
    const token = jwt.sign({ adminId, role: 'admin' }, process.env.JWT_SECRET || 'jwtsecret');
    res.json({ success: true, token });
  } else {
    res.json({ success: false, error: 'Invalid Admin ID' });
  }
});

// Admin - Get users
app.get('/api/admin/users', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jwtsecret');
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const result = await pool.query('SELECT id, username, email, phone, role, created_at FROM local_users');
    res.json(result.rows);
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Admin - Add user
app.post('/api/admin/users', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jwtsecret');
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    
    const { username, email, phone, password, role } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const hashed = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO local_users (username, email, phone, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
      [username || null, email, phone || null, hashed, role || 'user']
    );
    res.json({ message: 'User added successfully' });
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).json({ error: 'Email already exists' });
    } else {
      res.status(500).json({ error: 'Database error' });
    }
  }
});

// Admin - Update user
app.put('/api/admin/users/:id', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jwtsecret');
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    
    const { username, email, phone, role } = req.body;
    await pool.query(
      'UPDATE local_users SET username = $1, email = $2, phone = $3, role = $4 WHERE id = $5',
      [username || null, email, phone || null, role, req.params.id]
    );
    res.json({ message: 'User updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Admin - Delete user
app.delete('/api/admin/users/:id', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jwtsecret');
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    await pool.query('DELETE FROM local_users WHERE id = $1', [req.params.id]);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Admin - Get logs
app.get('/api/admin/logs', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jwtsecret');
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const result = await pool.query('SELECT * FROM user_logs ORDER BY created_at DESC LIMIT 100');
    res.json(result.rows);
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  res.json({ message: 'Logged out' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
