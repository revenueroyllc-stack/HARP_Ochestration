/**
 * H.A.R.P.™ Container — mTLS HTTPS server.
 *
 * Houses exactly one provider and exposes two endpoints over mutual TLS:
 *   GET  /v1/health   → identity + descriptor
 *   POST /v1/generate → run the contained provider
 *
 * The server demands and verifies the concierge's client certificate
 * (requestCert + rejectUnauthorized). Secrets for the provider are read from
 * the environment at startup and never leave the container.
 */

import { createServer } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  WIRE_PROTOCOL_VERSION,
  type ContainerRequest,
  type ContainerResponse,
  type HealthResponse,
} from "../../src/gateway/contracts/wire.js";
import { serverTlsOptions } from "../../src/gateway/security/mtls.js";
import { provideMtlsMaterial } from "../../src/gateway/security/certProviders.js";
import type { ContainedProvider } from "./Provider.js";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
}

export interface ContainerServerOptions {
  provider: ContainedProvider;
  port: number;
  /** Env prefix for mTLS material, e.g. "HARP_CONTAINER". */
  mtlsEnvPrefix: string;
}

export async function startContainerServer(
  options: ContainerServerOptions,
): Promise<void> {
  // Resolves the cert source (file/spiffe/vault), loads material, and ENFORCES
  // the trust policy (fail closed). In production this rejects dev-CA material.
  const { material, mode, source } = await provideMtlsMaterial(
    options.mtlsEnvPrefix,
  );
  const tls = serverTlsOptions(material);

  const server = createServer(tls, async (req, res) => {
    // The TLS layer already rejected any client without a CA-signed cert.
    try {
      if (req.method === "GET" && req.url === "/v1/health") {
        const body: HealthResponse = {
          ok: true,
          descriptor: options.provider.descriptor,
          protocolVersion: WIRE_PROTOCOL_VERSION,
        };
        return sendJson(res, 200, body);
      }

      if (req.method === "POST" && req.url === "/v1/generate") {
        const raw = await readBody(req);
        let request: ContainerRequest;
        try {
          request = JSON.parse(raw) as ContainerRequest;
        } catch {
          const fail: ContainerResponse = {
            ok: false,
            protocolVersion: WIRE_PROTOCOL_VERSION,
            correlationId: "unknown",
            kind: "bad_request",
            message: "Malformed JSON body.",
            retryable: false,
          };
          return sendJson(res, 400, fail);
        }

        if (request.protocolVersion !== WIRE_PROTOCOL_VERSION) {
          const fail: ContainerResponse = {
            ok: false,
            protocolVersion: WIRE_PROTOCOL_VERSION,
            correlationId: request.correlationId,
            kind: "bad_request",
            message: `Protocol mismatch: got ${request.protocolVersion}, want ${WIRE_PROTOCOL_VERSION}.`,
            retryable: false,
          };
          return sendJson(res, 400, fail);
        }

        try {
          const out = await options.provider.generate({
            modelClass: request.modelClass,
            systemPrompt: request.systemPrompt,
            userPrompt: request.userPrompt,
            temperature: request.temperature,
            highRisk: request.highRisk,
            deadlineMs: request.deadlineMs,
          });
          const ok: ContainerResponse = {
            ok: true,
            protocolVersion: WIRE_PROTOCOL_VERSION,
            correlationId: request.correlationId,
            ...out,
          };
          return sendJson(res, 200, ok);
        } catch (error) {
          const fail: ContainerResponse = {
            ok: false,
            protocolVersion: WIRE_PROTOCOL_VERSION,
            correlationId: request.correlationId,
            kind: "provider_error",
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          };
          return sendJson(res, 502, fail);
        }
      }

      sendJson(res, 404, { ok: false, message: "Not found" });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Bind only on the provided port; in Docker this is on the internal network.
  server.listen(options.port, () => {
    // Metadata only — never log request bodies.
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        source: "container",
        event: "container.listening",
        containerId: options.provider.descriptor.id,
        port: options.port,
        deploymentMode: mode,
        certSource: source,
      }),
    );
  });
}
