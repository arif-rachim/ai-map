import path from 'node:path';
import { importAirportsIfEmpty } from './airports.js';
import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate, pool } from './db.js';

const app = await buildApp();
await migrate();
await importAirportsIfEmpty(path.join(config.dataDir, 'airports', 'airports.csv'), (m) => app.log.info(m));
await app.listen({ port: config.port, host: config.host });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
