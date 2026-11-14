/**
 * Runs the database-backed suites against a throwaway Postgres started from the embedded-postgres
 * binary: no Docker, no root, and never the .env or a remote database. One cluster at a time.
 *
 * Usage: npm run test:db [-- <vitest args>]
 */
import EmbeddedPostgres from 'embedded-postgres';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DB_NAME = 'docnow_test';
const USER = 'postgres';
const PASSWORD = 'postgres';
const serverDir = new URL('..', import.meta.url).pathname;
const MIGRATIONS_DIR = join(serverDir, 'prisma', 'migrations');
const SHIMS = [join('prisma', 'test-shims', 'pgvector-free.sql'), join('prisma', 'test-shims', 'schema-drift.sql')];

async function freePort() {
    return new Promise((resolve, reject) => {
        const probe = createServer();
        probe.unref();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

function run(command, args, env) {
    return new Promise((resolve) => {
        const child = spawn(command, args, { cwd: serverDir, stdio: 'inherit', env: { ...process.env, ...env } });
        child.on('close', (code) => resolve(code ?? 1));
        child.on('error', () => resolve(1));
    });
}

/** Migrations that need pgvector, which the embedded binary does not ship. */
async function pgvectorMigrations() {
    const names = (await readdir(MIGRATIONS_DIR, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    const needing = [];
    for (const name of names) {
        const sql = await readFile(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8').catch(() => '');
        if (/\bEXTENSION\b[^;]*\bvector\b|\bvector\s*\(\s*\d+\s*\)|\bhnsw\b/i.test(sql)) needing.push(name);
    }
    return needing;
}

let pg = null;
let dataDir = null;

async function cleanup() {
    if (pg) {
        await pg.stop().catch(() => undefined);
        pg = null;
    }
    if (dataDir) {
        await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
        dataDir = null;
    }
}

async function main() {
    const port = await freePort();
    dataDir = await mkdtemp(join(tmpdir(), 'docnow-testdb-'));

    pg = new EmbeddedPostgres({
        databaseDir: dataDir,
        port,
        user: USER,
        password: PASSWORD,
        persistent: false,
        autoRehydrateSymlinks: true,
        // initdb and postgres are chatty on success; only surface real failures.
        onLog: () => undefined,
        onError: (message) => process.stderr.write(`${message}\n`),
    });

    console.log(`[test:db] starting Postgres on 127.0.0.1:${port} (data dir ${dataDir})`);
    await pg.initialise();
    await pg.start();
    await pg.createDatabase(DB_NAME);

    const url = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${port}/${DB_NAME}?schema=public`;

    const dbEnv = { DATABASE_URL: url, TEST_DATABASE_URL: url };

    for (const name of await pgvectorMigrations()) {
        console.log(`[test:db] marking ${name} applied; it needs pgvector`);
        const stamped = await run('npx', ['prisma', 'migrate', 'resolve', '--applied', name], dbEnv);
        if (stamped !== 0) return stamped;
    }

    console.log('[test:db] applying migrations');
    const migrated = await run('npx', ['prisma', 'migrate', 'deploy'], dbEnv);
    if (migrated !== 0) return migrated;

    for (const shim of SHIMS) {
        const applied = await run('npx', ['prisma', 'db', 'execute', '--file', shim, '--schema', 'prisma/schema.prisma'], dbEnv);
        if (applied !== 0) return applied;
    }

    console.log('[test:db] running vitest');
    return run('npx', ['vitest', 'run', ...process.argv.slice(2)], dbEnv);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
        await cleanup();
        process.exit(130);
    });
}

try {
    process.exitCode = await main();
} catch (err) {
    console.error('[test:db] failed:', err?.message ?? err);
    process.exitCode = 1;
} finally {
    await cleanup();
}
