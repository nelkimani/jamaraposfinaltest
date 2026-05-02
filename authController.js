// controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

// POST /api/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ status: 'error', message: 'Email and password are required' });
    }

    // Look up user
    const result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = result.rows[0];

    // Same error message for both — prevents email enumeration attacks
    if (!user || !user.is_active) {
      return res.status(401).json({ status: 'error', message: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ status: 'error', message: 'Invalid email or password' });
    }

    // Sign JWT with userId + role embedded
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    // Record last login (fire-and-forget — don't block response)
    query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]).catch(() => {});

    return res.status(200).json({
      status: 'success',
      message: 'Login successful',
      data: {
        token,
        expiresIn: process.env.JWT_EXPIRES_IN || '8h',
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  res.json({
    status: 'success',
    data: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
    },
  });
};

module.exports = { login, getMe };
