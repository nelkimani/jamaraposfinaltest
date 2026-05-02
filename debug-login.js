require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const email = 'admin@jamara.co.ke';
const password = 'Admin@1234';

pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()])
  .then(r => {
    const user = r.rows[0];
    console.log('User found:', !!user);
    console.log('is_active:', user.is_active);
    console.log('password_hash:', user.password_hash);
    return bcrypt.compare(password, user.password_hash).then(valid => {
      console.log('Password valid:', valid);
      pool.end();
    });
  })
  .catch(e => console.error(e));