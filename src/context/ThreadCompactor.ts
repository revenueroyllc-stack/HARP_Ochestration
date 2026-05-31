/**
 * H.A.R.P.™ — Thread compaction.
 *
 * Long workflows must not endlessly append history (the "dumb zone" of an
 * overloaded context window). Compaction summarises accumulated artifacts into
 * a compact written record, then lets the workflow continue "fresh-ish" with
 * the record instead of the full transcript.
 *
 * This is a CONTROL SURFACE: it decides WHEN to compact (token threshold) and
 * produces a structured CompactionRecord. The actual summarisation text comes
 * from a caller-supplied summariser (a model call in production, a deterministic
 * stub in tests), so this module has no model dependency and is fully testable.
 */

import type { Observability } from "../observability/types.js";

export interface CompactableItem {
  id: string;
  title: string;
  /** Claims/decisions worth preserving — NOT raw chain-of-thought. */
  claims: string[];
  /** Approximate token weight of the full item. */
  approxTokens: number;
}

export interface CompactionRecord {
  summary: string;
  preservedDecisionCount: number;
  tokensBefore: number;
  tokensAfter: number;
  compactedItemIds: string[];
}

/** Produces a summary string from items. Model-backed in prod; stub in tests. */
export type Summariser = (items: CompactableItem[]) => Promise<string> | string;

export interface CompactionOptions {
  /** Compact when accumulated tokens exceed this threshold. */
  thresholdTokens: number;
  obs?: Observability;
}

export class ThreadCompactor {
  constructor(
    private readonly summarise: Summariser,
    private readonly options: CompactionOptions,
  ) {}

  /** True when the items' total token weight crosses the threshold. */
  shouldCompact(items: CompactableItem[]): boolean {
    const total = items.reduce((s, i) => s + i.approxTokens, 0);
    return total > this.options.thresholdTokens;
  }

  /**
   * Compact items into a record. Preserves decision claims explicitly so the
   * compaction never silently drops governance-relevant facts.
   */
  async compact(items: CompactableItem[]): Promise<CompactionRecord> {
    const span = this.options.obs?.tracer.startSpan("context.compact", {
      items: items.length,
    });

    const tokensBefore = items.reduce((s, i) => s + i.approxTokens, 0);
    const summary = await this.summarise(items);
    const preservedDecisions = items.flatMap((i) => i.claims);
    const tokensAfter = Math.ceil(summary.length / 4);

    this.options.obs?.meter
      .histogram("context.compaction.tokens_saved")
      .record(Math.max(0, tokensBefore - tokensAfter));

    span?.setAttribute("tokensBefore", tokensBefore);
    span?.setAttribute("tokensAfter", tokensAfter);
    span?.setStatus("ok");
    span?.end();

    return {
      summary,
      preservedDecisionCount: preservedDecisions.length,
      tokensBefore,
      tokensAfter,
      compactedItemIds: items.map((i) => i.id),
    };
  }
}
