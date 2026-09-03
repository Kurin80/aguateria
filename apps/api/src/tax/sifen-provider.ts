export type SifenEnvironment = "test" | "production";

export type SifenSendResult =
  | { ok: false; code: "SIFEN_NOT_CONFIGURED"; message: string }
  | { ok: false; code: "SIFEN_UNAVAILABLE"; message: string; raw?: string }
  | { ok: false; code: "SIFEN_REJECTED"; message: string; responseCode?: string; raw?: string }
  | { ok: true; responseCode: string; raw: string; approved: boolean };

export interface TaxProvider {
  readonly configured: boolean;
  readonly environment: SifenEnvironment;
  sendDe(xml: string): Promise<SifenSendResult>;
  consultCdc(cdc: string): Promise<SifenSendResult>;
}

/**
 * No marca documentos como aprobados. Si faltan certificado, CSC o SIFEN_ENABLED,
 * declara explícitamente que no hubo contacto con SIFEN.
 */
export class SifenProvider implements TaxProvider {
  constructor(
    private readonly opts: {
      enabled: boolean;
      environment: SifenEnvironment;
      host: string;
      certPresent: boolean;
      cscPresent: boolean;
      timeoutMs: number;
    },
  ) {}

  get configured(): boolean {
    return this.opts.enabled && this.opts.certPresent && this.opts.cscPresent;
  }

  get environment(): SifenEnvironment {
    return this.opts.environment;
  }

  officialHost(): string {
    return this.opts.environment === "production" ? "sifen.set.gov.py" : "sifen-test.set.gov.py";
  }

  async sendDe(_xml: string): Promise<SifenSendResult> {
    if (!this.configured) {
      return {
        ok: false,
        code: "SIFEN_NOT_CONFIGURED",
        message:
          "SIFEN no está configurado (certificado PSC, CSC y SIFEN_ENABLED). El documento no fue enviado ni aprobado por la DNIT.",
      };
    }
    // La transmisión SOAP/mTLS real requiere el PKCS#12 del contribuyente y el XML
    // conforme al Manual Técnico v150 + NT vigentes. Sin esos insumos no se contacta SIFEN.
    return {
      ok: false,
      code: "SIFEN_UNAVAILABLE",
      message: `Transmisión mTLS a https://${this.officialHost()} no ejecutada: complete certificado, XML firmado (XMLDSig enveloped) y WSDL oficiales. No se simula aceptación.`,
    };
  }

  async consultCdc(_cdc: string): Promise<SifenSendResult> {
    if (!this.configured) {
      return {
        ok: false,
        code: "SIFEN_NOT_CONFIGURED",
        message: "Consulta a SIFEN no realizada: integración no configurada.",
      };
    }
    return {
      ok: false,
      code: "SIFEN_UNAVAILABLE",
      message: `Consulta CDC en https://${this.officialHost()}/de/ws/consultas/consulta.wsdl no ejecutada sin mTLS operativo.`,
    };
  }
}

export function createSifenProvider(env: {
  SIFEN_ENABLED?: boolean;
  SIFEN_ENVIRONMENT: SifenEnvironment;
  SIFEN_CERT_BASE64?: string;
  SIFEN_CERT_PATH?: string;
  SIFEN_CSC?: string;
  SIFEN_TIMEOUT_MS: number;
}): SifenProvider {
  const certPresent = Boolean(env.SIFEN_CERT_BASE64 || env.SIFEN_CERT_PATH);
  return new SifenProvider({
    enabled: Boolean(env.SIFEN_ENABLED),
    environment: env.SIFEN_ENVIRONMENT,
    host: env.SIFEN_ENVIRONMENT === "production" ? "sifen.set.gov.py" : "sifen-test.set.gov.py",
    certPresent,
    cscPresent: Boolean(env.SIFEN_CSC),
    timeoutMs: env.SIFEN_TIMEOUT_MS,
  });
}
