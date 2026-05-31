/**
 * H.A.R.P.™ — Progressive context loading (skill-style, metadata-first).
 *
 * Mirrors the proven SKILL.md pattern: each skill advertises cheap METADATA
 * (name + description, ~tens of tokens) that is always available for selection,
 * while its full BODY (instructions, examples, references) is loaded JUST IN
 * TIME — only once an agent decides the skill is relevant. This keeps the
 * working context in the "smart zone" instead of front-loading everything.
 *
 * Three levels, matching the source material:
 *   Level 1 — metadata only (name + description), always cheap.
 *   Level 2 — body, loaded on demand when the skill is selected.
 *   Level 3 — external references, fetched only if explicitly requested.
 *
 * This is a CONTROL SURFACE: it decides what context is loaded and tracks the
 * token cost of each level, so the savings are measurable once a real model is
 * connected. Bodies/references are provided via loader callbacks so they can be
 * files, a knowledge store, or remote docs without changing this module.
 */

import type { Observability } from "../observability/types.js";

export interface SkillMetadata {
  /** Stable identifier. */
  id: string;
  /** Short human name. */
  name: string;
  /** One-line description used for selection. Keep it cheap (tens of tokens). */
  description: string;
  /** Optional tags to help selection. */
  tags?: string[];
}

export interface SkillBody {
  /** Full instructions loaded just-in-time. */
  instructions: string;
  /** Optional identifiers of Level-3 external references. */
  referenceIds?: string[];
}

/** Loads a skill body on demand (file read, knowledge fetch, etc.). */
export type BodyLoader = (id: string) => Promise<SkillBody> | SkillBody;

/** Loads a Level-3 external reference on demand. */
export type ReferenceLoader = (id: string) => Promise<string> | string;

export interface LoadedContext {
  /** Metadata for every registered skill (Level 1 — always present). */
  catalog: SkillMetadata[];
  /** Bodies for the skills actually selected (Level 2 — JIT). */
  bodies: Record<string, SkillBody>;
  /** External references explicitly pulled (Level 3). */
  references: Record<string, string>;
  /** Approximate tokens consumed, by level, for budgeting/telemetry. */
  tokenCost: { level1: number; level2: number; level3: number };
}

/** Cheap token estimate (~4 chars/token). Good enough for budgeting. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class ProgressiveContextLoader {
  private readonly metadata = new Map<string, SkillMetadata>();
  private readonly bodyLoaders = new Map<string, BodyLoader>();
  private referenceLoader?: ReferenceLoader;

  constructor(private readonly obs?: Observability) {}

  /** Register a skill's metadata and how to load its body. */
  register(meta: SkillMetadata, loadBody: BodyLoader): void {
    if (this.metadata.has(meta.id)) {
      throw new Error(`Skill already registered: ${meta.id}`);
    }
    this.metadata.set(meta.id, meta);
    this.bodyLoaders.set(meta.id, loadBody);
  }

  /** Provide the Level-3 reference loader (optional). */
  setReferenceLoader(loader: ReferenceLoader): void {
    this.referenceLoader = loader;
  }

  /** Level-1 catalog: metadata for all skills. Always cheap. */
  catalog(): SkillMetadata[] {
    return [...this.metadata.values()];
  }

  /**
   * Build a context for a task. `selectedSkillIds` are the skills an agent (or
   * a selection heuristic) decided are relevant — only those bodies are loaded.
   * `referenceIds` pulls Level-3 docs explicitly.
   */
  async load(input: {
    selectedSkillIds: string[];
    referenceIds?: string[];
  }): Promise<LoadedContext> {
    const span = this.obs?.tracer.startSpan("context.progressive_load", {
      selectedSkills: input.selectedSkillIds.length,
      requestedRefs: (input.referenceIds ?? []).length,
    });

    const catalog = this.catalog();
    const level1 = catalog.reduce(
      (sum, m) => sum + estimateTokens(`${m.name}: ${m.description}`),
      0,
    );

    const bodies: Record<string, SkillBody> = {};
    let level2 = 0;
    for (const id of input.selectedSkillIds) {
      const loader = this.bodyLoaders.get(id);
      if (!loader) {
        span?.addEvent("skill.unknown", { id });
        continue;
      }
      const body = await loader(id);
      bodies[id] = body;
      level2 += estimateTokens(body.instructions);
    }

    const references: Record<string, string> = {};
    let level3 = 0;
    for (const refId of input.referenceIds ?? []) {
      if (!this.referenceLoader) {
        span?.addEvent("reference.no_loader", { id: refId });
        continue;
      }
      const text = await this.referenceLoader(refId);
      references[refId] = text;
      level3 += estimateTokens(text);
    }

    const tokenCost = { level1, level2, level3 };

    this.obs?.meter
      .histogram("context.tokens.level1")
      .record(level1);
    this.obs?.meter
      .histogram("context.tokens.level2")
      .record(level2);
    this.obs?.meter
      .histogram("context.tokens.level3")
      .record(level3);

    span?.setAttribute("tokens.level1", level1);
    span?.setAttribute("tokens.level2", level2);
    span?.setAttribute("tokens.level3", level3);
    span?.setStatus("ok");
    span?.end();

    return { catalog, bodies, references, tokenCost };
  }
}
