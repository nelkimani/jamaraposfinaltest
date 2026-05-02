// routes/index.js — All routes registered here
const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Controllers
const auth     = require('../controllers/authController');
const products = require('../controllers/productController');
const sales    = require('../controllers/saleController');
const reports  = require('../controllers/reportController');

const router = express.Router();

// ── Auth ─────────────────────────────────────────────────────
router.post('/auth/login',  auth.login);
router.get ('/auth/me',     authenticate, auth.getMe);

// ── Products (read: all roles | write: admin only) ───────────
router.get ('/products',           authenticate, products.getAll);
router.get ('/products/categories',authenticate, products.getCategories);
router.get ('/products/:id',       authenticate, products.getOne);
router.post('/products',           authenticate, requireAdmin, products.create);
router.put ('/products/:id',       authenticate, requireAdmin, products.update);
router.delete('/products/:id',     authenticate, requireAdmin, products.remove);

// ── Variants / Inventory ─────────────────────────────────────
router.get ('/variants/low-stock',                              authenticate, requireAdmin, reports.getLowStock);
router.patch('/variants/:variantId/stock',                      authenticate, requireAdmin, products.restockVariant);

// ── Sales ────────────────────────────────────────────────────
router.post('/sales',       authenticate, sales.createSale);
router.get ('/sales',       authenticate, sales.getSales);
router.get ('/sales/:id',   authenticate, sales.getSaleById);

// ── Reports (admin only) ─────────────────────────────────────
router.get('/reports/summary',      authenticate, requireAdmin, reports.getSummary);
router.get('/reports/daily',        authenticate, requireAdmin, reports.getDaily);
router.get('/reports/best-selling', authenticate, requireAdmin, reports.getBestSelling);
router.get('/reports/sales-detail', authenticate, requireAdmin, reports.getSalesDetail);

module.exports = router;
