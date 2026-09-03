import { argon2id } from "hash-wasm";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await argon2id({
    password,
    salt,
    parallelism: 1,
    iterations: 3,
    memorySize: 16384,
    hashLength: 32,
    outputType: "hex",
  });
  return `argon2id$${salt.toString("hex")}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "argon2id" || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const computed = await argon2id({
    password,
    salt,
    parallelism: 1,
    iterations: 3,
    memorySize: 16384,
    hashLength: 32,
    outputType: "hex",
  });
  const a = Buffer.from(hashHex, "hex");
  const b = Buffer.from(computed, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}
