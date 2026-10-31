// Manual run: `npm run job:checkout` (or `docker compose exec api npm run job:checkout`).
import { pool } from '../db.js';
import { processDailyCheckout } from './checkout.js';

try {
  console.log(await processDailyCheckout());
} finally {
  await pool.end();
}
