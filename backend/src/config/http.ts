import { CorsOptions } from 'cors';
import { ENV } from './env';

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    const origins = new Set(['https://ims-ecru-three.vercel.app', ...(ENV.CORS_ORIGIN || '').split(',').map(v => v.trim()).filter(Boolean)]);
    callback(null, !origin || origins.has(origin));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
