function assertDisposableDatabase(env) {
  if (env.NODE_ENV === 'production' || env.IMS_ALLOW_DISPOSABLE_DATABASE !== '1') {
    throw new Error('Schema push, seed and reset are disabled for operational databases. An explicitly disposable synthetic database is required.');
  }
  const target = new URL(env.DATABASE_URL || '');
  if (target.hostname !== '127.0.0.1' || target.port !== '55439' || target.username !== 'ims_test' || !target.pathname.startsWith('/ims_synthetic_')) {
    throw new Error('Refusing maintenance outside the isolated local synthetic cluster. No database operation was run.');
  }
}
module.exports = { assertDisposableDatabase };
if (require.main === module) {
  try { assertDisposableDatabase(process.env); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
