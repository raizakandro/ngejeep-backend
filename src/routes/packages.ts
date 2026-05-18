import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { verifyToken, requireRole, AuthRequest } from '../middleware/verifyToken';

const router = Router();

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const packages = await prisma.package.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
    res.json(packages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/all', verifyToken, requireRole('admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const packages = await prisma.package.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(packages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/', verifyToken, requireRole('admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, price, durationHours, destinations, maxPax, description, centerLat, centerLng, radiusKm } = req.body;
    if (!name || !price || !durationHours || !destinations) {
      res.status(400).json({ message: 'Semua field wajib diisi' });
      return;
    }

    const pkg = await prisma.package.create({
      data: {
        name, price: Number(price), durationHours: Number(durationHours),
        destinations, maxPax: Number(maxPax ?? 6),
        description: description ?? null,
        centerLat: centerLat !== undefined ? Number(centerLat) : null,
        centerLng: centerLng !== undefined ? Number(centerLng) : null,
        radiusKm: radiusKm !== undefined ? Number(radiusKm) : null,
      },
    });
    res.status(201).json(pkg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id', verifyToken, requireRole('admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const { name, price, durationHours, destinations, maxPax, isActive, description, centerLat, centerLng, radiusKm } = req.body;
    const pkg = await prisma.package.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(price !== undefined && { price: Number(price) }),
        ...(durationHours !== undefined && { durationHours: Number(durationHours) }),
        ...(destinations !== undefined && { destinations }),
        ...(maxPax !== undefined && { maxPax: Number(maxPax) }),
        ...(isActive !== undefined && { isActive }),
        ...(description !== undefined && { description }),
        ...(centerLat !== undefined && { centerLat: centerLat !== null ? Number(centerLat) : null }),
        ...(centerLng !== undefined && { centerLng: centerLng !== null ? Number(centerLng) : null }),
        ...(radiusKm !== undefined && { radiusKm: radiusKm !== null ? Number(radiusKm) : null }),
      },
    });
    res.json(pkg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.patch('/:id/toggle', verifyToken, requireRole('admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const pkg = await prisma.package.findUniqueOrThrow({ where: { id } });
    const updated = await prisma.package.update({ where: { id }, data: { isActive: !pkg.isActive } });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
