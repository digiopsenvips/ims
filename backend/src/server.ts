import express from 'express';
import http from 'http';
import cors from 'cors';
import { ENV } from './config/env';
import { initSockets } from './sockets';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import projectRoutes from './routes/projects';
import productRoutes from './routes/products';
import inventoryRoutes from './routes/inventory';
import eventRoutes from './routes/events';
import salesRoutes from './routes/sales';
import analyticsRoutes from './routes/analytics';
import gameRoutes from './routes/games';

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
initSockets(server);

// Middleware
app.use(
  cors({
    origin: '*', // Local dev & preview
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json());

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Enactus VIPS-TC Inventory & Sales Management System',
    timestamp: new Date().toISOString(),
  });
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/products', productRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/games', gameRoutes);

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled server error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});

import { reconcileAllExpiredEvents } from './services/eventLifecycle';

server.listen(ENV.PORT, () => {
  console.log(`🚀 Enactus IMS Backend running on http://localhost:${ENV.PORT}`);
  console.log(`📡 WebSocket server mounted and ready`);

  // Initial event lifecycle reconciliation on boot
  reconcileAllExpiredEvents()
    .then(count => {
      if (count > 0) {
        console.log(`[EventLifecycle] Reconciled ${count} expired/transitioned event(s) on startup.`);
      }
    })
    .catch(err => console.error('[EventLifecycle] Startup reconciliation error:', err));

  // Periodic lifecycle check every 30 seconds
  setInterval(() => {
    reconcileAllExpiredEvents().catch(err =>
      console.error('[EventLifecycle] Periodic reconciliation error:', err)
    );
  }, 30000);
});

export { app, server };
