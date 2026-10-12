export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://aimap:aimap@localhost:5432/aimap',
  /** Root of the offline data bundle (tiles/, airports/, ...). */
  dataDir: process.env.DATA_DIR ?? '../../dist-data',
  photonUrl: process.env.PHOTON_URL ?? 'http://localhost:2322',
  /** Public base URL used in TileJSON / style / OGC links, e.g. http://maps.example.local (default: from request). */
  publicUrl: process.env.PUBLIC_URL ?? '',
  /** Password for admin login in the web app; empty disables editing for everyone. */
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  /** Static bearer token for other applications that write layers/drawings; empty disables it. */
  adminApiToken: process.env.ADMIN_API_TOKEN ?? '',
  /** Key for signing admin sessions; random per process when empty (sessions then end on restart). */
  authSecret: process.env.AUTH_SECRET ?? '',
  sessionHours: Number(process.env.ADMIN_SESSION_HOURS ?? 12),
  migrationsDir: process.env.MIGRATIONS_DIR ?? new URL('../migrations', import.meta.url).pathname,
};
