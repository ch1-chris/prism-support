import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.post('/login', asyncHandler(async (req, res) => {
  const { password } = req.body;

  if (!process.env.ADMIN_PASSWORD) {
    throw new Error('ADMIN_PASSWORD is not configured');
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  req.session.isAdmin = true;
  res.json({ ok: true });
}));

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to destroy session' });
    }
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/status', (req, res) => {
  res.json({ authenticated: req.session?.isAdmin === true });
});

export default router;
