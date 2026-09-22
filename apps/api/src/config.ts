export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://aimap:aimap@localhost:5432/aimap',
  /** Root of the offline data bundle (tiles/, airports/, ...). */
  dataDir: process.env.DATA_DIR ?? '../../dist-data',
  photonUrl: process.env.PHOTON_URL ?? 'http://localhost:2322',
  /** Public base URL used in TileJSON / style / OGC links, e.g. http://maps.example.local (default: from request). */
  publicUrl: process.env.PUBLIC_URL ?? '',
  migrationsDir: process.env.MIGRATIONS_DIR ?? new URL('../migrations', import.meta.url).pathname,
};
