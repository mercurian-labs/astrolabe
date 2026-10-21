// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - throwaway stand-in, replaced by apps/cloud.
/**
 * Stand-in for the cloud API until apps/cloud lands on this branch. It proves
 * the stack's wiring: the service reaches Postgres and Electric, and the
 * load balancer's health check passes. Delete it when the real API replaces it.
 */
import * as NodeHttp from "node:http";

import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
const electricUrl = process.env.ELECTRIC_URL;
if (!databaseUrl || !electricUrl) throw new Error("DATABASE_URL and ELECTRIC_URL are required");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

const check = async () => {
  const tables = await pool.query<{ count: string }>(
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'",
  );
  const electric = await fetch(new URL("/v1/health", electricUrl));
  return {
    database: { tables: Number(tables.rows[0]?.count ?? 0) },
    electric: { status: electric.status, body: await electric.json() },
  };
};

NodeHttp.createServer((request, response) => {
  if (request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  check().then(
    (body) => {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    },
    (error: unknown) => {
      response.writeHead(503, { "content-type": "text/plain" }).end(String(error));
    },
  );
}).listen(Number(process.env.PORT ?? 4310));
