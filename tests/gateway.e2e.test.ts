/**
 * H.A.R.P.™ — Gateway end-to-end integration test.
 *
 * Starts REAL mTLS HTTPS container servers on localhost and drives the
 * Concierge through the full pipe:
 *   redaction → route → mTLS deliver → provider → response.
 *
 * Covers the operator-mandated guarantees:
 *   - success path end to end over mutual TLS
 *   - PII is redacted before it reaches the container
 *   - retry on the same container, then failover to same-class backup
 *   - high-risk never downgrades: when no same-class container is healthy,
 *     the concierge reports failure to the core instead of substituting.
 *   - a client WITHOUT a valid cert is rejected by mutual TLS.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { request as httpsRequest } from "node:https";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startContainerServer } from "../container/src/server.js";
import {
  StubContainedProvider,
  type ContainedProvider,
  type ProviderInput,
  type ProviderOutput,
} from "../container/src/Provider.js";
import { Concierge } from "../src/gateway/concierge/Concierge.js";
import { MtlsHttpTransport } from "../src/gateway/concierge/MtlsHttpTransport.js";
import { DefaultRedactor } from "../src/gateway/redaction/Redactor.js";
import { NullSafeLogger } from "../src/gateway/security/SafeLogger.js";
import { FileCertificateProvider } from "../src/gateway/security/certProviders.js";
import { ContainerRegistry, Router } from "../src/gateway/routing/Router.js";
import type { ContainerDescriptor } from "../src/gateway/contracts/wire.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CERTS = resolve(__dirname, "../certs");

// Set the env mTLS material the container server reads.
function setContainerEnv(name: string) {
  process.env.HARP_CONTAINER_CERT = `${CERTS}/${name}.crt`;
  process.env.HARP_CONTAINER_KEY = `${CERTS}/${name}.key`;
  process.env.HARP_CONTAINER_CA = `${CERTS}/ca.crt`;
}

const conciergeMaterial = () =>
  new FileCertificateProvider({
    certPath: `${CERTS}/concierge.crt`,
    keyPath: `${CERTS}/concierge.key`,
    caPath: `${CERTS}/ca.crt`,
  }).load();

const PRIMARY_PORT = 18443;
const BACKUP_PORT = 18444;

/** A provider that fails a configurable number of times, then succeeds. */
class FlakyProvider implements ContainedProvider {
  private calls = 0;
  constructor(
    readonly descriptor: ContainerDescriptor,
    private readonly failTimes: number,
  ) {}
  async generate(input: ProviderInput): Promise<ProviderOutput> {
    this.calls += 1;
    if (this.calls <= this.failTimes) {
      throw new Error("simulated provider failure");
    }
    return {
      text: JSON.stringify({ ok: true, from: this.descriptor.id }),
      modelUsed: `flaky:${this.descriptor.id}`,
      modelClass: input.modelClass,
      inputTokens: 10,
      outputTokens: 10,
      estimatedCostUsd: 0,
      latencyMs: 1,
    };
  }
}

