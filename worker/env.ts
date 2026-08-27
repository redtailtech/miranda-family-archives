// Side-effecting env loader. Must be the FIRST import in any worker entry point:
// ES module imports evaluate in textual order among themselves (depth-first) before
// any other top-level code in the importing file runs, so a plain `dotenv.config()`
// call placed after other imports (even textually before them) can run too late —
// modules like `@/lib/s3` read `process.env.*` into top-level `const`s at import time.
// pg-boss config lives in `.env` (DATABASE_URL); S3 config lives in `.env.local` (AWS_*).
// `dotenv/config` alone only loads `.env`, so load both explicitly.
import dotenv from 'dotenv'

dotenv.config({ path: ['.env', '.env.local'], quiet: true })
