/**
 * H.A.R.P.™ — PII-aware logging.
 *
 * Logging is restricted to a fixed set of safe, structured fields. There is no
 * method that accepts free-form payload text, so prompt/response content cannot
 * be logged by accident. Only metadata (ids, classes, counts, timings, error
 * kinds) is ever emitted.
 */

export interface SafeLogFields {
  event: string;
  correlationId?: string;
  containerId?: string;
  modelClass?: string;
  outcome?: "success" | "failure" | "retry" | "failover";
  failureKind?: string;
  attempt?: number;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Redaction summary: kinds + counts only, never values. */
  redactions?: { kind: string; count: number }[];
}

export interface SafeLogger {
  log(fields: SafeLogFields): void;
}

/** Emits one JSON line per event to stdout. Metadata only. */
export class ConsoleSafeLogger implements SafeLogger {
  constructor(private readonly source: string) {}

  log(fields: SafeLogFields): void {
    const line = {
      ts: new Date().toISOString(),
      source: this.source,
      ...fields,
    };
    // Single structured line; no payload fields exist on SafeLogFields.
    console.log(JSON.stringify(line));
  }
}

/** Discards everything; useful in tests. */
export class NullSafeLogger implements SafeLogger {
  log(): void {
    /* intentionally empty */
  }
}
