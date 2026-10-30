const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireTailor } = require('../middleware/auth');
const { validateId, safeName } = require('../validate');

const router = express.Router();
const MAX_IRONING_SERVICES = 12;

async function shopType(tailorId) {
  const result = await pool.query('SELECT shop_type FROM tailors WHERE id = $1', [tailorId]);
  if (result.rows.length === 0) return null;
  return result.rows[0].shop_type === 'iron' ? 'iron' : result.rows[0].shop_type === 'tailor' ? 'tailor' : 'unknown';
}

router.post('/ironing-services', authenticateToken, requireTailor, async (req, res) => {
  try {
    const domain = await shopType(req.auth.id);
    if (domain === null) return res.status(404).json({ error: 'Tailor not found' });
    if (domain !== 'iron') return res.status(403).json({ error: 'Ironing services are available only for ironing shops' });
    const { name, description, pricePerItem, displayOrder } = req.body;
    if (!name || !safeName(name)) return res.status(400).json({ error: 'Service name required (1-100 chars)' });
    if (description && String(description).length > 500) return res.status(400).json({ error: 'Description max 500 chars' });
    const price = Number(pricePerItem);
    if (!Number.isFinite(price) || price < 0 || price > 100000) return res.status(400).json({ error: 'Price must be 0-100000' });
    const count = await pool.query('SELECT COUNT(*) FROM ironing_service_types WHERE tailor_id = $1', [req.auth.id]);
    if (parseInt(count.rows[0].count, 10) >= MAX_IRONING_SERVICES) {
      return res.status(409).json({ error: `Maximum ${MAX_IRONING_SERVICES} ironing services allowed` });
    }
    const duplicate = await pool.query(
      'SELECT id FROM ironing_service_types WHERE tailor_id = $1 AND LOWER(name) = LOWER($2) AND is_enabled = 1',
      [req.auth.id, name.trim()]
    );
    if (duplicate.rows.length > 0) return res.status(409).json({ error: 'A service with this name already exists' });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const order = Number.isFinite(parseInt(displayOrder, 10)) ? parseInt(displayOrder, 10) : 0;
    await pool.query(
      `INSERT INTO ironing_service_types (
        id, tailor_id, name, description, price_per_item, is_enabled, display_order, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8)`,
      [id, req.auth.id, name.trim(), description ? String(description).trim().slice(0, 500) : null, price, order, now, now]
    );
    const created = await pool.query('SELECT * FROM ironing_service_types WHERE id = $1', [id]);
    return res.json({ service: created.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create ironing service' });
  }
});

router.put('/ironing-services/:id', authenticateToken, requireTailor, async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid service ID' });
    const existing = await pool.query('SELECT * FROM ironing_service_types WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Service not found' });
    if (existing.rows[0].tailor_id !== req.auth.id) {
      return res.status(403).json({ error: 'Cannot modify another tailor\'s service' });
    }
    const { name, description, pricePerItem, isEnabled, displayOrder } = req.body;
    const fields = [];
    const values = [];
    let index = 1;
    if (name !== undefined) {
      if (!safeName(name)) return res.status(400).json({ error: 'Invalid service name' });
      fields.push(`name=$${index}`); values.push(name.trim()); index += 1;
    }
    if (description !== undefined) {
      fields.push(`description=$${index}`);
      values.push(description ? String(description).trim().slice(0, 500) : null);
      index += 1;
    }
    if (pricePerItem !== undefined) {
      const price = Number(pricePerItem);
      if (!Number.isFinite(price) || price < 0 || price > 100000) return res.status(400).json({ error: 'Price must be 0-100000' });
      fields.push(`price_per_item=$${index}`); values.push(price); index += 1;
    }
    if (isEnabled !== undefined) {
      fields.push(`is_enabled=$${index}`); values.push(isEnabled ? 1 : 0); index += 1;
    }
    if (displayOrder !== undefined) {
      const order = parseInt(displayOrder, 10);
      if (Number.isFinite(order)) { fields.push(`display_order=$${index}`); values.push(order); index += 1; }
    }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    fields.push(`updated_at=$${index}`); values.push(new Date().toISOString()); index += 1;
    values.push(req.params.id);
    await pool.query(`UPDATE ironing_service_types SET ${fields.join(',')} WHERE id=$${index}`, values);
    const updated = await pool.query('SELECT * FROM ironing_service_types WHERE id = $1', [req.params.id]);
    return res.json({ service: updated.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Update failed' });
  }
});

router.delete('/ironing-services/:id', authenticateToken, requireTailor, async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid service ID' });
    const existing = await pool.query('SELECT * FROM ironing_service_types WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Service not found' });
    if (existing.rows[0].tailor_id !== req.auth.id) {
      return res.status(403).json({ error: 'Cannot delete another tailor\'s service' });
    }
    const used = await pool.query(
      'SELECT COUNT(*) FROM booking_ironing_items WHERE service_type_id = $1',
      [req.params.id]
    );
    const linked = await pool.query('SELECT COUNT(*) FROM bookings WHERE ironing_service_type_id = $1', [req.params.id]);
    if (parseInt(used.rows[0].count, 10) > 0 || parseInt(linked.rows[0].count, 10) > 0) {
      await pool.query('UPDATE ironing_service_types SET is_enabled = 0, updated_at = $1 WHERE id = $2', [new Date().toISOString(), req.params.id]);
      return res.json({ success: true, disabled: true });
    }
    await pool.query('DELETE FROM ironing_service_types WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;
