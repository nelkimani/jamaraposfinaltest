// controllers/productController.js
const { query } = require('../config/database');

// GET /api/products
// Returns all active products with their variants nested as JSON array
const getAll = async (req, res, next) => {
  try {
    const { category, search } = req.query;

    const conditions = ['p.is_active = true'];
    const params = [];
    let i = 0;

    if (category) {
      conditions.push(`p.category = $${++i}`);
      params.push(category);
    }
    if (search) {
      conditions.push(`p.name ILIKE $${++i}`);
      params.push(`%${search}%`);
    }

    // JSON_AGG builds variants array in a single query — no N+1 problem
    const result = await query(
      `SELECT
         p.id, p.name, p.category, p.price::FLOAT, p.description, p.emoji,
         COALESCE(SUM(v.stock_quantity), 0)::INT AS total_stock,
         JSON_AGG(
           JSON_BUILD_OBJECT(
             'id',            v.id,
             'size',          v.size,
             'color',         v.color,
             'stock',         v.stock_quantity,
             'sku',           v.sku
           ) ORDER BY v.size, v.color
         ) FILTER (WHERE v.id IS NOT NULL) AS variants
       FROM products p
       LEFT JOIN product_variants v
         ON v.product_id = p.id AND v.is_active = true
       WHERE ${conditions.join(' AND ')}
       GROUP BY p.id
       ORDER BY p.category, p.name`,
      params
    );

    return res.json({
      status: 'success',
      data: result.rows,
      meta: { total: result.rowCount },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/products/:id
const getOne = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         p.id, p.name, p.category, p.price::FLOAT, p.description, p.emoji,
         JSON_AGG(
           JSON_BUILD_OBJECT(
             'id', v.id, 'size', v.size, 'color', v.color,
             'stock', v.stock_quantity, 'sku', v.sku
           ) ORDER BY v.size, v.color
         ) FILTER (WHERE v.id IS NOT NULL) AS variants
       FROM products p
       LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = true
       WHERE p.id = $1 AND p.is_active = true
       GROUP BY p.id`,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }
    return res.json({ status: 'success', data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// POST /api/products  [admin only]
const create = async (req, res, next) => {
  try {
    const { name, category, price, description, emoji, variants = [] } = req.body;

    if (!name || !category || !price) {
      return res.status(400).json({ status: 'error', message: 'name, category, and price are required' });
    }

    const validCategories = ['School Uniforms', 'Corporate Wear', 'Accessories', 'Sports Wear'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ status: 'error', message: `category must be one of: ${validCategories.join(', ')}` });
    }

    const { getClient } = require('../config/database');
    const client = await getClient();

    try {
      await client.query('BEGIN');

      const pResult = await client.query(
        `INSERT INTO products (name, category, price, description, emoji)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, category, price::FLOAT, emoji`,
        [name, category, parseFloat(price), description || null, emoji || '👔']
      );
      const product = pResult.rows[0];

      // Insert variants if provided
      for (const v of variants) {
        const sku = `JMU-${product.id}-${v.size}-${v.color}`.toUpperCase().replace(/\s+/g, '');
        await client.query(
          `INSERT INTO product_variants (product_id, size, color, stock_quantity, sku)
           VALUES ($1, $2, $3, $4, $5)`,
          [product.id, v.size, v.color, parseInt(v.stock_quantity) || 0, sku]
        );
      }

      await client.query('COMMIT');
      return res.status(201).json({ status: 'success', message: 'Product created', data: product });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

// PUT /api/products/:id  [admin only]
const update = async (req, res, next) => {
  try {
    const { name, category, price, description, emoji } = req.body;
    const fields = [], vals = [];
    let n = 0;

    if (name)        { fields.push(`name = $${++n}`);        vals.push(name); }
    if (category)    { fields.push(`category = $${++n}`);    vals.push(category); }
    if (price)       { fields.push(`price = $${++n}`);       vals.push(parseFloat(price)); }
    if (description) { fields.push(`description = $${++n}`); vals.push(description); }
    if (emoji)       { fields.push(`emoji = $${++n}`);       vals.push(emoji); }

    if (!fields.length) return res.status(400).json({ status: 'error', message: 'No fields to update' });

    vals.push(req.params.id);
    const r = await query(
      `UPDATE products SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${++n} AND is_active = true
       RETURNING id, name, category, price::FLOAT`,
      vals
    );

    if (!r.rows.length) return res.status(404).json({ status: 'error', message: 'Product not found' });
    return res.json({ status: 'success', message: 'Product updated', data: r.rows[0] });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/products/:id  [admin only]
const remove = async (req, res, next) => {
  try {
    const r = await query(
      `UPDATE products SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND is_active = true RETURNING id, name`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ status: 'error', message: 'Product not found' });
    return res.json({ status: 'success', message: `Product "${r.rows[0].name}" deleted`, data: r.rows[0] });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/products/:id/variants/:variantId/stock  [admin only]
const restockVariant = async (req, res, next) => {
  try {
    const { variantId } = req.params;
    const { quantity } = req.body;

    const qty = parseInt(quantity);
    if (!qty || qty < 1) {
      return res.status(400).json({ status: 'error', message: 'quantity must be a positive integer' });
    }

    const r = await query(
      `UPDATE product_variants
       SET stock_quantity = stock_quantity + $1, updated_at = NOW()
       WHERE id = $2 AND is_active = true
       RETURNING id, size, color, stock_quantity, sku`,
      [qty, variantId]
    );

    if (!r.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Variant not found' });
    }

    return res.json({
      status: 'success',
      message: `Restocked +${qty} units`,
      data: r.rows[0],
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/categories
const getCategories = async (req, res, next) => {
  try {
    const r = await query(
      `SELECT category, COUNT(*) AS product_count
       FROM products WHERE is_active = true
       GROUP BY category ORDER BY category`
    );
    return res.json({ status: 'success', data: r.rows });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAll, getOne, create, update, remove, getCategories, restockVariant };
