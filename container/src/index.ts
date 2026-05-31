/**
 * H.A.R.P.™ Container — entrypoint.
 *
 * Reads its identity and port from the environment, constructs the contained
 * provider, and starts the mTLS server. To run a real model, swap
 * StubContainedProvider for a real provider here — nothing outside this
 * container changes.
 */

import type {
  ContainerDescriptor,
  WireModelClass,
} from "../../src/gateway/contracts/wire.js";
import { StubContainedProvider } from "./Provider.js";
import { startContainerServer } from "./server.js";

function parseClasses(value: string | undefined): WireModelClass[] {
  if (!value) {
    return ["cloud-reasoning"];
  }
  return value.split(",").map((s) => s.trim()) as WireModelClass[];
}

const descriptor: ContainerDescriptor = {
  id: process.env.HARP_CONTAINER_ID ?? "stub-primary",
  servesClasses: parseClasses(process.env.HARP_CONTAINER_CLASSES),
  tier: (process.env.HARP_CONTAINER_TIER as "primary" | "backup") ?? "primary",
  providerFamily: process.env.HARP_CONTAINER_FAMILY ?? "stub",
};

const port = Number(process.env.HARP_CONTAINER_PORT ?? "8443");

startContainerServer({
  provider: new StubContainedProvider(descriptor),
  port,
  mtlsEnvPrefix: "HARP_CONTAINER",
}).catch((error) => {
  // Fail closed: a cert-policy or load failure must stop the container, never
  // degrade to insecure transport.
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      source: "container",
      event: "container.startup_failed",
      reason: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
