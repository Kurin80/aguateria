import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Env } from "../env.js";
import type { Database } from "../db/client.js";
import * as t from "../db/schema.js";
import { jsonError } from "./errors.js";

export type FilePurpose = "meter-photo" | "document" | "regulation" | "tax" | "kude" | "expense" | "install-photo" | "disconnect-photo";

export function bucketForPurpose(env: Env, purpose: FilePurpose): string {
  switch (purpose) {
    case "meter-photo":
    case "install-photo":
    case "disconnect-photo":
      return env.STORAGE_BUCKET_PHOTOS;
    case "document":
    case "regulation":
      return env.STORAGE_BUCKET_DOCS;
    case "tax":
      return env.STORAGE_BUCKET_TAX;
    case "kude":
      return env.STORAGE_BUCKET_KUDE;
    case "expense":
      return env.STORAGE_BUCKET_EXPENSES;
    default: {
      const _exhaustive: never = purpose;
      throw jsonError("VALIDATION_ERROR", `Propósito de archivo no soportado: ${_exhaustive}`);
    }
  }
}

export function apiPublicBase(env: Env): string {
  return (env.API_PUBLIC_URL || `http://localhost:${env.API_PORT}`).replace(/\/$/, "");
}

export function localStorageRoot(env: Env): string {
  return resolve(process.cwd(), env.LOCAL_STORAGE_DIR);
}

export function diskPathFor(env: Env, relativePath: string): string {
  return join(localStorageRoot(env), relativePath.replace(/\\/g, "/"));
}

type FileMeta = {
  purpose?: string;
  fileName?: string;
  uploadToken?: string;
  downloadToken?: string;
  tokenExpires?: number;
};

function metaOf(row: { metadata: unknown }): FileMeta {
  return (row.metadata ?? {}) as FileMeta;
}

export async function createSignedUpload(opts: {
  env: Env;
  db: Database;
  companyId: string;
  userId: string;
  purpose: FilePurpose;
  contentType: string;
  fileName: string;
}): Promise<{ fileId: string; uploadUrl: string; path: string; bucket: string }> {
  const bucket = bucketForPurpose(opts.env, opts.purpose);
  const safe = opts.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "file.bin";
  const token = randomUUID();
  const [row] = await opts.db
    .insert(t.files)
    .values({
      companyId: opts.companyId,
      bucket,
      path: "pending",
      mimeType: opts.contentType,
      uploadedBy: opts.userId,
      metadata: {
        purpose: opts.purpose,
        fileName: opts.fileName,
        uploadToken: token,
        tokenExpires: Date.now() + 60 * 60 * 1000,
      },
    })
    .returning();
  if (!row) throw jsonError("UNAVAILABLE", "No se pudo registrar el archivo", 503);
  const path = `${opts.companyId}/${row.id}/${safe}`;
  await opts.db.update(t.files).set({ path }).where(eq(t.files.id, row.id));
  if (opts.env.STORAGE_DRIVER === "supabase") {
    return createSupabaseUpload(opts, row.id, path, bucket);
  }
  return {
    fileId: row.id,
    uploadUrl: `${apiPublicBase(opts.env)}/api/files/${row.id}/content?token=${token}`,
    path,
    bucket,
  };
}

async function createSupabaseUpload(
  opts: {
    env: Env;
    db: Database;
  },
  fileId: string,
  path: string,
  bucket: string,
): Promise<{ fileId: string; uploadUrl: string; path: string; bucket: string }> {
  const { createClient } = await import("@supabase/supabase-js");
  const key = opts.env.SUPABASE_SERVICE_ROLE_KEY || opts.env.SUPABASE_SECRET_KEY;
  if (!opts.env.SUPABASE_URL || !key) {
    throw jsonError("STORAGE_NOT_CONFIGURED", "STORAGE_DRIVER=supabase requiere SUPABASE_URL y clave de servidor", 503);
  }
  const client = createClient(opts.env.SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) {
    throw jsonError("UNAVAILABLE", error?.message ?? "No se pudo firmar la subida a Storage", 503);
  }
  return { fileId, uploadUrl: data.signedUrl, path, bucket };
}

export async function saveLocalFile(opts: {
  env: Env;
  db: Database;
  fileId: string;
  token?: string;
  body: Buffer;
}): Promise<void> {
  const [file] = await opts.db.select().from(t.files).where(eq(t.files.id, opts.fileId)).limit(1);
  if (!file) throw jsonError("NOT_FOUND", "Archivo no encontrado", 404);
  const meta = metaOf(file);
  if (!opts.token || meta.uploadToken !== opts.token || (meta.tokenExpires ?? 0) < Date.now()) {
    throw jsonError("UNAUTHORIZED", "Token de subida inválido o vencido", 401);
  }
  const full = diskPathFor(opts.env, file.path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, opts.body);
  await opts.db
    .update(t.files)
    .set({
      sizeBytes: opts.body.length,
      metadata: { ...meta, uploadToken: undefined },
    })
    .where(eq(t.files.id, file.id));
}

export async function createSignedDownload(opts: {
  env: Env;
  db: Database;
  companyId: string;
  fileId: string;
}): Promise<{ downloadUrl: string; mimeType: string; path: string }> {
  const [file] = await opts.db.select().from(t.files).where(eq(t.files.id, opts.fileId)).limit(1);
  if (!file || file.companyId !== opts.companyId) {
    throw jsonError("NOT_FOUND", "Archivo no encontrado", 404);
  }
  if (opts.env.STORAGE_DRIVER === "supabase") {
    const { createClient } = await import("@supabase/supabase-js");
    const key = opts.env.SUPABASE_SERVICE_ROLE_KEY || opts.env.SUPABASE_SECRET_KEY;
    if (!opts.env.SUPABASE_URL || !key) throw jsonError("STORAGE_NOT_CONFIGURED", "Storage remoto no configurado", 503);
    const client = createClient(opts.env.SUPABASE_URL, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.storage.from(file.bucket).createSignedUrl(file.path, 120);
    if (error || !data?.signedUrl) {
      throw jsonError("UNAVAILABLE", error?.message ?? "No se pudo firmar la descarga", 503);
    }
    return { downloadUrl: data.signedUrl, mimeType: file.mimeType, path: file.path };
  }
  const token = randomUUID();
  const meta = metaOf(file);
  await opts.db
    .update(t.files)
    .set({ metadata: { ...meta, downloadToken: token, tokenExpires: Date.now() + 120_000 } })
    .where(eq(t.files.id, file.id));
  return {
    downloadUrl: `${apiPublicBase(opts.env)}/api/files/${file.id}/download?token=${token}`,
    mimeType: file.mimeType,
    path: file.path,
  };
}

export async function readLocalFile(opts: {
  env: Env;
  db: Database;
  fileId: string;
  token?: string;
  companyId?: string;
}): Promise<{ body: Buffer; mimeType: string; fileName: string }> {
  const [file] = await opts.db.select().from(t.files).where(eq(t.files.id, opts.fileId)).limit(1);
  if (!file) throw jsonError("NOT_FOUND", "Archivo no encontrado", 404);
  const meta = metaOf(file);
  const tokenOk = opts.token && meta.downloadToken === opts.token && (meta.tokenExpires ?? 0) >= Date.now();
  const ownerOk = opts.companyId && file.companyId === opts.companyId;
  if (!tokenOk && !ownerOk) throw jsonError("UNAUTHORIZED", "No autorizado a descargar", 401);
  const body = await readFile(diskPathFor(opts.env, file.path));
  return { body, mimeType: file.mimeType, fileName: meta.fileName ?? "archivo" };
}
