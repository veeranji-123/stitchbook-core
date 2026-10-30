const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireTailor } = require('../middleware/auth');
const { validateId, safeName } = require('../validate');

const router = express.Router();
const MAX_IRONING_SERVICES = 12;
const MAX_STITCHING_SPEEDS = 6;
const MAX_TURNAROUND_DAYS = 60;

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

router.post('/stitching-speeds', authenticateToken, requireTailor, async (req, res) => {
  try {
    const domain = await shopType(req.auth.id);
    if (domain === null) return res.status(404).json({ error: 'Tailor not found' });
    if (domain !== 'tailor') return res.status(403).json({ error: 'Stitching speed options are available only for tailoring shops' });
    const { name, turnaroundDays, extraCharge, displayOrder } = req.body;
    if (!name || !safeName(name)) return res.status(400).json({ error: 'Speed name required (1-100 chars)' });
    const days = parseInt(turnaroundDays, 10);
    if (!Number.isFinite(days) || days < 0 || days > MAX_TURNAROUND_DAYS) {
      return res.status(400).json({ error: `Turnaround must be 0-${MAX_TURNAROUND_DAYS} days` });
    }
    const charge = Number(extraCharge) || 0;
    if (charge < 0 || charge > 100000) return res.status(400).json({ error: 'Extra charge must be 0-100000' });
    const count = await pool.query('SELECT COUNT(*) FROM tailor_stitching_speeds WHERE tailor_id = $1', [req.auth.id]);
    if (parseInt(count.rows[0].count, 10) >= MAX_STITCHING_SPEEDS) {
      return res.status(409).json({ error: `Maximum ${MAX_STITCHING_SPEEDS} stitching speeds allowed` });
    }
    const duplicate = await pool.query(
      'SELECT id FROM tailor_stitching_speeds WHERE tailor_id = $1 AND LOWER(name) = LOWER($2) AND is_enabled = 1',
      [req.auth.id, name.trim()]
    );
    if (duplicate.rows.length > 0) return res.status(409).json({ error: 'A speed with this name already exists' });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const order = Number.isFinite(parseInt(displayOrder, 10)) ? parseInt(displayOrder, 10) : 0;
    await pool.query(
      `INSERT INTO tailor_stitching_speeds (
        id, tailor_id, name, turnaround_days, extra_charge, is_enabled, display_order, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8)`,
      [id, req.auth.id, name.trim(), days, charge, order, now, now]
    );
    const created = await pool.query('SELECT * FROM tailor_stitching_speeds WHERE id = $1', [id]);
    return res.json({ speed: created.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create stitching speed' });
  }
});

router.put('/stitching-speeds/:id', authenticateToken, requireTailor, async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid speed ID' });
    const existing = await pool.query('SELECT * FROM tailor_stitching_speeds WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Speed not found' });
    if (existing.rows[0].tailor_id !== req.auth.id) return res.status(403).json({ error: 'Cannot modify another tailor\'s speed' });
    const { name, turnaroundDays, extraCharge, isEnabled, displayOrder } = req.body;
    const fields = [];
    const values = [];
    let index = 1;
    if (name !== undefined) {
      if (!safeName(name)) return res.status(400).json({ error: 'Invalid speed name' });
      fields.push(`name=$${index}`); values.push(name.trim()); index += 1;
    }
    if (turnaroundDays !== undefined) {
      const days = parseInt(turnaroundDays, 10);
      if (!Number.isFinite(days) || days < 0 || days > MAX_TURNAROUND_DAYS) {
        return res.status(400).json({ error: `Turnaround must be 0-${MAX_TURNAROUND_DAYS} days` });
      }
      fields.push(`turnaround_days=$${index}`); values.push(days); index += 1;
    }
    if (extraCharge !== undefined) {
      const charge = Number(extraCharge);
      if (!Number.isFinite(charge) || charge < 0 || charge > 100000) return res.status(400).json({ error: 'Extra charge must be 0-100000' });
      fields.push(`extra_charge=$${index}`); values.push(charge); index += 1;
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
    await pool.query(`UPDATE tailor_stitching_speeds SET ${fields.join(',')} WHERE id=$${index}`, values);
    const updated = await pool.query('SELECT * FROM tailor_stitching_speeds WHERE id = $1', [req.params.id]);
    return res.json({ speed: updated.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Update failed' });
  }
});

router.delete('/stitching-speeds/:id', authenticateToken, requireTailor, async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid speed ID' });
    const existing = await pool.query('SELECT * FROM tailor_stitching_speeds WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Speed not found' });
    if (existing.rows[0].tailor_id !== req.auth.id) return res.status(403).json({ error: 'Cannot delete another tailor\'s speed' });
    const used = await pool.query('SELECT COUNT(*) FROM bookings WHERE stitching_speed_id = $1', [req.params.id]);
    if (parseInt(used.rows[0].count, 10) > 0) {
      await pool.query('UPDATE tailor_stitching_speeds SET is_enabled = 0, updated_at = $1 WHERE id = $2', [new Date().toISOString(), req.params.id]);
      return res.json({ success: true, disabled: true });
    }
    await pool.query('DELETE FROM tailor_stitching_speeds WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Delete failed' });
  }
});

router.get('/pickup-drop', authenticateToken, requireTailor, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT offers_pickup_drop, pickup_radius_km, base_delivery_charge FROM tailors WHERE id = $1',
      [req.auth.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tailor not found' });
    const shop = result.rows[0];
    return res.json({
      offersPickupDrop: !!shop.offers_pickup_drop,
      pickupRadiusKm: Number(shop.pickup_radius_km) || 0,
      baseDeliveryCharge: Number(shop.base_delivery_charge) || 0,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.put('/pickup-drop', authenticateToken, requireTailor, async (req, res) => {
  try {
    const { offersPickupDrop, pickupRadiusKm, baseDeliveryCharge } = req.body;
    const fields = [];
    const values = [];
    let index = 1;
    if (offersPickupDrop !== undefined) {
      fields.push(`offers_pickup_drop=$${index}`); values.push(offersPickupDrop ? 1 : 0); index += 1;
    }
    if (pickupRadiusKm !== undefined) {
      const radius = Number(pickupRadiusKm);
      if (!Number.isFinite(radius) || radius < 0 || radius > 100) return res.status(400).json({ error: 'Pickup radius must be 0-100 km' });
      fields.push(`pickup_radius_km=$${index}`); values.push(radius); index += 1;
    }
    if (baseDeliveryCharge !== undefined) {
      const charge = Number(baseDeliveryCharge);
      if (!Number.isFinite(charge) || charge < 0 || charge > 100000) return res.status(400).json({ error: 'Delivery charge must be 0-100000' });
      fields.push(`base_delivery_charge=$${index}`); values.push(charge); index += 1;
    }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    values.push(req.auth.id);
    await pool.query(`UPDATE tailors SET ${fields.join(',')} WHERE id=$${index}`, values);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Update failed' });
  }
});

module.exports = router;
