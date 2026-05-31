/**
 * H.A.R.P.™ — Agent registry.
 *
 * Constructs and holds the Core Four. The registry is the only place agents
 * are instantiated, keeping the orchestrator decoupled from concrete classes.
 */

import { AGENT_CONFIGS } from "../core/agentConfig.js";
import type { ModelRouter } from "../models/ModelRouter.js";
import type { AuditLogger } from "../storage/AuditLogger.js";
import type { AgentId } from "../core/types.js";
import { HarpAgent } from "./BaseAgent.js";
import { Pharaoh } from "./Pharaoh.js";
import { HorusNexus } from "./HorusNexus.js";
import { AnubisSentinel } from "./AnubisSentinel.js";
import { Ra } from "./Ra.js";

export class AgentRegistry {
  private readonly agents = new Map<AgentId, HarpAgent>();

  constructor(input: {
    modelRouter: ModelRouter;
    auditLogger: AuditLogger;
  }) {
    const { modelRouter, auditLogger } = input;

    this.agents.set(
      "pharaoh",
      new Pharaoh(AGENT_CONFIGS.pharaoh, modelRouter, auditLogger),
    );
    this.agents.set(
      "horus-nexus",
      new HorusNexus(AGENT_CONFIGS["horus-nexus"], modelRouter, auditLogger),
    );
    this.agents.set(
      "anubis-sentinel",
      new AnubisSentinel(
        AGENT_CONFIGS["anubis-sentinel"],
        modelRouter,
        auditLogger,
      ),
    );
    this.agents.set("ra", new Ra(AGENT_CONFIGS.ra, modelRouter, auditLogger));
  }

  get(agentId: AgentId): HarpAgent {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Unknown H.A.R.P. agent: ${agentId}`);
    }
    return agent;
  }

  all(): HarpAgent[] {
    return [...this.agents.values()];
  }
}
