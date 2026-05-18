import type { Server, Socket } from 'socket.io';
import { prisma } from '../utils/prisma';

export function setupTracking(io: Server): void {
  io.on('connection', (socket: Socket) => {

    // Driver joins their personal room + the broadcast pool when online
    socket.on('driver:join', (driverId: string) => {
      socket.join(`driver:${driverId}`);
    });

    socket.on('driver:go-online', (driverId: string) => {
      socket.join('drivers:online');
      socket.data.driverId = driverId;
    });

    socket.on('driver:go-offline', () => {
      socket.leave('drivers:online');
      delete socket.data.driverId;
    });

    // Driver sends GPS position — save to DB and push to order rooms + admin
    socket.on('driver:update-location', async (data: { driverId: string; lat: number; lng: number }) => {
      try {
        await prisma.driver.update({
          where: { id: data.driverId },
          data: { lat: data.lat, lng: data.lng },
        });

        const activeOrders = await prisma.order.findMany({
          where: {
            driverId: data.driverId,
            status: { in: ['CONFIRMED', 'DRIVER_OTW', 'DRIVER_ARRIVED', 'IN_PROGRESS'] },
          },
          select: { id: true },
        });

        for (const order of activeOrders) {
          io.to(`order:${order.id}`).emit('driver:location', {
            driverId: data.driverId,
            lat: data.lat,
            lng: data.lng,
          });
        }

        io.to('admin').emit('driver:location', { driverId: data.driverId, lat: data.lat, lng: data.lng });
      } catch (err) {
        console.error('Error updating driver location:', err);
      }
    });

    socket.on('order:join', (orderId: string) => {
      socket.join(`order:${orderId}`);
    });

    socket.on('order:leave', (orderId: string) => {
      socket.leave(`order:${orderId}`);
    });

    socket.on('admin:join', () => {
      socket.join('admin');
    });

    socket.on('disconnect', () => {
      // Socket.io handles room cleanup automatically
    });
  });
}
