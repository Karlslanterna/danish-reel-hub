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

/** List recent import jobs (newest first). Admin only. */
export const adminListImportJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("import_jobs")
      .select(
        "id, status, phase, message, errors, created_at, updated_at, total_movies, total_cinemas, total_showtimes, processed_movies, processed_cinemas, processed_showtimes",
      )
      .order("created_at", { ascending: false })
      .limit(15);
    if (error) throw new Error("Kunne ikke hente importhistorik");
    return (data ?? []).map((j) => ({
      id: j.id as string,
      status: j.status as string,
      phase: j.phase as string,
      message: (j.message as string | null) ?? null,
      errorCount: ((j.errors as string[] | null) ?? []).length,
      createdAt: j.created_at as string,
      updatedAt: j.updated_at as string,
      movies: j.processed_movies as number,
      cinemas: j.processed_cinemas as number,
      showtimes: j.processed_showtimes as number,
      totalMovies: j.total_movies as number,
      totalCinemas: j.total_cinemas as number,
      totalShowtimes: j.total_showtimes as number,
    }));
  });

/** Re-queue the data from a previous (failed) import job. Admin only. */
export const adminRetryImportJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: job, error } = await supabaseAdmin
      .from("import_jobs")
      .select("xml")
      .eq("id", data.jobId)
      .maybeSingle();
    if (error || !job?.xml) throw new Error("Kunne ikke genstarte importen");
    const { createImportJob } = await import("@/lib/kultunaut/import.server");
    return createImportJob(job.xml as string);
  });
