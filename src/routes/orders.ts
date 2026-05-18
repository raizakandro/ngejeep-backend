import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { verifyToken, requireRole, AuthRequest } from '../middleware/verifyToken';
import { generateOrderCode, sendPushNotification } from '../utils/helpers';
import type { Server } from 'socket.io';

const router = Router();

const orderInclude = {
  customer: { select: { id: true, name: true, phone: true, photoUrl: true, pushToken: true } },
  driver: {
    include: {
      user: { select: { id: true, name: true, phone: true, photoUrl: true, pushToken: true } },
    },
  },
  package: true,
  payment: true,
  review: true,
} satisfies Prisma.OrderInclude;

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

// Haversine distance in km
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function notifyOnStatusChange(order: OrderWithRelations, status: string): Promise<void> {
  const customerToken = order.customer.pushToken;

  if (status === 'CONFIRMED' && customerToken) {
    await sendPushNotification(customerToken, 'Order Dikonfirmasi', 'Driver sedang menuju ke titik jemputmu!');
  } else if (status === 'DRIVER_OTW' && customerToken) {
    await sendPushNotification(customerToken, 'Driver Menuju Lokasi', 'Driver sedang dalam perjalanan ke titik jemputmu.');
  } else if (status === 'DRIVER_ARRIVED' && customerToken) {
    await sendPushNotification(customerToken, 'Driver Sudah Tiba', 'Driver sudah tiba di titik jemput!');
  } else if (status === 'COMPLETED') {
    if (customerToken) {
      await sendPushNotification(customerToken, 'Tour Selesai', 'Terima kasih telah menggunakan layanan jeep tour kami!');
    }
    if (order.driver) {
      await prisma.driver.update({
        where: { id: order.driverId! },
        data: { status: 'online', totalTrips: { increment: 1 } },
      });
    }
  }
}

// Customer creates order — validate radius, broadcast to online drivers
router.post('/', verifyToken, requireRole('customer'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { packageId, pickupLat, pickupLng, pickupAddress, scheduledAt, pax, paymentMethod } = req.body;
    if (!packageId || pickupLat === undefined || pickupLng === undefined || !pickupAddress || !scheduledAt || !pax || !paymentMethod) {
      res.status(400).json({ message: 'Semua field wajib diisi' });
      return;
    }

    const pkg = await prisma.package.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.isActive) {
      res.status(404).json({ message: 'Paket tidak ditemukan atau tidak aktif' });
      return;
    }

    // Validate pickup within service area radius
    if (pkg.centerLat !== null && pkg.centerLng !== null && pkg.radiusKm !== null) {
      const dist = haversineKm(Number(pickupLat), Number(pickupLng), pkg.centerLat, pkg.centerLng);
      if (dist > pkg.radiusKm) {
        res.status(400).json({
          message: `Titik penjemputan di luar area layanan paket ini (radius ${pkg.radiusKm} km). Jarak kamu: ${dist.toFixed(1)} km.`,
        });
        return;
      }
    }

    const order = await prisma.order.create({
      data: {
        orderCode: generateOrderCode(),
        customerId: req.user!.userId,
        packageId,
        pickupLat: Number(pickupLat),
        pickupLng: Number(pickupLng),
        pickupAddress,
        scheduledAt: new Date(scheduledAt),
        pax: Number(pax),
        totalPrice: pkg.price,
        paymentMethod,
      },
      include: orderInclude,
    });

    // Broadcast to all online drivers
    const io: Server = req.app.get('io');
    io.to('drivers:online').emit('order:broadcast', order);
    io.to('admin').emit('order:new', order);

    res.status(201).json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Driver accepts a broadcast order (first come first served)
router.post('/:id/accept', verifyToken, requireRole('driver'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const driverRecord = await prisma.driver.findUnique({ where: { userId: req.user!.userId } });
    if (!driverRecord) { res.status(404).json({ message: 'Driver tidak ditemukan' }); return; }
    if (driverRecord.status !== 'online') { res.status(400).json({ message: 'Driver harus dalam status online' }); return; }

    // Atomic: only update if order is still PENDING (no driver yet)
    const updated = await prisma.order.updateMany({
      where: { id, status: 'PENDING', driverId: null },
      data: { driverId: driverRecord.id, status: 'CONFIRMED' },
    });

    if (updated.count === 0) {
      res.status(409).json({ message: 'Order sudah diambil driver lain' });
      return;
    }

    await prisma.driver.update({ where: { id: driverRecord.id }, data: { status: 'busy' } });

    const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });

    const io: Server = req.app.get('io');
    // Tell all drivers the order is no longer available
    io.to('drivers:online').emit('order:taken', { orderId: id });
    io.to(`order:${id}`).emit('order:updated', order);
    io.to('admin').emit('admin:order-update', order);

    if (order?.customer.pushToken) {
      await sendPushNotification(order.customer.pushToken, 'Driver Ditemukan!', `${driverRecord.vehicleName} (${driverRecord.vehiclePlate}) sedang menuju ke kamu.`);
    }

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/', verifyToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { role, userId } = req.user!;
    let where: Prisma.OrderWhereInput = {};

    if (role === 'customer') {
      where = { customerId: userId };
    } else if (role === 'driver') {
      const driver = await prisma.driver.findUnique({ where: { userId } });
      if (!driver) { res.json([]); return; }
      where = { driverId: driver.id };
    }

    const orders = await prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
    });
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Pending orders visible to online drivers (for catching up after reconnect)
router.get('/pending', verifyToken, requireRole('driver'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const orders = await prisma.order.findMany({
      where: { status: 'PENDING', driverId: null },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
    });
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/stats/today', verifyToken, requireRole('admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [totalOrders, completedOrders, onlineDrivers, revenue] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
      prisma.order.count({ where: { createdAt: { gte: today, lt: tomorrow }, status: 'COMPLETED' } }),
      prisma.driver.count({ where: { status: 'online' } }),
      prisma.order.aggregate({
        where: { createdAt: { gte: today, lt: tomorrow }, status: 'COMPLETED' },
        _sum: { totalPrice: true },
      }),
    ]);

    res.json({ totalOrders, completedOrders, onlineDrivers, revenue: revenue._sum.totalPrice ?? 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', verifyToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const order = await prisma.order.findUniqueOrThrow({ where: { id }, include: orderInclude });
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(404).json({ message: 'Order tidak ditemukan' });
  }
});

