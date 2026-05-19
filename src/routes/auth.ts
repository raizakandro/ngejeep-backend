import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';

const router = Router();

router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, phone, email, password } = req.body;
    if (!phone || !password) {
      res.status(400).json({ message: 'Nomor HP dan password wajib diisi' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      res.status(409).json({ message: 'Nomor HP sudah terdaftar' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name: name ?? phone, phone, email, passwordHash, role: 'customer' },
      select: { id: true, name: true, phone: true, email: true, role: true, photoUrl: true, pushToken: true, createdAt: true },
    });

    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: '30d' });
    res.status(201).json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      res.status(400).json({ message: 'Nomor HP dan password wajib diisi' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { phone },
      include: { driver: true },
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ message: 'Nomor HP atau password salah' });
      return;
    }

    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: '30d' });
    const { passwordHash, driver, ...userWithoutPassword } = user;
    res.json({ token, user: userWithoutPassword, driver: driver ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.patch('/push-token', verifyToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { pushToken } = req.body;
    await prisma.user.update({ where: { id: req.user!.userId }, data: { pushToken } });
    res.json({ message: 'Push token updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
