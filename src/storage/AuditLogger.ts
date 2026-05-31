/**
 * H.A.R.P.™ — Audit logging (AIOS §11).
 *
 * Audit logging is mandatory. The interface is intentionally minimal so it can
 * be backed by Postgres, an append-only event table, or object storage in
 * production. The in-memory implementation is for local development only and
 * is append-only: writes never overwrite prior events.
 */

import { randomUUID } from "node:crypto";
import type { AuditEvent } from "../core/types.js";

export interface AuditQuery {
  workflowId?: string;
  taskId?: string;
  actor?: AuditEvent["actor"];
  riskLevel?: AuditEvent["riskLevel"];
  approvalState?: AuditEvent["approvalState"];
}

export interface AuditLogger {
  write(event: Omit<AuditEvent, "id" | "timestamp">): Promise<AuditEvent>;
  list(): Promise<AuditEvent[]>;
  query(filter: AuditQuery): Promise<AuditEvent[]>;
}

export class InMemoryAuditLogger implements AuditLogger {
  private readonly events: AuditEvent[] = [];

  async write(
    event: Omit<AuditEvent, "id" | "timestamp">,
  ): Promise<AuditEvent> {
    const saved: AuditEvent = {
      ...event,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    // Append-only: the array is never mutated in place.
    this.events.push(saved);
    return saved;
  }

  async list(): Promise<AuditEvent[]> {
    return [...this.events];
  }

  async query(filter: AuditQuery): Promise<AuditEvent[]> {
    return this.events.filter((event) => {
      if (filter.workflowId && event.workflowId !== filter.workflowId) {
        return false;
      }
      if (filter.taskId && event.taskId !== filter.taskId) {
        return false;
      }
      if (filter.actor && event.actor !== filter.actor) {
        return false;
      }
      if (filter.riskLevel && event.riskLevel !== filter.riskLevel) {
        return false;
      }
      if (
        filter.approvalState &&
        event.approvalState !== filter.approvalState
      ) {
        return false;
      }
      return true;
    });
  }
}
