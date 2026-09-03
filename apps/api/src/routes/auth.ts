import { zValidator } from "@hono/zod-validator";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { loginAttempts, passwordResetTokens, refreshTokens, users } from "../db/schema.js";
import { loadEnv } from "../env.js";
import { authenticate } from "../http/auth.js";
import { clientIp, rateLimit } from "../http/rate-limit.js";
import type { AppEnv } from "../http/types.js";
import { jsonError } from "../lib/errors.js";
import { signAccessToken } from "../lib/jwt.js";
import { hashPassword, randomToken, sha256, verifyPassword } from "../lib/password.js";
import { audit } from "../lib/audit.js";
import { mailerConfigured, sendMail } from "../lib/mailer.js";

const loginSchema = z.object({
  identifier: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
  deviceId: z.string().max(200).optional(),
});

export function authRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const env = loadEnv();

  r.post(
    "/login",
    rateLimit((c) => `login:${clientIp(c)}`, 20, 300),
    zValidator("json", loginSchema),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");
      const identifier = body.identifier.trim().toLowerCase();
      const ip = clientIp(c);

      const [user] = await db
        .select()
        .from(users)
        .where(
          and(
            isNull(users.deletedAt),
            or(sql`lower(${users.email}) = ${identifier}`, sql`lower(${users.username}) = ${identifier}`),
          ),
        )
        .limit(1);

      await db.insert(loginAttempts).values({
        companyId: user?.companyId,
        identifier,
        ip,
        success: false,
      });

      if (!user || !user.active) {
        throw jsonError("UNAUTHORIZED", "Credenciales inválidas", 401);
      }
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        throw jsonError("ACCOUNT_LOCKED", "Cuenta bloqueada temporalmente", 423);
      }

      const ok = await verifyPassword(body.password, user.passwordHash);
      if (!ok) {
        const fails = user.failedLoginCount + 1;
        const locked =
          fails >= env.LOGIN_MAX_ATTEMPTS
            ? new Date(Date.now() + env.LOGIN_LOCKOUT_MINUTES * 60_000)
            : null;
        await db
          .update(users)
          .set({ failedLoginCount: fails, lockedUntil: locked, updatedAt: new Date() })
          .where(eq(users.id, user.id));
        await audit(db, {
          companyId: user.companyId,
          userId: user.id,
          action: "LOGIN_FAILED",
          module: "auth",
          ip,
        });
        throw jsonError("UNAUTHORIZED", "Credenciales inválidas", 401);
      }

      await db
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, user.id));

      const accessToken = await signAccessToken({
        sub: user.id,
        companyId: user.companyId,
        email: user.email,
      });
      const refresh = randomToken();
      const familyId = crypto.randomUUID();
      await db.insert(refreshTokens).values({
        userId: user.id,
        tokenHash: sha256(refresh),
        familyId,
        deviceId: body.deviceId,
        userAgent: c.req.header("user-agent"),
        ip,
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400_000),
      });

      await audit(db, {
        companyId: user.companyId,
        userId: user.id,
        action: "LOGIN",
        module: "auth",
        ip,
        deviceId: body.deviceId,
      });

      return c.json({
        data: {
          accessToken,
          refreshToken: refresh,
          expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
          user: { id: user.id, email: user.email, fullName: user.fullName, companyId: user.companyId },
        },
      });
    },
  );

  r.post(
    "/refresh",
    rateLimit((c) => `refresh:${clientIp(c)}`, 60, 300),
    zValidator("json", z.object({ refreshToken: z.string().min(10) })),
    async (c) => {
      const db = c.get("db");
      const { refreshToken } = c.req.valid("json");
      const hash = sha256(refreshToken);
      const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hash)).limit(1);
      if (!row || row.revokedAt || row.expiresAt < new Date()) {
        if (row) {
          await db
            .update(refreshTokens)
            .set({ revokedAt: new Date() })
            .where(eq(refreshTokens.familyId, row.familyId));
        }
        throw jsonError("UNAUTHORIZED", "Refresh inválido", 401);
      }
      const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
      if (!user || !user.active) throw jsonError("UNAUTHORIZED", "Usuario inactivo", 401);

      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
      const next = randomToken();
      await db.insert(refreshTokens).values({
        userId: user.id,
        tokenHash: sha256(next),
        familyId: row.familyId,
        deviceId: row.deviceId,
        expiresAt: new Date(Date.now() + loadEnv().REFRESH_TOKEN_TTL_DAYS * 86400_000),
      });
      const accessToken = await signAccessToken({
        sub: user.id,
        companyId: user.companyId,
        email: user.email,
      });
      return c.json({
        data: { accessToken, refreshToken: next, expiresIn: loadEnv().ACCESS_TOKEN_TTL_SECONDS },
      });
    },
  );

  r.post("/logout", authenticate, async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, user.id), sql`${refreshTokens.revokedAt} is null`));
    return c.json({ data: { ok: true } });
  });

  r.get("/me", authenticate, async (c) => {
    const user = c.get("user")!;
    return c.json({ data: user });
  });

  r.post(
    "/forgot-password",
    rateLimit((c) => `forgot:${clientIp(c)}`, 5, 600),
    zValidator("json", z.object({ email: z.string().email() })),
    async (c) => {
      const db = c.get("db");
      const env = loadEnv();
      const email = c.req.valid("json").email.trim().toLowerCase();
      const ip = clientIp(c);
      const generic = {
        ok: true,
        message: "Si el correo está registrado, vas a recibir un enlace para restablecer la contraseña.",
      };
      const [user] = await db
        .select()
        .from(users)
        .where(and(isNull(users.deletedAt), sql`lower(${users.email}) = ${email}`))
        .limit(1);
      if (!user || !user.active) {
        return c.json({ data: generic });
      }
      const token = randomToken();
      await db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      const webBase = (env.APP_PUBLIC_URL || env.WEB_ORIGIN).replace(/\/$/, "");
      const resetUrl = `${webBase}/reset-password?token=${encodeURIComponent(token)}`;
      await audit(db, {
        companyId: user.companyId,
        userId: user.id,
        action: "PASSWORD_RESET_SOLICITADO",
        module: "auth",
        ip,
      });
      if (mailerConfigured(env)) {
        await sendMail(env, {
          to: user.email,
          subject: "Restablecer contraseña — Aguatería",
          text:
            `Recibimos una solicitud para restablecer tu contraseña.\n\n` +
            `Abrí este enlace (válido por 1 hora):\n${resetUrl}\n\n` +
            `Si no lo pediste, ignorá este mensaje.`,
          html:
            `<p>Recibimos una solicitud para restablecer tu contraseña.</p>` +
            `<p><a href="${resetUrl}">Restablecer contraseña</a> (válido por 1 hora).</p>` +
            `<p>Si no lo pediste, ignorá este mensaje.</p>`,
        });
      }
      // En desarrollo, y sólo si no hay SMTP, se devuelve el enlace para poder probar el flujo.
      const includeUrl = env.APP_ENV === "development" && !mailerConfigured(env);
      if (includeUrl) console.info(`[auth] Enlace de recuperación (solo desarrollo): ${resetUrl}`);
      return c.json({ data: { ...generic, ...(includeUrl ? { resetUrl } : {}) } });
    },
  );

  r.post(
    "/reset-password",
    rateLimit((c) => `reset:${clientIp(c)}`, 8, 600),
    zValidator(
      "json",
      z.object({
        token: z.string().min(10),
        password: z.string().min(10).max(200),
      }),
    ),
    async (c) => {
      const db = c.get("db");
      const { token, password } = c.req.valid("json");
      const hash = sha256(token);
      const [row] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, hash)).limit(1);
      if (!row || row.usedAt || row.expiresAt < new Date()) {
        throw jsonError("VALIDATION_ERROR", "El enlace no es válido o ya venció. Solicitá uno nuevo.", 400);
      }
      const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
      if (!user || !user.active || user.deletedAt) {
        throw jsonError("VALIDATION_ERROR", "El enlace no es válido o ya venció. Solicitá uno nuevo.", 400);
      }
      await db
        .update(users)
        .set({
          passwordHash: await hashPassword(password),
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
      await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id));
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, user.id), sql`${refreshTokens.revokedAt} is null`));
      await audit(db, {
        companyId: user.companyId,
        userId: user.id,
        action: "PASSWORD_RESET_OK",
        module: "auth",
        ip: clientIp(c),
      });
      return c.json({ data: { ok: true } });
    },
  );

  r.get("/sifen-ready", authenticate, async (c) => {
    const e = loadEnv();
    return c.json({
      data: {
        enabled: Boolean(e.SIFEN_ENABLED),
        environment: e.SIFEN_ENVIRONMENT,
        host: e.SIFEN_ENVIRONMENT === "production" ? "sifen.set.gov.py" : "sifen-test.set.gov.py",
        certificatePresent: Boolean(e.SIFEN_CERT_BASE64 || e.SIFEN_CERT_PATH),
        cscPresent: Boolean(e.SIFEN_CSC),
        configured: Boolean(e.SIFEN_ENABLED && (e.SIFEN_CERT_BASE64 || e.SIFEN_CERT_PATH) && e.SIFEN_CSC),
        note: "Sin certificado y CSC no se envía nada a SIFEN ni se marca un DTE como aprobado.",
      },
    });
  });

  return r;
}
