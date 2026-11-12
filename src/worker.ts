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
import { dispatchPendingNotifications } from "@/lib/notifications/dispatcher";
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
    controller: ScheduledController,
    env: CloudflareBindings,
    ctx: ExecutionContext
  ): Promise<void> {
    // Keep notification delivery on its one-minute cadence, but do not
    // return early: every cron tick must also poll and dispatch due agent jobs.
    if (controller.cron === "* * * * *") {
      ctx.waitUntil(
        dispatchPendingNotifications(50).catch((error) => {
          console.error("[worker-notifications] Delivery pass failed:", error);
        })
      );
    }

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

          // Autonomous discovery is heavier and remains on the five-minute
          // cadence. Ordinary due jobs are polled on every cron tick.
          if (controller.cron === "*/5 * * * *") {
            try {
              const cycles = await enqueueAutonomousCycles();
              if (cycles.queued > 0) {
                console.info(`[worker-scheduled] Enqueued ${cycles.queued} autonomous workspace cycles.`);
              }
            } catch (cycleError) {
              console.error("[worker-scheduled] Could not enqueue autonomous cycles:", cycleError);
            }
          }

          // Claim due jobs every minute. The database RPC uses SKIP LOCKED, so
          // overlapping cron invocations cannot claim the same job.
          const dueJobs = await claimDueJobs({ limit: 10, leaseMinutes: 15 });

          // Dispatch each claimed job independently. A single queue outage must
          // not prevent later jobs in this batch from being attempted.
          for (const job of dueJobs) {
            try {
              if (env?.AGENT_JOBS_QUEUE?.send) {
                await env.AGENT_JOBS_QUEUE.send(job);
              } else {
                await processJob(job);
              }
            } catch (dispatchError) {
              console.error(`[worker-scheduled] Could not dispatch job ${job.id}:`, dispatchError);
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
