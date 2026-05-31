/**
 * H.A.R.P.™ — Concrete certificate providers + policy-enforcing factory.
 *
 * Providers implement CertificateProvider. The factory chooses one from the
 * environment and ALWAYS runs the trust policy before returning material, so
 * no caller can accidentally skip enforcement.
 *
 * Implemented today:
 *   - FileCertificateProvider  (dev CA on disk; also valid for org-issued CA files)
 *
 * Documented migration targets (interface ready, integration deferred until the
 * target environment is known — by design, not omission):
 *   - SpiffeCertificateProvider (workload identity via SPIFFE Workload API)
 *   - VaultCertificateProvider  (short-lived certs from Vault PKI)
 */

import { readFileSync } from "node:fs";
import {
  CertificatePolicyError,
  enforceTrustPolicy,
  resolveDeploymentMode,
  type CertificateProvider,
  type DeploymentMode,
  type MtlsMaterial,
} from "./CertificateProvider.js";

/** Reads PEM material from explicit file paths. */
export class FileCertificateProvider implements CertificateProvider {
  readonly source: string;
  constructor(
    private readonly paths: { certPath: string; keyPath: string; caPath: string },
    sourceLabel = "file",
  ) {
    this.source = sourceLabel;
  }
  load(): MtlsMaterial {
    try {
      return {
        cert: readFileSync(this.paths.certPath),
        key: readFileSync(this.paths.keyPath),
        ca: readFileSync(this.paths.caPath),
      };
    } catch (error) {
      throw new CertificatePolicyError(
        `Failed to load certificate material from files (source: ${this.source}): ${
          error instanceof Error ? error.message : String(error)
        }. Failing closed.`,
      );
    }
  }
}

/**
 * SPIFFE/SPIRE workload-identity provider. Interface is in place; the runtime
 * integration (Workload API socket, SVID fetch, auto-rotation) is implemented
 * when the deployment environment that provides SPIRE is chosen.
 */
export class SpiffeCertificateProvider implements CertificateProvider {
  readonly source = "spiffe";
  load(): MtlsMaterial {
    throw new CertificatePolicyError(
      "SpiffeCertificateProvider is a documented migration target and is not yet wired. " +
        "Implement against the SPIFFE Workload API for the chosen environment. " +
        "Until then, configure an explicit production certificate source. Failing closed.",
    );
  }
}

/**
 * Vault PKI provider. Interface is in place; the runtime integration (auth,
 * issue endpoint, TTL, renewal) is implemented when the Vault deployment is
 * chosen.
 */
export class VaultCertificateProvider implements CertificateProvider {
  readonly source = "vault-pki";
  load(): MtlsMaterial {
    throw new CertificatePolicyError(
      "VaultCertificateProvider is a documented migration target and is not yet wired. " +
        "Implement against your Vault PKI issue endpoint with short TTLs and renewal. " +
        "Until then, configure an explicit production certificate source. Failing closed.",
    );
  }
}

/**
 * Selects a provider from the environment.
 *   HARP_CERT_SOURCE = file (default) | spiffe | vault
 * For "file", reads HARP_<PREFIX>_CERT/KEY/CA.
 */
function selectProvider(envPrefix: string): CertificateProvider {
  const source = (process.env.HARP_CERT_SOURCE ?? "file").toLowerCase();

  if (source === "spiffe") return new SpiffeCertificateProvider();
  if (source === "vault") return new VaultCertificateProvider();

  if (source === "file") {
    const certPath = process.env[`${envPrefix}_CERT`];
    const keyPath = process.env[`${envPrefix}_KEY`];
    const caPath = process.env[`${envPrefix}_CA`];
    if (!certPath || !keyPath || !caPath) {
      throw new CertificatePolicyError(
        `HARP_CERT_SOURCE=file requires ${envPrefix}_CERT/KEY/CA. Failing closed.`,
      );
    }
    return new FileCertificateProvider({ certPath, keyPath, caPath }, "file");
  }

  throw new CertificatePolicyError(
    `Unknown HARP_CERT_SOURCE "${source}". Use "file", "spiffe", or "vault".`,
  );
}

export interface ResolvedMaterial {
  material: MtlsMaterial;
  mode: DeploymentMode;
  source: string;
}

/**
 * The single entry point every party uses to obtain mTLS material. It selects
 * the provider, loads material, and ENFORCES the trust policy (fail closed)
 * before returning. No path returns un-enforced material.
 */
export async function provideMtlsMaterial(
  envPrefix: string,
): Promise<ResolvedMaterial> {
  const mode = resolveDeploymentMode();
  const provider = selectProvider(envPrefix);
  const material = await provider.load();
  enforceTrustPolicy(mode, material, provider.source);
  return { material, mode, source: provider.source };
}
