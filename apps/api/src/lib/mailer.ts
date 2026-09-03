import type { Env } from "../env.js";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export function mailerConfigured(env: Env): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_FROM);
}

/**
 * Envío SMTP real (nodemailer). Sin `SMTP_HOST`/`SMTP_FROM` no hace nada y
 * devuelve `false` — la recuperación de contraseña sigue el flujo genérico
 * ("si el correo existe, te llega un enlace") sin filtrar si el envío ocurrió.
 * `nodemailer` se importa dinámicamente para no cargarlo si no se usa.
 */
export async function sendMail(env: Env, msg: MailMessage): Promise<boolean> {
  if (!mailerConfigured(env)) return false;
  try {
    const { createTransport } = await import("nodemailer");
    const port = env.SMTP_PORT ?? 587;
    const transport = createTransport({
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" } : undefined,
    });
    await transport.sendMail({
      from: env.SMTP_FROM,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return true;
  } catch (err) {
    console.error("[mailer] fallo de envío SMTP", err instanceof Error ? err.message : err);
    return false;
  }
}
