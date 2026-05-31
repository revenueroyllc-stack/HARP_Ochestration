/**
 * H.A.R.P.™ — Observability layer (OpenTelemetry-shaped).
 *
 * Vendor-neutral interfaces for the three OpenTelemetry signal types: traces,
 * metrics, and logs. The core depends only on these interfaces, so a real
 * OpenTelemetry SDK exporter (OTLP → Jaeger/Tempo/X-Ray, Prometheus, etc.) can
 * be injected at the composition root without touching agents or orchestration.
 *
 * The default implementation is in-memory so behavior is fully testable and the
 * system runs offline. Swapping to a real exporter is a composition-root change.
 *
 * IMPORTANT: like SafeLogger, this layer is metadata-only by construction. Span
 * and metric attributes are typed to scalars; there is no API to attach prompt
 * or response payloads, so observability cannot become a PII leak.
 */

export type AttributeValue = string | number | boolean;
export type Attributes = Record<string, AttributeValue>;

export type SpanStatus = "unset" | "ok" | "error";

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly name: string;
  setAttribute(key: string, value: AttributeValue): void;
  addEvent(name: string, attributes?: Attributes): void;
  setStatus(status: SpanStatus, message?: string): void;
  end(): void;
}

export interface Tracer {
  /** Starts a span. If parent is provided, the new span is its child. */
  startSpan(name: string, attributes?: Attributes, parent?: Span): Span;
}

export interface Counter {
  add(value: number, attributes?: Attributes): void;
}

export interface Histogram {
  record(value: number, attributes?: Attributes): void;
}

export interface Meter {
  counter(name: string): Counter;
  histogram(name: string): Histogram;
}

export type LogSeverity = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  severity: LogSeverity;
  body: string;
  attributes?: Attributes;
}

export interface LogEmitter {
  emit(record: LogRecord): void;
}

/** The full observability surface a component receives. */
export interface Observability {
  readonly tracer: Tracer;
  readonly meter: Meter;
  readonly logs: LogEmitter;
}
