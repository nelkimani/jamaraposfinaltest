// controllers/saleController.js
// Atomic sale creation: validates → inserts sale → inserts items → deducts stock → logs
const { getClient, query } = require('../config/database');

// POST /api/sales
const createSale = async (req, res, next) => {
  const client = await getClient();

  try {
    const { items, payment_method, mpesa_reference, amount_tendered, customer_name, notes } = req.body;

    // ── Input validation ────────────────────────────────────
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ status: 'error', message: 'items must be a non-empty array' });
    }
    if (!['cash', 'mpesa'].includes(payment_method)) {
      return res.status(400).json({ status: 'error', message: 'payment_method must be "cash" or "mpesa"' });
    }
    if (payment_method === 'mpesa' && !mpesa_reference) {
      return res.status(400).json({ status: 'error', message: 'mpesa_reference is required for M-Pesa payments' });
    }

    for (const item of items) {
      if (!item.variant_id || !Number.isInteger(Number(item.variant_id))) {
        return res.status(400).json({ status: 'error', message: 'Each item must have a valid variant_id' });
      }
      if (!item.quantity || Number(item.quantity) < 1) {
        return res.status(400).json({ status: 'error', message: 'Each item must have quantity >= 1' });
      }
    }

    await client.query('BEGIN');

    // ── 1. Fetch + lock all variants ────────────────────────
    const variantIds = items.map(i => parseInt(i.variant_id));
    const varResult = await client.query(
      `SELECT
         v.id, v.stock_quantity, v.size, v.color, v.sku,
         p.name AS product_name, p.price::FLOAT AS price, p.category
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE v.id = ANY($1::int[]) AND v.is_active = true AND p.is_active = true
       FOR UPDATE`,   // Lock rows to prevent concurrent overselling
      [variantIds]
    );

    // Verify all requested variants were found
    if (varResult.rows.length !== variantIds.length) {
      const found = varResult.rows.map(r => r.id);
      const missing = variantIds.filter(id => !found.includes(id));
      throw { code: 'VARIANT_NOT_FOUND', message: `Variant(s) not found: ${missing.join(', ')}` };
    }

    const varMap = {};
    varResult.rows.forEach(v => { varMap[v.id] = v; });

    // ── 2. Validate stock and compute total ─────────────────
    let totalAmount = 0;
    const enrichedItems = [];

    for (const item of items) {
      const vid = parseInt(item.variant_id);
      const qty = parseInt(item.quantity);
      const variant = varMap[vid];

      if (variant.stock_quantity < qty) {
        throw {
          code: 'INSUFFICIENT_STOCK',
          message: `Insufficient stock for ${variant.product_name} (${variant.size}/${variant.color}): ` +
                   `available ${variant.stock_quantity}, requested ${qty}`,
        };
      }

      const lineTotal = variant.price * qty;
      totalAmount += lineTotal;
      enrichedItems.push({ variant, qty, lineTotal });
    }

    // ── 3. Generate reference number ────────────────────────
    const refResult = await client.query(
      `SELECT 'JMU-' || LPAD(
         (COALESCE(MAX(CAST(SUBSTRING(reference_number FROM 5) AS INT)), 0) + 1)::TEXT,
         4, '0'
       ) AS ref
       FROM sales WHERE reference_number ~ '^JMU-[0-9]+$'`
    );
    const referenceNumber = refResult.rows[0].ref;

    // ── 4. Insert sale ──────────────────────────────────────
    const changeAmount = payment_method === 'cash' && amount_tendered
      ? Math.max(0, parseFloat(amount_tendered) - totalAmount)
      : 0;

    const saleResult = await client.query(
      `INSERT INTO sales
         (reference_number, total_amount, payment_method, mpesa_reference,
          amount_tendered, change_amount, cashier_id, customer_name, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'completed')
       RETURNING id, reference_number, total_amount::FLOAT, payment_method,
                 amount_tendered::FLOAT, change_amount::FLOAT, status, created_at`,
      [
        referenceNumber, totalAmount, payment_method,
        mpesa_reference || null,
        amount_tendered ? parseFloat(amount_tendered) : totalAmount,
        changeAmount, req.user.id,
        customer_name || null, notes || null,
      ]
    );
    const sale = saleResult.rows[0];

    // ── 5. Insert sale items + deduct stock + audit log ─────
    const saleItems = [];
    for (const { variant, qty, lineTotal } of enrichedItems) {
      // Insert sale item (price snapshot)
      const siResult = await client.query(
        `INSERT INTO sale_items (sale_id, variant_id, quantity, unit_price, line_total)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, variant_id, quantity, unit_price::FLOAT, line_total::FLOAT`,
        [sale.id, variant.id, qty, variant.price, lineTotal]
      );

      // Deduct stock
      const newStock = variant.stock_quantity - qty;
      await client.query(
        `UPDATE product_variants SET stock_quantity = $1, updated_at = NOW() WHERE id = $2`,
        [newStock, variant.id]
      );

      // Inventory audit log
      await client.query(
        `INSERT INTO inventory_logs
           (variant_id, change_type, quantity_change, quantity_after, user_id, sale_id, reason)
         VALUES ($1,'sale',$2,$3,$4,$5,$6)`,
        [variant.id, -qty, newStock, req.user.id, sale.id, `Sale ${referenceNumber}`]
      );

      saleItems.push({
        ...siResult.rows[0],
        product_name: variant.product_name,
        size: variant.size,
        color: variant.color,
        sku: variant.sku,
      });
    }

    await client.query('COMMIT');

    return res.status(201).json({
      status: 'success',
      message: `Sale ${referenceNumber} completed`,
      data: {
        ...sale,
        cashier: { id: req.user.id, name: req.user.name },
        items: saleItems,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');

    // Business logic errors → 400
    if (err.code === 'INSUFFICIENT_STOCK' || err.code === 'VARIANT_NOT_FOUND') {
      return res.status(400).json({ status: 'error', message: err.message });
    }
    next(err);
  } finally {
    client.release();
  }
};

// GET /api/sales
const getSales = async (req, res, next) => {
  try {
    const { start_date, end_date, page = 1, limit = 20 } = req.query;
    const conditions = ["s.status = 'completed'"];
    const params = [];
    let n = 0;

    // Cashiers only see their own sales
    if (req.user.role === 'cashier') {
      conditions.push(`s.cashier_id = $${++n}`);
      params.push(req.user.id);
    }
    if (start_date) { conditions.push(`DATE(s.created_at) >= $${++n}`); params.push(start_date); }
    if (end_date)   { conditions.push(`DATE(s.created_at) <= $${++n}`); params.push(end_date); }

    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const r = await query(
      `SELECT
         s.id, s.reference_number, s.total_amount::FLOAT, s.payment_method,
         s.customer_name, s.status, s.created_at,
         u.name AS cashier_name,
         COUNT(si.id)::INT AS item_count
       FROM sales s
       JOIN users u ON u.id = s.cashier_id
       LEFT JOIN sale_items si ON si.sale_id = s.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY s.id, u.name
       ORDER BY s.created_at DESC
       LIMIT $${++n} OFFSET $${++n}`,
      params
    );

    return res.json({ status: 'success', data: r.rows, meta: { page: parseInt(page), limit: parseInt(limit) } });
  } catch (err) {
    next(err);
  }
};

// GET /api/sales/:id
const getSaleById = async (req, res, next) => {
  try {
    const saleResult = await query(
      `SELECT s.*, u.name AS cashier_name
       FROM sales s JOIN users u ON u.id = s.cashier_id WHERE s.id = $1`,
      [req.params.id]
    );
    if (!saleResult.rows.length) return res.status(404).json({ status: 'error', message: 'Sale not found' });

    const sale = saleResult.rows[0];
    if (req.user.role === 'cashier' && sale.cashier_id !== req.user.id) {
      return res.status(403).json({ status: 'error', message: 'Access denied' });
    }

    const itemsResult = await query(
      `SELECT si.*, p.name AS product_name, v.size, v.color, v.sku
       FROM sale_items si
       JOIN product_variants v ON v.id = si.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE si.sale_id = $1`,
      [req.params.id]
    );

    return res.json({ status: 'success', data: { ...sale, items: itemsResult.rows } });
  } catch (err) {
    next(err);
  }
};

module.exports = { createSale, getSales, getSaleById };
