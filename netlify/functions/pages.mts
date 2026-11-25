import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";

const db = getDatabase();

interface ElnPagePayload {
  id: string;
  title?: string;
  notionUrl?: string;
  scale?: string;
  reagents?: unknown[];
  solvents?: unknown[];
  results?: unknown[];
  createdAt?: number;
  updatedAt?: number;
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

function sanitizePage(raw: unknown, fallbackId?: string): ElnPagePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id =
    typeof obj.id === "string" && obj.id.trim()
      ? obj.id.trim()
      : fallbackId && fallbackId.trim()
      ? fallbackId.trim()
      : "";
  if (!id || id.length > 160) return null;

  const now = Date.now();
  const createdAt = Number.isFinite(Number(obj.createdAt)) ? Math.trunc(Number(obj.createdAt)) : now;
  const updatedAt = Number.isFinite(Number(obj.updatedAt)) ? Math.trunc(Number(obj.updatedAt)) : now;

  return {
    id,
    title: typeof obj.title === "string" ? obj.title : "",
    notionUrl: typeof obj.notionUrl === "string" ? obj.notionUrl : "",
    scale: obj.scale !== undefined && obj.scale !== null ? String(obj.scale) : "",
    reagents: Array.isArray(obj.reagents) ? obj.reagents : [],
    solvents: Array.isArray(obj.solvents) ? obj.solvents : [],
    results: Array.isArray(obj.results) ? obj.results : [],
    createdAt,
    updatedAt,
  };
}

export default async (req: Request, context: Context): Promise<Response> => {
  // Privateプロジェクト / チームログイン保護された Netlify ユーザーを検証
  if (!context.user) {
    return jsonResponse(
      {
        error: "Netlify プロジェクトを非公開 (Private) 設定にし、ログインした状態でアクセスしてください。",
        code: "AUTH_REQUIRED",
      },
      401
    );
  }

  const ownerId = context.user.id;
  const paramId = context.params?.id ? decodeURIComponent(context.params.id) : "";

  try {
    // 1. 全ページ取得: GET /api/pages
    if (req.method === "GET" && !paramId) {
      const rows = await db.sql<{ payload: ElnPagePayload }>`
        SELECT payload
        FROM eln_pages
        WHERE owner_id = ${ownerId}
        ORDER BY updated_at DESC
      `;
      const pages = rows.map((row) =>
        typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload
      );
      return jsonResponse({
        pages,
        user: {
          id: context.user.id,
          email: context.user.email ?? null,
        },
      });
    }

    // 2. 単一ページ保存 (Upsert): PUT /api/pages/:id
    if (req.method === "PUT" && paramId) {
      const body = await req.json();
      const page = sanitizePage(body, paramId);
      if (!page) {
        return jsonResponse({ error: "Invalid page payload" }, 400);
      }
      page.id = paramId;
      const payloadJson = JSON.stringify(page);

      await db.sql`
        INSERT INTO eln_pages (id, owner_id, title, payload, updated_at, created_at)
        VALUES (${page.id}, ${ownerId}, ${page.title ?? ""}, ${payloadJson}::jsonb, ${page.updatedAt}, ${page.createdAt})
        ON CONFLICT (owner_id, id)
        DO UPDATE SET
          title = EXCLUDED.title,
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
      `;
      return jsonResponse({ ok: true, id: page.id, updatedAt: page.updatedAt });
    }

    // 3. 一括同期 / バックアップ復元 (トランザクション): POST /api/pages
    if (req.method === "POST" && !paramId) {
      const body = (await req.json()) as { mode?: string; pages?: unknown[] };
      const mode = body.mode === "replace" ? "replace" : "merge";
      const rawPages = Array.isArray(body.pages) ? body.pages : [];
      const sanitizedPages = rawPages
        .map((p) => sanitizePage(p))
        .filter((p): p is ElnPagePayload => p !== null);

      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        if (mode === "replace") {
          await client.query("DELETE FROM eln_pages WHERE owner_id = $1", [ownerId]);
        }
        for (const page of sanitizedPages) {
          await client.query(
            `
            INSERT INTO eln_pages (id, owner_id, title, payload, updated_at, created_at)
            VALUES ($1, $2, $3, $4::jsonb, $5, $6)
            ON CONFLICT (owner_id, id)
            DO UPDATE SET
              title = EXCLUDED.title,
              payload = EXCLUDED.payload,
              updated_at = EXCLUDED.updated_at
            `,
            [
              page.id,
              ownerId,
              page.title ?? "",
              JSON.stringify(page),
              page.updatedAt,
              page.createdAt,
            ]
          );
        }
        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
      } finally {
        client.release();
      }

      return jsonResponse({ ok: true, count: sanitizedPages.length, mode });
    }

    // 4. ページ削除: DELETE /api/pages/:id
    if (req.method === "DELETE" && paramId) {
      await db.sql`
        DELETE FROM eln_pages
        WHERE owner_id = ${ownerId} AND id = ${paramId}
      `;
      return jsonResponse({ ok: true, id: paramId });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("pages function error:", err);
    return jsonResponse({ error: "データベース処理中にエラーが発生しました" }, 500);
  }
};

export const config: Config = {
  path: ["/api/pages", "/api/pages/:id"],
};
