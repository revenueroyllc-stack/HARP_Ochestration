/**
 * H.A.R.P.™ — Sequential cheap-test-first validation.
 *
 * Runs validation steps ordered cheapest-first so a fast failing check halts
 * the pipeline BEFORE an expensive, token-heavy step runs. This is a standard
 * CI economy applied to agent workflows: typecheck before full test suite,
 * lint before integration, etc.
 *
 * A "cost" is an abstract weight (tokens, seconds, or money) supplied by the
 * caller; the runner only needs the ordering. Steps are plain async functions
 * returning pass/fail, so this works for shell commands, model calls, or pure
 * checks without coupling to any of them.
 */

import type { Observability } from "../observability/types.js";

export interface ValidationStep {
  name: string;
  /** Abstract cost weight; lower runs first. */
  cost: number;
  run(): Promise<ValidationOutcome> | ValidationOutcome;
}

export interface ValidationOutcome {
  passed: boolean;
  detail?: string;
}

export interface ValidationReport {
  passed: boolean;
  ranSteps: { name: string; passed: boolean; detail?: string }[];
  skipped: string[];
  haltedAt?: string;
}

export class SequentialValidator {
  constructor(private readonly obs?: Observability) {}

  async run(steps: ValidationStep[]): Promise<ValidationReport> {
    const ordered = [...steps].sort((a, b) => a.cost - b.cost);
    const span = this.obs?.tracer.startSpan("validation.run", {
      steps: ordered.length,
    });

    const ran: ValidationReport["ranSteps"] = [];
    const skipped: string[] = [];
    let haltedAt: string | undefined;

    for (let i = 0; i < ordered.length; i++) {
      const step = ordered[i]!;
      const outcome = await step.run();
      ran.push({ name: step.name, passed: outcome.passed, detail: outcome.detail });

      this.obs?.meter.counter("validation.step").add(1, {
        name: step.name,
        passed: outcome.passed,
      });

      if (!outcome.passed) {
        // Halt: everything more expensive is skipped.
        haltedAt = step.name;
        for (let j = i + 1; j < ordered.length; j++) {
          skipped.push(ordered[j]!.name);
        }
        span?.addEvent("validation.halted", { step: step.name });
        span?.setStatus("error", `Halted at ${step.name}`);
        span?.end();
        return { passed: false, ranSteps: ran, skipped, haltedAt };
      }
    }

    span?.setStatus("ok");
    span?.end();
    return { passed: true, ranSteps: ran, skipped };
  }
}
