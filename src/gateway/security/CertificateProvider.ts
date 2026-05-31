/**
 * H.A.R.P.™ — Certificate provider abstraction.
 *
 * The source of mTLS material is a pluggable dependency, NOT a hardcoded file
 * read. Today the only concrete source is the local dev CA (files on disk).
 * Tomorrow a SPIFFE/SPIRE or Vault PKI provider implements the same interface
 * and is injected without touching the concierge, the container server, or the
 * core. This is the "swap is config, not surgery" guarantee.
 *
 * It also encodes the production trust policy in code:
 *   - Deployment mode is explicit (development | production).
 *   - In production, dev-CA material is detected and REJECTED (fail closed).
 *   - Missing/invalid material fails startup; there is no insecure fallback.
 */

import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";

export interface MtlsMaterial {
  cert: Buffer;
  key: Buffer;
  ca: Buffer;
}

export type DeploymentMode = "development" | "production";

/** Marker embedded in the dev CA's subject by scripts/gen-certs.sh. */
export const DEV_CA_MARKER = "DEV-CERT-DO-NOT-USE-IN-PRODUCTION";

export class CertificatePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CertificatePolicyError";
  }
}

/**
 * Supplies mTLS material for a party (concierge or a container). Implementations
 * may read files, call a SPIFFE Workload API, fetch from Vault, etc. `source`
 * is a label used only for audit/logging.
 */
export interface CertificateProvider {
  readonly source: string;
  load(): Promise<MtlsMaterial> | MtlsMaterial;
}

/** Resolves the deployment mode from the environment. Defaults to development. */
export function resolveDeploymentMode(): DeploymentMode {
  const raw = (process.env.HARP_DEPLOYMENT_MODE ?? "development").toLowerCase();
  if (raw === "production") return "production";
  if (raw === "development") return "development";
  throw new CertificatePolicyError(
    `Invalid HARP_DEPLOYMENT_MODE "${raw}". Use "development" or "production".`,
  );
}

/** True if any supplied PEM appears to originate from the local dev CA. */
export function looksLikeDevMaterial(material: MtlsMaterial): boolean {
  const candidates = [material.ca, material.cert];
  for (const buf of candidates) {
    try {
      const x = new X509Certificate(buf);
      const subject = x.subject ?? "";
      const issuer = x.issuer ?? "";
      if (subject.includes(DEV_CA_MARKER) || issuer.includes(DEV_CA_MARKER)) {
        return true;
      }
    } catch {
      // If it cannot be parsed as an X.509 cert, it is not valid material;
      // the validating layer will reject it separately.
    }
  }
  return false;
}

/**
 * Enforces the production trust policy. Called by every party at startup.
 * Throws (fails closed) when policy is violated. There is intentionally no
 * code path that downgrades to insecure transport.
 */
export function enforceTrustPolicy(
  mode: DeploymentMode,
  material: MtlsMaterial,
  source: string,
): void {
  // 1. Material must be structurally valid (parseable + not expired).
  let certObj: X509Certificate;
  let caObj: X509Certificate;
  try {
    certObj = new X509Certificate(material.cert);
    caObj = new X509Certificate(material.ca);
  } catch (error) {
    throw new CertificatePolicyError(
      `Certificate material is not valid X.509 (source: ${source}): ${
        error instanceof Error ? error.message : String(error)
      }. Failing closed.`,
    );
  }

  const now = Date.now();
  for (const [label, x] of [["leaf", certObj], ["ca", caObj]] as const) {
    const notAfter = Date.parse(x.validTo);
    const notBefore = Date.parse(x.validFrom);
    if (!Number.isNaN(notAfter) && now > notAfter) {
      throw new CertificatePolicyError(
        `${label} certificate is expired (source: ${source}). Failing closed.`,
      );
    }
    if (!Number.isNaN(notBefore) && now < notBefore) {
      throw new CertificatePolicyError(
        `${label} certificate is not yet valid (source: ${source}). Failing closed.`,
      );
    }
  }

  // 2. In production, dev-CA material is prohibited.
  if (mode === "production" && looksLikeDevMaterial(material)) {
    throw new CertificatePolicyError(
      "Development CA material detected in PRODUCTION mode. " +
        "Dev certificates are prohibited in production; supply material from a real PKI " +
        "or workload-identity system (SPIFFE/SPIRE, Vault PKI, or an internal CA). Failing closed.",
    );
  }
}