router.patch('/:id/status', verifyToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const { status } = req.body;
    const order = await prisma.order.update({
      where: { id },
      data: { status },
      include: orderInclude,
    });

    const io: Server = req.app.get('io');
    io.to(`order:${order.id}`).emit('order:updated', order);
    io.to('admin').emit('admin:order-update', order);

    await notifyOnStatusChange(order, status);

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.patch('/:id/assign', verifyToken, requireRole('admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const { driverId } = req.body;
    if (!driverId) { res.status(400).json({ message: 'Driver ID wajib diisi' }); return; }

    const order = await prisma.order.update({
      where: { id },
      data: { driverId, status: 'CONFIRMED' },
      include: orderInclude,
    });

    await prisma.driver.update({ where: { id: driverId }, data: { status: 'busy' } });

    const io: Server = req.app.get('io');
    io.to(`driver:${driverId}`).emit('order:broadcast', order);
    io.to(`order:${order.id}`).emit('order:updated', order);
    io.to('admin').emit('admin:order-update', order);

    if (order.customer.pushToken) {
      await sendPushNotification(order.customer.pushToken, 'Order Dikonfirmasi', 'Driver telah ditugaskan untuk tour kamu!');
    }

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/:id/payment', verifyToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const { method, amount } = req.body;
    const payment = await prisma.payment.create({
      data: {
        orderId: id,
        method,
        amount: Number(amount),
        status: 'confirmed',
        confirmedBy: req.user!.userId,
        confirmedAt: new Date(),
      },
    });

    const order = await prisma.order.update({
      where: { id },
      data: { paymentStatus: 'confirmed', status: 'COMPLETED' },
      include: orderInclude,
    });

    const io: Server = req.app.get('io');
    io.to(`order:${id}`).emit('order:updated', order);
    io.to('admin').emit('admin:order-update', order);

    res.status(201).json(payment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/:id/review', verifyToken, requireRole('customer'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const { rating, comment } = req.body;
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });

    const review = await prisma.review.create({
      data: { orderId: id, customerId: req.user!.userId, driverId: order.driverId!, rating: Number(rating), comment },
    });

    const allReviews = await prisma.review.findMany({ where: { driverId: order.driverId! } });
    const avgRating = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;
    await prisma.driver.update({ where: { id: order.driverId! }, data: { rating: avgRating } });

    res.status(201).json(review);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
