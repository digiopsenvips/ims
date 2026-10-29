import dotenv from 'dotenv';
dotenv.config();

export const ENV = {
  PORT: parseInt(process.env.PORT || '5001', 10),
  JWT_SECRET: process.env.JWT_SECRET || '',
  DATABASE_URL: process.env.DATABASE_URL || '',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
};

export function validateRuntimeConfiguration() {
  if (!ENV.DATABASE_URL || ENV.JWT_SECRET.length < 32 || ENV.JWT_SECRET === 'enactus-vips-tc-jwt-secret-secure-key') {
    throw new Error('Database and a private signing key must be verified before startup. No secrets or database settings were changed automatically.');
  }
}
