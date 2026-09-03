import { Hono } from "hono";
import { loadEnv } from "../env.js";
import { getDb } from "../db/client.js";
import type { AppEnv } from "../http/types.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { readLocalFile, saveLocalFile } from "../lib/storage.js";

export function fileContentRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // Estas rutas sólo aplican al driver de disco local. Con STORAGE_DRIVER=supabase
  // el cliente sube/descarga contra URLs firmadas de Supabase Storage.
  r.use("/files/:id/content", async (c, next) => {
    if (loadEnv().STORAGE_DRIVER !== "local") {
      return c.json({ error: { code: "STORAGE_NOT_LOCAL", message: "Storage remoto: usá la URL firmada" } }, 409);
    }
    await next();
  });
  r.use("/files/:id/download", async (c, next) => {
    if (loadEnv().STORAGE_DRIVER !== "local") {
      return c.json({ error: { code: "STORAGE_NOT_LOCAL", message: "Storage remoto: usá la URL firmada" } }, 409);
    }
    await next();
  });

  r.put("/files/:id/content", async (c) => {
    const env = loadEnv();
    const body = Buffer.from(await c.req.arrayBuffer());
    await saveLocalFile({
      env,
      db: c.get("db") ?? getDb(),
      fileId: c.req.param("id"),
      token: c.req.query("token"),
      body,
    });
    return c.json({ data: { ok: true } });
  });

  r.get("/files/:id/download", async (c) => {
    const env = loadEnv();
    let companyId: string | undefined;
    const header = c.req.header("Authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (bearer) {
      try {
        companyId = (await verifyAccessToken(bearer)).companyId;
      } catch {
        companyId = undefined;
      }
    }
    const file = await readLocalFile({
      env,
      db: c.get("db") ?? getDb(),
      fileId: c.req.param("id"),
      token: c.req.query("token"),
      companyId,
    });
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `inline; filename="${file.fileName.replace(/"/g, "")}"`,
      },
    });
  });

  return r;
}