describe("Gateway end-to-end over mTLS", () => {
  beforeAll(async () => {
    // Primary container with a stub provider.
    setContainerEnv("container-primary");
    await startContainerServer({
      provider: new StubContainedProvider({
        id: "stub-primary",
        servesClasses: ["cloud-reasoning"],
        tier: "primary",
        providerFamily: "stub",
      }),
      port: PRIMARY_PORT,
      mtlsEnvPrefix: "HARP_CONTAINER",
    });
    // Backup container (server cert differs, CA is shared).
    setContainerEnv("container-backup");
    await startContainerServer({
      provider: new StubContainedProvider({
        id: "stub-backup",
        servesClasses: ["cloud-reasoning"],
        tier: "backup",
        providerFamily: "stub",
      }),
      port: BACKUP_PORT,
      mtlsEnvPrefix: "HARP_CONTAINER",
    });
  });

  function buildConcierge(registry: ContainerRegistry, retries = 2) {
    const router = new Router(registry, { retriesPerContainer: retries });
    const transport = new MtlsHttpTransport(conciergeMaterial());
    return new Concierge(
      registry,
      router,
      transport,
      new DefaultRedactor(),
      new NullSafeLogger(),
      { deadlineMs: 4000 },
    );
  }

  it("delivers a request and returns a response over mutual TLS", async () => {
    const registry = new ContainerRegistry();
    registry.register({
      descriptor: { id: "stub-primary", servesClasses: ["cloud-reasoning"], tier: "primary", providerFamily: "stub" },
      baseUrl: `https://localhost:${PRIMARY_PORT}`,
      healthy: true,
    });
    const concierge = buildConcierge(registry);

    const res = await concierge.generate({
      modelClass: "cloud-reasoning",
      systemPrompt: "You are a reviewer.",
      userPrompt: "Assess this task.",
    });
    expect(res.text).toContain("Stub");
    expect(res.modelUsed).toContain("stub");
  });

  it("redacts PII before it reaches the container", async () => {
    // Capture what the provider actually receives.
    let seenUser = "";
    setContainerEnv("container-primary");
    const port = 18450;
    await startContainerServer({
      provider: {
        descriptor: { id: "spy", servesClasses: ["cloud-reasoning"], tier: "primary", providerFamily: "spy" },
        async generate(input) {
          seenUser = input.userPrompt;
          return {
            text: "{}", modelUsed: "spy", modelClass: input.modelClass,
            inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0, latencyMs: 1,
          };
        },
      },
      port,
      mtlsEnvPrefix: "HARP_CONTAINER",
    });

    const registry = new ContainerRegistry();
    registry.register({
      descriptor: { id: "spy", servesClasses: ["cloud-reasoning"], tier: "primary", providerFamily: "spy" },
      baseUrl: `https://localhost:${port}`,
      healthy: true,
    });
    const concierge = buildConcierge(registry);

    await concierge.generate({
      modelClass: "cloud-reasoning",
      systemPrompt: "sys",
      userPrompt: "Contact me at jane.doe@example.com or 415-555-0199.",
    });

    expect(seenUser).not.toContain("jane.doe@example.com");
    expect(seenUser).not.toContain("415-555-0199");
    expect(seenUser).toContain("[REDACTED_EMAIL]");
    expect(seenUser).toContain("[REDACTED_PHONE]");
  });

  it("retries the same container, then fails over to the same-class backup", async () => {
    // Primary fails 3 times (exceeds 2 retries → marked unhealthy → failover).
    setContainerEnv("container-primary");
    const pPort = 18460;
    await startContainerServer({
      provider: new FlakyProvider(
        { id: "flaky-primary", servesClasses: ["cloud-reasoning"], tier: "primary", providerFamily: "flaky" },
        99,
      ),
      port: pPort,
      mtlsEnvPrefix: "HARP_CONTAINER",
    });
    setContainerEnv("container-backup");
    const bPort = 18461;
    await startContainerServer({
      provider: new StubContainedProvider(
        { id: "ok-backup", servesClasses: ["cloud-reasoning"], tier: "backup", providerFamily: "stub" },
      ),
      port: bPort,
      mtlsEnvPrefix: "HARP_CONTAINER",
    });

    const registry = new ContainerRegistry();
    registry.register({
      descriptor: { id: "flaky-primary", servesClasses: ["cloud-reasoning"], tier: "primary", providerFamily: "flaky" },
      baseUrl: `https://localhost:${pPort}`,
      healthy: true,
    });
    registry.register({
      descriptor: { id: "ok-backup", servesClasses: ["cloud-reasoning"], tier: "backup", providerFamily: "stub" },
      baseUrl: `https://localhost:${bPort}`,
      healthy: true,
    });
    const concierge = buildConcierge(registry);

    const res = await concierge.generate({
      modelClass: "cloud-reasoning",
      systemPrompt: "sys",
      userPrompt: "do it",
    });
    // Came from the backup after primary exhausted its retries.
    expect(res.modelUsed).toContain("stub");
  });

  it("high-risk: reports failure instead of downgrading when no same-class container is healthy", async () => {
    const registry = new ContainerRegistry();
    // Only an unhealthy primary; nothing to fail over to in-class.
    registry.register({
      descriptor: { id: "dead-primary", servesClasses: ["frontier-reasoning"], tier: "primary", providerFamily: "x" },
      baseUrl: "https://localhost:19999", // nothing listening
      healthy: true,
    });
    const concierge = buildConcierge(registry, 1);

    await expect(
      concierge.generate({
        modelClass: "frontier-reasoning",
        systemPrompt: "sys",
        userPrompt: "high risk task",
        highRisk: true,
      }),
    ).rejects.toThrow(/no weaker model substituted|All containers/i);
  });

  it("rejects a client that presents no certificate (mutual TLS enforced)", async () => {
    // Raw HTTPS request with NO client cert → TLS handshake must fail.
    setContainerEnv("container-primary");
    const port = 18470;
    await startContainerServer({
      provider: new StubContainedProvider(
        { id: "secure", servesClasses: ["cloud-reasoning"], tier: "primary", providerFamily: "stub" },
      ),
      port,
      mtlsEnvPrefix: "HARP_CONTAINER",
    });

    const ca = readFileSync(`${CERTS}/ca.crt`);
    const result = await new Promise<string>((resolveP) => {
      const req = httpsRequest(
        {
          host: "localhost",
          port,
          path: "/v1/health",
          method: "GET",
          ca, // trust the server's CA, but present NO client cert
          rejectUnauthorized: true,
        },
        (res) => {
          let body = "";
          res.on("data", (d) => (body += d));
          res.on("end", () => resolveP(`ok:${res.statusCode}`));
        },
      );
      req.on("error", (e) => resolveP(`error:${e.message}`));
      req.end();
    });

    // The server demands a client cert; without one the connection errors.
    expect(result.startsWith("error:")).toBe(true);
  });
});
