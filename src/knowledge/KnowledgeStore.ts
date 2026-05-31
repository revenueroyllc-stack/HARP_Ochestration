/**
 * H.A.R.P.™ — Knowledge store.
 *
 * Holds durable project knowledge (architecture docs, SOPs, decisions). In
 * production this would be backed by a vector store plus a reranker; the
 * in-memory implementation does simple substring search so the rest of the
 * system can be wired and tested without external dependencies.
 */

import type { ProjectContext } from "../core/types.js";

export interface KnowledgeHit {
  sourceId: string;
  text: string;
  kind: "architecture" | "sop" | "decision" | "issue" | "history";
}

export interface KnowledgeStore {
  load(context: ProjectContext): Promise<void>;
  search(query: string, limit?: number): Promise<KnowledgeHit[]>;
  all(): Promise<KnowledgeHit[]>;
}

export class InMemoryKnowledgeStore implements KnowledgeStore {
  private hits: KnowledgeHit[] = [];

  async load(context: ProjectContext): Promise<void> {
    const entries: KnowledgeHit[] = [];
    context.architectureDocs.forEach((text, i) =>
      entries.push({ sourceId: `arch:${i}`, text, kind: "architecture" }),
    );
    context.standardOperatingProcedures.forEach((text, i) =>
      entries.push({ sourceId: `sop:${i}`, text, kind: "sop" }),
    );
    context.priorDecisions.forEach((text, i) =>
      entries.push({ sourceId: `decision:${i}`, text, kind: "decision" }),
    );
    context.openIssues.forEach((text, i) =>
      entries.push({ sourceId: `issue:${i}`, text, kind: "issue" }),
    );
    context.workflowHistory.forEach((text, i) =>
      entries.push({ sourceId: `history:${i}`, text, kind: "history" }),
    );
    this.hits = entries;
  }

  async search(query: string, limit = 10): Promise<KnowledgeHit[]> {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);

    if (terms.length === 0) {
      return this.hits.slice(0, limit);
    }

    const scored = this.hits
      .map((hit) => {
        const haystack = hit.text.toLowerCase();
        const score = terms.reduce(
          (acc, term) => acc + (haystack.includes(term) ? 1 : 0),
          0,
        );
        return { hit, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.hit);

    return scored;
  }

  async all(): Promise<KnowledgeHit[]> {
    return [...this.hits];
  }
}
