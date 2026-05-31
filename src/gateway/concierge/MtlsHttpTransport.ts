/**
 * H.A.R.P.™ — mTLS HTTP transport.
 *
 * Delivers a (already-redacted) ContainerRequest to a container over HTTPS with
 * mutual TLS. Uses node:https.request directly rather than global fetch,
 * because fetch (undici) does not reliably present a client certificate — and
 * the client cert is exactly what proves the concierge's identity in mutual
 * TLS. Enforces the per-request deadline so a slow container surfaces as a
 * timeout the Concierge can fail over on.
 */

import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import {
  type ContainerFailureKind,
  type ContainerRequest,
  type ContainerResponse,
} from "../contracts/wire.js";
import { type MtlsMaterial } from "../security/mtls.js";
import type { ContainerTransport } from "./Concierge.js";
import type { RegisteredContainer } from "../routing/Router.js";

function fail(
  request: ContainerRequest,
  kind: ContainerFailureKind,
  message: string,
  retryable: boolean,
): ContainerResponse {
  return {
    ok: false,
    protocolVersion: request.protocolVersion,
    correlationId: request.correlationId,
    kind,
    message,
    retryable,
  };
}

export class MtlsHttpTransport implements ContainerTransport {
  constructor(private readonly material: MtlsMaterial) {}

  deliver(
    container: RegisteredContainer,
    request: ContainerRequest,
  ): Promise<ContainerResponse> {
    const url = new URL("/v1/generate", container.baseUrl);
    const payload = JSON.stringify(request);

    return new Promise<ContainerResponse>((resolve) => {
      const req = httpsRequest(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "POST",
          // mTLS client identity:
          cert: this.material.cert,
          key: this.material.key,
          ca: this.material.ca,
          rejectUnauthorized: true,
          minVersion: "TLSv1.3",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
            "x-correlation-id": request.correlationId,
          },
          timeout: request.deadlineMs,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c as Buffer));
          res.on("end", () => {
            const bodyText = Buffer.concat(chunks).toString("utf8");
            if (status === 401 || status === 403) {
              return resolve(fail(request, "unauthorized", `HTTP ${status}`, false));
            }
            if (status === 503) {
              return resolve(fail(request, "overloaded", "Container overloaded", true));
            }
            try {
              return resolve(JSON.parse(bodyText) as ContainerResponse);
            } catch {
              return resolve(
                fail(request, "internal", "Unparseable container response", true),
              );
            }
          });
        },
      );

      req.on("timeout", () => {
        req.destroy(new Error("deadline exceeded"));
      });
      req.on("error", (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        const kind: ContainerFailureKind = /timeout|deadline/i.test(msg)
          ? "timeout"
          : "internal";
        resolve(fail(request, kind, msg, true));
      });

      req.write(payload);
      req.end();
    });
  }
}
