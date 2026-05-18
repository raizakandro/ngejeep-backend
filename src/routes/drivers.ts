import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../utils/prisma';
import { verifyToken, requireRole, AuthRequest } from '../middleware/verifyToken';

const router = Router();

router.get('/', verifyToken, requireRole('admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const drivers = await prisma.driver.findMany({
      include: { user: { select: { id: true, name: true, phone: true, photoUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(drivers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/available', verifyToken, requireRole('admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const drivers = await prisma.driver.findMany({
      where: { status: 'online' },
      include: { user: { select: { id: true, name: true, phone: true, photoUrl: true } } },
    });
    res.json(drivers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/', verifyToken, requireRole('admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, phone, password, vehicleName, vehiclePlate, qrisImageUrl } = req.body;
    if (!name || !phone || !password || !vehicleName || !vehiclePlate) {
      res.status(400).json({ message: 'Semua field wajib diisi' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      res.status(409).json({ message: 'Nomor HP sudah terdaftar' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { name, phone, passwordHash, role: 'driver' } });
    const driver = await prisma.driver.create({
      data: { userId: user.id, vehicleName, vehiclePlate, qrisImageUrl: qrisImageUrl ?? null },
      include: { user: { select: { id: true, name: true, phone: true, photoUrl: true } } },
    });
    res.status(201).json(driver);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.patch('/:id/status', verifyToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const { status } = req.body;
    const allowed = ['online', 'offline', 'busy'];
    if (!allowed.includes(status)) {
      res.status(400).json({ message: 'Status tidak valid' });
      return;
    }

    const driver = await prisma.driver.findUniqueOrThrow({ where: { id } });
    if (req.user!.role !== 'admin' && driver.userId !== req.user!.userId) {
      res.status(403).json({ message: 'Akses ditolak' });
      return;
    }

    const updated = await prisma.driver.update({ where: { id }, data: { status } });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.patch('/:id', verifyToken, requireRole('admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const { vehicleName, vehiclePlate, qrisImageUrl } = req.body;
    const driver = await prisma.driver.update({
      where: { id },
      data: {
        ...(vehicleName !== undefined && { vehicleName }),
        ...(vehiclePlate !== undefined && { vehiclePlate }),
        ...(qrisImageUrl !== undefined && { qrisImageUrl }),
      },
      include: { user: { select: { id: true, name: true, phone: true, photoUrl: true } } },
    });
    res.json(driver);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
