/**
 * H.A.R.P.™ — Mutual TLS option builders.
 *
 * This module now holds ONLY the pure TLS-option builders. Certificate
 * SOURCING and the production trust policy live in CertificateProvider.ts and
 * certProviders.ts, so the source of material is pluggable (dev files today;
 * SPIFFE/SPIRE or Vault PKI later) without touching this file.
 *
 * MtlsMaterial is re-exported from CertificateProvider to keep one definition.
 */

import type { MtlsMaterial } from "./CertificateProvider.js";

export type { MtlsMaterial };

/**
 * Server-side TLS options. `requestCert` + `rejectUnauthorized` is what
 * enforces *mutual* auth: the server demands and verifies the client's cert.
 * TLS 1.3 floor; there is no insecure-transport option anywhere.
 */
export function serverTlsOptions(m: MtlsMaterial): {
  cert: Buffer;
  key: Buffer;
  ca: Buffer;
  requestCert: true;
  rejectUnauthorized: true;
  minVersion: "TLSv1.3";
} {
  return {
    cert: m.cert,
    key: m.key,
    ca: m.ca,
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: "TLSv1.3",
  };
}

/** Client-side TLS options for the concierge. */
export function clientTlsOptions(m: MtlsMaterial): {
  cert: Buffer;
  key: Buffer;
  ca: Buffer;
  rejectUnauthorized: true;
  minVersion: "TLSv1.3";
} {
  return {
    cert: m.cert,
    key: m.key,
    ca: m.ca,
    rejectUnauthorized: true,
    minVersion: "TLSv1.3",
  };
}
