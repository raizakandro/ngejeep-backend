import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

import authRoutes from './routes/auth';
import packageRoutes from './routes/packages';
import orderRoutes from './routes/orders';
import driverRoutes from './routes/drivers';
import { setupTracking } from './socket/tracking';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] },
});

app.use(cors());
app.use(express.json());

app.set('io', io);

app.use('/auth', authRoutes);
app.use('/packages', packageRoutes);
app.use('/orders', orderRoutes);
app.use('/drivers', driverRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

setupTracking(io);

const PORT = process.env.PORT ?? 3000;
httpServer.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});
