import type { Context } from 'hono';

/**
 * 將 D1 / SQLite 錯誤轉成可讀 JSON，方便 Pages 上除錯（避免只有 HTTP 500 無內容）。
 */
export function jsonDbError(c: Context, error: unknown) {
  const msg = String(error);
  const looksLikeSchemaOrSql =
    msg.includes('no such table') ||
    msg.includes('SQLITE_ERROR') ||
    msg.includes('D1_ERROR') ||
    msg.includes('SQLITE_CANTOPEN');

  const status = looksLikeSchemaOrSql ? 503 : 500;
  const body: Record<string, unknown> = { success: false, error: msg };
  if (looksLikeSchemaOrSql) {
    body.hint =
      '遠端 D1 可能尚未套用 migration 或 seed。請在本機執行：npm run db:migrate:remote && npm run db:seed:remote（需 wrangler login，且 wrangler.jsonc 的 database 指向正確）';
  }
  return c.json(body, status);
}
