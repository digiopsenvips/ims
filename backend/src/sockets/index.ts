import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { userForToken } from '../middleware/auth';
import { corsOptions } from '../config/http';
let io: SocketIOServer | null = null;
export const initSockets = (httpServer: HttpServer): SocketIOServer => {
  io = new SocketIOServer(httpServer, { cors: corsOptions });
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') throw new Error('Session required');
      await userForToken(token);
      const decoded = jwt.decode(token) as { exp?: number } | null;
      if (decoded?.exp) {
        const timer = setTimeout(() => socket.disconnect(true), Math.max(0, decoded.exp * 1000 - Date.now()));
        socket.once('disconnect', () => clearTimeout(timer));
      }
      next();
    } catch { next(new Error('Valid session required')); }
  });
  return io;
};
export const getIO = () => io;
// Refresh signals contain no seller, receipt, revenue, allocation or cross-event records.
// Clients fetch their authorized projections from the HTTP API after an invalidation.
export const broadcast = (event: string, _data: any) => { io?.emit(event, { action: 'refresh' }); };
