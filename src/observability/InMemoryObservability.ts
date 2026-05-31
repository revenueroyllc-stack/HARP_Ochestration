/**
 * H.A.R.P.™ — In-memory observability implementation.
 *
 * Records spans, metrics, and logs in memory so tests can assert on emitted
 * telemetry and the system runs offline. The recorded shapes mirror what an
 * OpenTelemetry exporter would send, so swapping in a real OTLP exporter later
 * changes only the implementation, not the call sites.
 */

import { randomUUID } from "node:crypto";
import type {
  Attributes,
  AttributeValue,
  Counter,
  Histogram,
  LogEmitter,
  LogRecord,
  Meter,
  Observability,
  Span,
  SpanStatus,
  Tracer,
} from "./types.js";

export interface RecordedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  attributes: Attributes;
  events: { name: string; attributes?: Attributes }[];
  status: SpanStatus;
  statusMessage?: string;
  startedAt: number;
  endedAt?: number;
}

export interface RecordedMetric {
  kind: "counter" | "histogram";
  name: string;
  value: number;
  attributes?: Attributes;
}

class InMemorySpan implements Span {
  constructor(
    readonly traceId: string,
    readonly spanId: string,
    readonly name: string,
    private readonly record: RecordedSpan,
  ) {}

  setAttribute(key: string, value: AttributeValue): void {
    this.record.attributes[key] = value;
  }
  addEvent(name: string, attributes?: Attributes): void {
    this.record.events.push({ name, attributes });
  }
  setStatus(status: SpanStatus, message?: string): void {
    this.record.status = status;
    this.record.statusMessage = message;
  }
  end(): void {
    this.record.endedAt = Date.now();
  }
}

export class InMemoryObservability implements Observability {
  readonly spans: RecordedSpan[] = [];
  readonly metrics: RecordedMetric[] = [];
  readonly logRecords: LogRecord[] = [];

  readonly tracer: Tracer = {
    startSpan: (name, attributes, parent) => {
      const rec: RecordedSpan = {
        traceId: parent?.traceId ?? randomUUID(),
        spanId: randomUUID(),
        parentSpanId: parent?.spanId,
        name,
        attributes: { ...(attributes ?? {}) },
        events: [],
        status: "unset",
        startedAt: Date.now(),
      };
      this.spans.push(rec);
      return new InMemorySpan(rec.traceId, rec.spanId, name, rec);
    },
  };

  readonly meter: Meter = {
    counter: (name): Counter => ({
      add: (value, attributes) =>
        this.metrics.push({ kind: "counter", name, value, attributes }),
    }),
    histogram: (name): Histogram => ({
      record: (value, attributes) =>
        this.metrics.push({ kind: "histogram", name, value, attributes }),
    }),
  };

  readonly logs: LogEmitter = {
    emit: (record) => this.logRecords.push(record),
  };

  /** Convenience for tests: spans with a given name. */
  spansNamed(name: string): RecordedSpan[] {
    return this.spans.filter((s) => s.name === name);
  }
  /** Convenience for tests: metric records with a given name. */
  metricsNamed(name: string): RecordedMetric[] {
    return this.metrics.filter((m) => m.name === name);
  }
}

/** A no-op observability for code paths that do not need telemetry. */
export class NoopObservability implements Observability {
  readonly tracer: Tracer = {
    startSpan: (name) => ({
      traceId: "noop",
      spanId: "noop",
      name,
      setAttribute() {},
      addEvent() {},
      setStatus() {},
      end() {},
    }),
  };
  readonly meter: Meter = {
    counter: () => ({ add() {} }),
    histogram: () => ({ record() {} }),
  };
  readonly logs: LogEmitter = { emit() {} };
}
