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

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'secretkey',
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

/* ✅ FIX 1: SSL issue fix */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
    ? { rejectUnauthorized: false }
    : false
});

/* ✅ FIX 2: DB fail → server stop */
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
    console.log('✅ Database initialized');
  } catch (err) {
    console.error('❌ DB init error:', err);
    process.exit(1); // ❗ DB fail → server stop
  }
}

/* ✅ FIX 3: Google callback URL */
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const result = await pool.query(
      'SELECT * FROM google_users WHERE google_id = $1',
      [profile.id]
    );

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
    const result = await pool.query(
      'SELECT * FROM google_users WHERE id = $1',
      [id]
    );
    done(null, result.rows[0]);
  } catch (err) {
    done(err);
  }
});

/* ================= API ================= */

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

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      'SELECT * FROM local_users WHERE email = $1',
      [email]
    );

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
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/guest', (req, res) => {
  const token = jwt.sign(
    { type: 'guest', role: 'guest' },
    process.env.JWT_SECRET || 'jwtsecret'
  );

  res.json({ token, role: 'guest' });
});

/* Google Auth */
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/' }),
  (req, res) => {
    const token = jwt.sign(
      { id: req.user.id, email: req.user.email, role: 'user' },
      process.env.JWT_SECRET || 'jwtsecret'
    );

    res.redirect(`/dashboard.html?token=${token}`);
  }
);

/* ================= START ================= */

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await initDatabase();
});
