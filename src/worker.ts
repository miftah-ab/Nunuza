/// <reference types="@cloudflare/workers-types" />
/**
 * Cloudflare Worker entry point.
 *
 * This file is the `main` target in wrangler.jsonc. It re-exports the
 * Next.js handler from @opennextjs/cloudflare and provides:
 * - fetch(): Next.js application request handler
 * - queue(): Cloudflare Queues consumer executing claimed agent jobs
 * - scheduled(): Cron Trigger handler reconciling stale jobs and claiming due work
 */

import { claimDueJobs, isClaimedAgentJobEnvelope, processJob, reconcileStaleJobs } from "@/lib/jobs/runner";
import { enqueueAutonomousCycles } from "@/lib/jobs/intelligence";
import type { AgentJob } from "@/types/database";

// Next.js request handler provided at runtime by OpenNext
const getHandler = () => {
  return (
    (globalThis as unknown as {
      openNextHandler?: (req: Request, env: unknown, ctx: unknown) => Promise<Response>;
    }).openNextHandler ??
    ((req: Request) => Promise.resolve(new Response("Nunuza worker", { status: 200 })))
  );
};

export default {
  async fetch(
    request: Request,
    env: CloudflareBindings,
    ctx: ExecutionContext
  ): Promise<Response> {
    const handler = getHandler();
    return handler(request, env, ctx);
  },

  /**
   * Cloudflare Queues consumer.
   * Processes batches of agent jobs, updating job states and attempt records.
   */
  async queue(
    batch: MessageBatch<unknown>,
    _env: CloudflareBindings
  ): Promise<void> {
    for (const message of batch.messages) {
      if (!isClaimedAgentJobEnvelope(message.body)) {
        // Malformed or unclaimed messages are poison messages, not retryable jobs.
        // Log only a fixed reason; never serialize untrusted payloads or secrets.
        console.error("[worker-queue] Discarded invalid claimed-job envelope.");
        message.ack();
        continue;
      }

      const job: AgentJob = message.body;
      try {
        const result = await processJob(job);
          if (result.success || !result.retryable) {
            message.ack();
          } else {
            message.retry();
          }
      } catch (err) {
        console.error(`[worker-queue] Failed to process job ${job.id}:`, err);
        message.retry();
      }
    }
  },

  /**
   * Cron Trigger handler.
   * Fires every 5 minutes to reconcile stale jobs and process due scheduled posts.
   */
  async scheduled(
    _controller: ScheduledController,
    env: CloudflareBindings,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          // 1. Reconcile any orphaned/stale jobs whose lease expired while running
          try {
            const reconciled = await reconcileStaleJobs();
            if (reconciled > 0) {
              console.warn(`[worker-scheduled] Reconciled ${reconciled} stale agent jobs.`);
            }
          } catch (reconcileError) {
            // Recovery failures should be retried on the next cron tick, but
            // must not block due jobs that are safe to process now.
            console.error("[worker-scheduled] Could not reconcile stale jobs:", reconcileError);
          }

          // 2. Enqueue one idempotent autonomous operating cycle per eligible
          // workspace/day. The existing job runner remains the only executor.
          try {
            const cycles = await enqueueAutonomousCycles();
            if (cycles.queued > 0) {
              console.info(`[worker-scheduled] Enqueued ${cycles.queued} autonomous workspace cycles.`);
            }
          } catch (cycleError) {
            // Intelligence discovery is additive: a research/eligibility failure
            // must never block existing scheduled posts from being processed.
            console.error("[worker-scheduled] Could not enqueue autonomous cycles:", cycleError);
          }

          // 3. Claim due jobs from database
          const dueJobs = await claimDueJobs({ limit: 10, leaseMinutes: 5 });

          // 4. Dispatch jobs to queue if bound, or process inline
          for (const job of dueJobs) {
            if (env?.AGENT_JOBS_QUEUE?.send) {
              await env.AGENT_JOBS_QUEUE.send(job);
            } else {
              await processJob(job);
            }
          }
        } catch (err) {
          console.error("[worker-scheduled] Execution error:", err);
        }
      })()
    );
  },
} satisfies ExportedHandler<CloudflareBindings>;

interface CloudflareBindings {
  AGENT_JOBS_QUEUE?: Queue;
}
