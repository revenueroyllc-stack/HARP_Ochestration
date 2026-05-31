/**
 * H.A.R.P.™ — Memory store.
 *
 * Persists artifacts produced during workflows. Artifacts are immutable
 * (AIOS §21.3): new versions create new artifacts that link to predecessors
 * via `supersedes`. The store never overwrites.
 */

import type { Artifact } from "../core/types.js";

export interface MemoryStore {
  append(artifact: Artifact): Promise<void>;
  list(): Promise<Artifact[]>;
  byWorkflow(workflowId: string): Promise<Artifact[]>;
  byId(id: string): Promise<Artifact | undefined>;
}

export class InMemoryArtifactStore implements MemoryStore {
  private readonly artifacts: Artifact[] = [];

  async append(artifact: Artifact): Promise<void> {
    this.artifacts.push(artifact);
  }

  async list(): Promise<Artifact[]> {
    return [...this.artifacts];
  }

  async byWorkflow(workflowId: string): Promise<Artifact[]> {
    return this.artifacts.filter((a) => a.workflowId === workflowId);
  }

  async byId(id: string): Promise<Artifact | undefined> {
    return this.artifacts.find((a) => a.id === id);
  }
}
