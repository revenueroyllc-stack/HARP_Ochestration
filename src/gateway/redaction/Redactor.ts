/**
 * H.A.R.P.™ — PII redaction (the "no PII on the wire" firewall).
 *
 * The concierge runs a Redactor over every prompt BEFORE constructing the wire
 * envelope. The strongest protection for PII in transit is to not transmit it,
 * so this layer strips or masks identifiers before they can reach a container
 * (which may forward to an external model the operator does not control).
 *
 * IMPORTANT POLICY NOTE: this default redactor covers common, well-defined
 * identifier patterns. It is a MECHANISM, not a complete compliance solution.
 * What counts as PII for a given deployment — and what model vendors are
 * contractually permitted to receive — is a policy decision the operator must
 * define. Provide a custom Redactor to enforce deployment-specific rules.
 */

export interface RedactionFinding {
  kind: string;
  /** Number of occurrences masked. Never the value itself. */
  count: number;
}

export interface RedactionResult {
  text: string;
  findings: RedactionFinding[];
}

export interface Redactor {
  readonly name: string;
  redact(text: string): RedactionResult;
}

interface Rule {
  kind: string;
  pattern: RegExp;
  /** Builds the replacement token; keeps a stable label, never the value. */
  token: string;
}

/**
 * Default rule set. Patterns are conservative (favour over-redaction). Each
 * matched value is replaced with a typed placeholder so the model still knows
 * a value WAS present (useful for reasoning) without seeing it.
 */
const DEFAULT_RULES: Rule[] = [
  {
    kind: "email",
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    token: "[REDACTED_EMAIL]",
  },
  {
    // International-ish phone numbers: optional +, 7-15 digits with separators.
    kind: "phone",
    pattern: /(?<!\w)(\+?\d[\d\s().-]{6,}\d)(?!\w)/g,
    token: "[REDACTED_PHONE]",
  },
  {
    // Credit-card-like: 13-16 digits, optional spaces/dashes in groups.
    kind: "credit_card",
    pattern: /(?<!\d)(?:\d[ -]?){13,16}(?!\d)/g,
    token: "[REDACTED_CC]",
  },
  {
    // US SSN style.
    kind: "ssn",
    pattern: /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g,
    token: "[REDACTED_SSN]",
  },
  {
    // IPv4.
    kind: "ip",
    pattern: /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g,
    token: "[REDACTED_IP]",
  },
  {
    // Common secret/key prefixes (provider tokens, etc.).
    kind: "secret_token",
    pattern: /\b(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{12,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    token: "[REDACTED_SECRET]",
  },
  {
    // Bearer tokens / Authorization headers leaking into text.
    kind: "bearer",
    pattern: /\bBearer\s+[A-Za-z0-9._\-]+/gi,
    token: "[REDACTED_BEARER]",
  },
];

export class DefaultRedactor implements Redactor {
  readonly name = "default-redactor";
  private readonly rules: Rule[];

  constructor(extraRules: Rule[] = []) {
    // Order matters: secrets and structured IDs before the broad phone rule,
    // which is the greediest. Credit cards before phone for the same reason.
    this.rules = [
      DEFAULT_RULES[4]!, // ip
      DEFAULT_RULES[5]!, // secret_token
      DEFAULT_RULES[6]!, // bearer
      DEFAULT_RULES[0]!, // email
      DEFAULT_RULES[3]!, // ssn
      DEFAULT_RULES[2]!, // credit_card
      DEFAULT_RULES[1]!, // phone
      ...extraRules,
    ];
  }

  redact(text: string): RedactionResult {
    let working = text;
    const findings: RedactionFinding[] = [];

    for (const rule of this.rules) {
      let count = 0;
      working = working.replace(rule.pattern, () => {
        count += 1;
        return rule.token;
      });
      if (count > 0) {
        findings.push({ kind: rule.kind, count });
      }
    }

    return { text: working, findings };
  }
}

/**
 * A pass-through redactor for explicitly trusted, PII-free contexts (e.g.
 * local-only models on the same host). Must be opted into deliberately.
 */
export class NoopRedactor implements Redactor {
  readonly name = "noop-redactor";
  redact(text: string): RedactionResult {
    return { text, findings: [] };
  }
}
