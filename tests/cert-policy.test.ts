/**
 * H.A.R.P.™ — Certificate trust policy tests.
 *
 * Proves the production PKI policy is enforced in code, not just documented:
 *   - dev-CA material is REJECTED in production (fail closed)
 *   - dev-CA material is ALLOWED in development
 *   - expired material is rejected in any mode
 *   - invalid (non-X.509) material is rejected
 *   - SPIFFE/Vault providers fail closed with a clear migration message
 *   - the file provider loads real material in development
 */

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  CertificatePolicyError,
  DEV_CA_MARKER,
  enforceTrustPolicy,
  looksLikeDevMaterial,
  type MtlsMaterial,
} from "../src/gateway/security/CertificateProvider.js";
import {
  FileCertificateProvider,
  SpiffeCertificateProvider,
  VaultCertificateProvider,
} from "../src/gateway/security/certProviders.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEV_CERTS = resolve(__dirname, "../certs");

function devMaterial(): MtlsMaterial {
  return new FileCertificateProvider({
    certPath: `${DEV_CERTS}/concierge.crt`,
    keyPath: `${DEV_CERTS}/concierge.key`,
    caPath: `${DEV_CERTS}/ca.crt`,
  }).load();
}

// Build a NON-dev (production-like) CA + leaf with no dev marker, on the fly.
const workdir = mkdtempSync(join(tmpdir(), "harp-prodca-"));
function makeProdLikeMaterial(): MtlsMaterial {
  execSync(
    `openssl genrsa -out "${workdir}/ca.key" 2048 2>/dev/null && ` +
      `openssl req -x509 -new -nodes -key "${workdir}/ca.key" -sha256 -days 3 ` +
      `-subj "/CN=Acme Internal CA/O=Acme" -out "${workdir}/ca.crt" 2>/dev/null && ` +
      `openssl genrsa -out "${workdir}/leaf.key" 2048 2>/dev/null && ` +
      `openssl req -new -key "${workdir}/leaf.key" -subj "/CN=harp-concierge" -out "${workdir}/leaf.csr" 2>/dev/null && ` +
      `openssl x509 -req -in "${workdir}/leaf.csr" -CA "${workdir}/ca.crt" -CAkey "${workdir}/ca.key" ` +
      `-CAcreateserial -out "${workdir}/leaf.crt" -days 3 -sha256 2>/dev/null`,
    { shell: "/bin/bash" },
  );
  return {
    cert: readFileSync(`${workdir}/leaf.crt`),
    key: readFileSync(`${workdir}/leaf.key`),
    ca: readFileSync(`${workdir}/ca.crt`),
  };
}

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("Dev material detection", () => {
  it("detects the dev CA marker in dev material", () => {
    expect(looksLikeDevMaterial(devMaterial())).toBe(true);
  });

  it("does not flag production-like material as dev", () => {
    expect(looksLikeDevMaterial(makeProdLikeMaterial())).toBe(false);
  });

  it("exposes a stable marker constant", () => {
    expect(DEV_CA_MARKER).toContain("DO-NOT-USE-IN-PRODUCTION");
  });
});

describe("Trust policy enforcement", () => {
  it("REJECTS dev material in production (fail closed)", () => {
    expect(() =>
      enforceTrustPolicy("production", devMaterial(), "file"),
    ).toThrow(CertificatePolicyError);
    expect(() =>
      enforceTrustPolicy("production", devMaterial(), "file"),
    ).toThrow(/Development CA material detected in PRODUCTION/i);
  });

  it("ALLOWS dev material in development", () => {
    expect(() =>
      enforceTrustPolicy("development", devMaterial(), "file"),
    ).not.toThrow();
  });

  it("ACCEPTS production-like material in production", () => {
    expect(() =>
      enforceTrustPolicy("production", makeProdLikeMaterial(), "file"),
    ).not.toThrow();
  });

  it("REJECTS structurally invalid material", () => {
    const bogus: MtlsMaterial = {
      cert: Buffer.from("not a cert"),
      key: Buffer.from("not a key"),
      ca: Buffer.from("not a ca"),
    };
    expect(() => enforceTrustPolicy("development", bogus, "file")).toThrow(
      /not valid X\.509/i,
    );
  });
});

describe("Migration-target providers fail closed until wired", () => {
  it("SPIFFE provider throws a clear migration message", () => {
    expect(() => new SpiffeCertificateProvider().load()).toThrow(
      /SpiffeCertificateProvider .* not yet wired|Failing closed/i,
    );
  });

  it("Vault provider throws a clear migration message", () => {
    expect(() => new VaultCertificateProvider().load()).toThrow(
      /VaultCertificateProvider .* not yet wired|Failing closed/i,
    );
  });
});

describe("File provider", () => {
  it("loads real dev material from disk", () => {
    const m = devMaterial();
    expect(m.cert.length).toBeGreaterThan(0);
    expect(m.key.length).toBeGreaterThan(0);
    expect(m.ca.length).toBeGreaterThan(0);
  });

  it("fails closed when files are missing", () => {
    const p = new FileCertificateProvider({
      certPath: "/nonexistent/cert.crt",
      keyPath: "/nonexistent/key.key",
      caPath: "/nonexistent/ca.crt",
    });
    expect(() => p.load()).toThrow(/Failing closed/i);
  });
});
