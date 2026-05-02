# Jamara Uniforms & Clothing — Integrated POS System v2

A complete 3-tier retail POS: **HTML/JS Frontend → Node.js API → Supabase PostgreSQL**

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER (Browser)                           │
│                   frontend/index.html                           │
└────────────────────────┬────────────────────────────────────────┘
                         │  HTTP REST (fetch + Bearer token)
                         │  All calls go through:  http://localhost:5000/api
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                  NODE.JS EXPRESS BACKEND                        │
│                   backend/server.js                             │
│                                                                 │
│  POST /api/auth/login   →  authController.login()              │
│  GET  /api/products     →  productController.getAll()          │
│  POST /api/sales        →  saleController.createSale()         │
│  GET  /api/reports/*    →  reportController.*()                │
│                                                                 │
│  Middleware: helmet · cors · rateLimit · jwt · validation       │
└────────────────────────┬────────────────────────────────────────┘
                         │  pg Pool (SSL / TLS)
                         │  DATABASE_URL from .env
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              SUPABASE POSTGRESQL DATABASE                       │
│                                                                 │
│  users · products · product_variants                           │
│  sales · sale_items · inventory_logs                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Project Layout

```
jamara-integrated/
├── frontend/
│   └── index.html         ← Complete SPA (login + POS + reports)
│
└── backend/
    ├── server.js           ← Express entry point
    ├── .env.example        ← Copy to .env and fill in
    ├── package.json
    ├── config/
    │   └── database.js     ← pg Pool connected to Supabase
    ├── middleware/
    │   └── auth.js         ← JWT verify + requireAdmin
    ├── controllers/
    │   ├── authController.js     ← Login, /me
    │   ├── productController.js  ← CRUD + categories
    │   ├── saleController.js     ← Atomic sale + stock deduction
    │   └── reportController.js   ← Summary, daily, best-selling
    └── routes/
        └── index.js        ← All routes in one file
```

---

## Quick Start

### Prerequisites
- Node.js v18+
- A Supabase project with the schema from `jamara_supabase_complete.sql`
- The schema run populates users, products, and variants with sample data

---

### Step 1 — Set up the database

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor → New Query**
3. Paste and run `jamara_supabase_complete.sql`
4. Go to **Settings → Database → URI** — copy the connection string

---

### Step 2 — Configure the backend

```bash
cd backend
cp .env.example .env
```

Edit `.env`:
```env
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres
JWT_SECRET=generate_with_node_-e_console.log(require('crypto').randomBytes(48).toString('hex'))
FRONTEND_URL=http://127.0.0.1:5500
PORT=5000
NODE_ENV=development
```

---

### Step 3 — Install and run the backend

```bash
cd backend
npm install
npm run dev        # or: npm start
```

You should see:
```
[DB] Connected to PostgreSQL ✓
🚀 Jamara POS API running
   URL:  http://localhost:5000
```

---

### Step 4 — Open the frontend

#### Option A: VS Code Live Server
- Right-click `frontend/index.html` → Open with Live Server
- It opens at `http://127.0.0.1:5500` (already in the CORS allowlist)

#### Option B: Python simple server
```bash
cd frontend
python3 -m http.server 5500
# Open: http://localhost:5500
```

#### Option C: Direct file open
Some browsers block `fetch` from `file://`. Use Option A or B instead.

---

### Step 5 — Login

| Role    | Email                     | Password       |
|---------|---------------------------|----------------|
| Admin   | admin@jamara.co.ke        | Admin@1234     |
| Cashier | cashier@jamara.co.ke      | Cashier@1234   |

---

## Data Flow (detailed)

### 1. Login
```
Frontend                Backend                  Database
   │                       │                        │
   │  POST /api/auth/login  │                        │
   │  { email, password }   │                        │
   │──────────────────────►│                        │
   │                       │  SELECT * FROM users    │
   │                       │  WHERE email=$1         │
   │                       │───────────────────────►│
   │                       │◄───────────────────────│
   │                       │  bcrypt.compare()       │
   │                       │  jwt.sign()             │
   │◄──────────────────────│                        │
   │  { token, user }      │                        │
   │  localStorage.set()   │                        │
```

### 2. Load Products
```
Frontend                Backend                  Database
   │                       │                        │
   │  GET /api/products     │                        │
   │  Authorization: Bearer │                        │
   │──────────────────────►│                        │
   │                       │  jwt.verify(token)      │
   │                       │  SELECT products +      │
   │                       │  JSON_AGG(variants)     │
   │                       │───────────────────────►│
   │                       │◄───────────────────────│
   │◄──────────────────────│                        │
   │  { data: [...] }      │                        │
   │  renderProducts()     │                        │
```

### 3. Create Sale (atomic)
```
Frontend                Backend                  Database
   │                       │                        │
   │  POST /api/sales       │                        │
   │  { items, payment }    │                        │
   │──────────────────────►│                        │
   │                       │  BEGIN transaction      │
   │                       │  SELECT variants        │───────────►│
   │                       │  FOR UPDATE (lock!)     │            │
   │                       │  Validate stock         │            │
   │                       │  INSERT sale            │───────────►│
   │                       │  INSERT sale_items      │───────────►│
   │                       │  UPDATE stock -qty      │───────────►│
   │                       │  INSERT inv_log         │───────────►│
   │                       │  COMMIT                 │            │
   │◄──────────────────────│                        │
   │  { reference, items } │                        │
   │  showSaleSuccess()    │                        │
```

---

## API Reference

### Auth
| Method | Path | Auth | Body |
|--------|------|------|------|
| POST | `/api/auth/login` | None | `{ email, password }` |
| GET  | `/api/auth/me` | Bearer | — |

### Products
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/products` | Bearer | `?category=&search=` |
| GET | `/api/products/:id` | Bearer | With variants |
| POST | `/api/products` | Admin | Create with variants |
| PUT | `/api/products/:id` | Admin | Update fields |
| DELETE | `/api/products/:id` | Admin | Soft delete |

### Sales
| Method | Path | Auth | Body |
|--------|------|------|------|
| POST | `/api/sales` | Bearer | `{ items, payment_method, mpesa_reference? }` |
| GET  | `/api/sales` | Bearer | Admin: all; Cashier: own |
| GET  | `/api/sales/:id` | Bearer | With line items |

### Reports (Admin only)
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/reports/summary` | Dashboard stats |
| GET | `/api/reports/daily` | `?date=2024-01-15` |
| GET | `/api/reports/best-selling` | `?limit=10` |
| GET | `/api/variants/low-stock` | Items ≤ 10 units |

---

## Security Checklist

- ✅ Database credentials never exposed to browser
- ✅ JWT signed with secret, verified on every request
- ✅ Passwords hashed with bcrypt (12 rounds)
- ✅ Role-based access control (admin vs cashier)
- ✅ Rate limiting (20 login attempts / 15 min)
- ✅ CORS restricted to configured origins
- ✅ SQL injection prevented via parameterised queries
- ✅ Stock validated + locked with `FOR UPDATE` before deduction
- ✅ Helmet security headers enabled
- ✅ `CHECK (stock_quantity >= 0)` constraint at DB level

---

## Changing the API URL

The frontend has the API URL at the top of `frontend/index.html`:

```js
const API = 'http://localhost:5000/api';   // ← change for production
```

Change this to your deployed backend URL when going to production.

---

## Production Deployment

### Backend → Railway / Render / Fly.io
```bash
# Set these environment variables on your platform:
DATABASE_URL=<supabase-connection-string>
JWT_SECRET=<64-char-hex>
FRONTEND_URL=https://your-pos.netlify.app
NODE_ENV=production
PORT=5000
```

### Frontend → Netlify / Vercel / GitHub Pages
1. Update `const API = 'https://your-backend.railway.app/api'`
2. Deploy the `frontend/` folder
