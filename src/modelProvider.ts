/**
 * H.A.R.P.™ — Model provider selection.
 *
 * Chooses the ModelProvider the core will use, WITHOUT the core knowing which
 * one. Two modes:
 *
 *   HARP_MODEL_MODE=stub        → in-process StubModelProvider (offline dev)
 *   HARP_MODEL_MODE=concierge   → the Concierge: redaction + mTLS + multi-
 *                                 container routing/failover to real providers
 *
 * The Concierge implements the same generate() contract as StubModelProvider,
 * so the rest of the system is identical regardless of choice.
 */

import type { ModelProvider } from "./core/types.js";
import { StubModelProvider } from "./models/providers/StubModelProvider.js";
import { Concierge } from "./gateway/concierge/Concierge.js";
import { MtlsHttpTransport } from "./gateway/concierge/MtlsHttpTransport.js";
import { DefaultRedactor } from "./gateway/redaction/Redactor.js";
import { ConsoleSafeLogger } from "./gateway/security/SafeLogger.js";
import { provideMtlsMaterial } from "./gateway/security/certProviders.js";
import {
  ContainerRegistry,
  Router,
} from "./gateway/routing/Router.js";
import type { WireModelClass } from "./gateway/contracts/wire.js";

interface ContainerEnvEntry {
  id: string;
  baseUrl: string;
  tier: "primary" | "backup";
  classes: WireModelClass[];
  providerFamily: string;
}

/**
 * Reads container definitions from HARP_CONTAINERS, a JSON array, e.g.:
 * [{"id":"stub-primary","baseUrl":"https://harp-container-primary:8443",
 *   "tier":"primary","classes":["cloud-reasoning"],"providerFamily":"stub"}]
 */
function readContainersFromEnv(): ContainerEnvEntry[] {
  const raw = process.env.HARP_CONTAINERS;
  if (!raw) {
    throw new Error(
      "HARP_MODEL_MODE=concierge requires HARP_CONTAINERS (JSON array of container definitions).",
    );
  }
  try {
    return JSON.parse(raw) as ContainerEnvEntry[];
  } catch (error) {
    throw new Error(
      `HARP_CONTAINERS is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * The Concierge satisfies the core ModelProvider structurally. We wrap it so
 * the core's required `name` field is present and the request carries the
 * high-risk hint.
 */
function conciergeAsProvider(concierge: Concierge): ModelProvider {
  return {
    name: "concierge",
    async generate(request) {
      const res = await concierge.generate({
        modelClass: request.modelClass,
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt,
        temperature: request.temperature,
        agentId: request.agentId,
        taskId: request.taskId,
        workflowId: request.workflowId,
        // Conservative default: callers may set this via prompt metadata later.
        highRisk: false,
      });
      return res;
    },
  };
}

export async function buildModelProvider(): Promise<ModelProvider> {
  const mode = process.env.HARP_MODEL_MODE ?? "stub";

  if (mode === "stub") {
    return new StubModelProvider();
  }

  if (mode === "concierge") {
    // Resolves cert source + ENFORCES trust policy (fail closed; rejects dev
    // CA material in production). No insecure fallback exists.
    const { material } = await provideMtlsMaterial("HARP_CONCIERGE");

    const registry = new ContainerRegistry();
    for (const c of readContainersFromEnv()) {
      registry.register({
        descriptor: {
          id: c.id,
          servesClasses: c.classes,
          tier: c.tier,
          providerFamily: c.providerFamily,
        },
        baseUrl: c.baseUrl,
        healthy: true,
      });
    }

    const router = new Router(registry, { retriesPerContainer: 2 });
    const transport = new MtlsHttpTransport(material);
    const redactor = new DefaultRedactor();
    const logger = new ConsoleSafeLogger("concierge");

    const concierge = new Concierge(
      registry,
      router,
      transport,
      redactor,
      logger,
    );
    return conciergeAsProvider(concierge);
  }

  throw new Error(
    `Unknown HARP_MODEL_MODE "${mode}". Use "stub" or "concierge".`,
  );
}
