import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Verify the caller has the 'admin' role via the has_role() SECURITY DEFINER
// function. Throws Unauthorized if not, which the client turns into a redirect.
async function assertAdmin(context: { supabase: ReturnType<typeof Object>; userId: string }) {
  const { supabase, userId } = context as {
    supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
    userId: string;
  };
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error("Forbidden: role lookup failed");
  if (data !== true) throw new Error("Forbidden: admin role required");
}

/** Returns true if the current signed-in user is an admin. */
export const checkIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (error) return { isAdmin: false };
    return { isAdmin: data === true };
  });

/** Create a new Kultunaut import job. Admin only. */
export const adminCreateImportJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ xml: z.string().min(1).max(20_000_000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { createImportJob } = await import("@/lib/kultunaut/import.server");
    return createImportJob(data.xml);
  });

/** Process one batch of an import job. Admin only. */
export const adminProcessImportJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { processJobBatch } = await import("@/lib/kultunaut/import.server");
    return processJobBatch(data.jobId);
  });

/** Read the current status of an import job. Admin only. */
export const adminGetImportJobStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { getJobStatus } = await import("@/lib/kultunaut/import.server");
    const job = await getJobStatus(data.jobId);
    if (!job) throw new Error("Job not found");
    return job;
  });
