// controllers/reportController.js  [admin only]
const { query } = require('../config/database');

const getSummary = async (req, res, next) => {
  try {
    const r = await query(`
      SELECT
        (SELECT COALESCE(SUM(total_amount),0)::FLOAT FROM sales
         WHERE status='completed' AND DATE(created_at AT TIME ZONE 'Africa/Nairobi')=CURRENT_DATE) AS today_revenue,
        (SELECT COUNT(*)::INT FROM sales
         WHERE status='completed' AND DATE(created_at AT TIME ZONE 'Africa/Nairobi')=CURRENT_DATE) AS today_transactions,
        (SELECT COALESCE(SUM(total_amount),0)::FLOAT FROM sales
         WHERE status='completed'
           AND EXTRACT(MONTH FROM created_at AT TIME ZONE 'Africa/Nairobi')=EXTRACT(MONTH FROM NOW())
           AND EXTRACT(YEAR  FROM created_at AT TIME ZONE 'Africa/Nairobi')=EXTRACT(YEAR  FROM NOW())) AS month_revenue,
        (SELECT COUNT(*)::INT FROM products WHERE is_active=true) AS total_products,
        (SELECT COUNT(*)::INT FROM product_variants WHERE is_active=true AND stock_quantity<=10) AS low_stock_count,
        (SELECT COUNT(*)::INT FROM product_variants WHERE is_active=true AND stock_quantity=0)  AS out_of_stock_count
    `);
    return res.json({ status: 'success', data: r.rows[0] });
  } catch (err) { next(err); }
};

const getDaily = async (req, res, next) => {
  try {
    const { start_date, end_date } = req.query;
    const from = start_date || new Date().toISOString().split('T')[0];
    const to   = end_date   || from;

    const r = await query(
      `SELECT
         DATE(created_at AT TIME ZONE 'Africa/Nairobi') AS date,
         COUNT(*)::INT                                  AS transactions,
         COALESCE(SUM(total_amount),0)::FLOAT           AS revenue,
         COALESCE(AVG(total_amount),0)::FLOAT           AS avg_sale,
         COUNT(CASE WHEN payment_method='cash'  THEN 1 END)::INT AS cash_count,
         COUNT(CASE WHEN payment_method='mpesa' THEN 1 END)::INT AS mpesa_count
       FROM sales
       WHERE status='completed'
         AND DATE(created_at AT TIME ZONE 'Africa/Nairobi') BETWEEN $1 AND $2
       GROUP BY 1 ORDER BY 1 DESC`,
      [from, to]
    );
    return res.json({ status: 'success', data: r.rows });
  } catch (err) { next(err); }
};

const getBestSelling = async (req, res, next) => {
  try {
    const { limit = 10, start_date, end_date } = req.query;
    const from = start_date || '2000-01-01';
    const to   = end_date   || new Date().toISOString().split('T')[0];

    const r = await query(
      `SELECT
         p.id, p.name, p.category, p.emoji,
         COALESCE(SUM(si.quantity),0)::INT       AS total_sold,
         COALESCE(SUM(si.line_total),0)::FLOAT   AS revenue
       FROM products p
       LEFT JOIN product_variants v  ON v.product_id = p.id
       LEFT JOIN sale_items si       ON si.variant_id = v.id
       LEFT JOIN sales s             ON s.id = si.sale_id
                                    AND s.status = 'completed'
                                    AND DATE(s.created_at AT TIME ZONE 'Africa/Nairobi') BETWEEN $2 AND $3
       WHERE p.is_active = true
       GROUP BY p.id
       ORDER BY total_sold DESC
       LIMIT $1`,
      [parseInt(limit), from, to]
    );
    return res.json({ status: 'success', data: r.rows, meta: { from, to } });
  } catch (err) { next(err); }
};

// GET /api/reports/sales-detail  — itemised list of every sale line in a period
const getSalesDetail = async (req, res, next) => {
  try {
    const { start_date, end_date } = req.query;
    const from = start_date || new Date().toISOString().split('T')[0];
    const to   = end_date   || from;

    const r = await query(
      `SELECT
         s.reference_number,
         DATE(s.created_at AT TIME ZONE 'Africa/Nairobi') AS sale_date,
         s.created_at,
         s.payment_method,
         u.name                                           AS cashier,
         p.name                                           AS product,
         p.emoji,
         v.size, v.color,
         si.quantity,
         si.unit_price::FLOAT,
         si.line_total::FLOAT,
         s.total_amount::FLOAT
       FROM sale_items si
       JOIN sales s             ON s.id = si.sale_id AND s.status = 'completed'
       JOIN product_variants v  ON v.id = si.variant_id
       JOIN products p          ON p.id = v.product_id
       JOIN users u             ON u.id = s.cashier_id
       WHERE DATE(s.created_at AT TIME ZONE 'Africa/Nairobi') BETWEEN $1 AND $2
       ORDER BY s.created_at DESC, s.id, p.name`,
      [from, to]
    );
    return res.json({ status: 'success', data: r.rows, meta: { from, to, count: r.rowCount } });
  } catch (err) { next(err); }
};

const getLowStock = async (req, res, next) => {
  try {
    const threshold = parseInt(process.env.LOW_STOCK_THRESHOLD) || 10;
    const r = await query(
      `SELECT v.id, v.size, v.color, v.stock_quantity, v.sku,
              p.name AS product_name, p.category
       FROM product_variants v
       JOIN products p ON p.id=v.product_id
       WHERE v.is_active=true AND p.is_active=true AND v.stock_quantity<=$1
       ORDER BY v.stock_quantity ASC`,
      [threshold]
    );
    return res.json({ status: 'success', data: r.rows, meta: { threshold } });
  } catch (err) { next(err); }
};

module.exports = { getSummary, getDaily, getBestSelling, getLowStock, getSalesDetail };
