// F17 AI optimizer: OPT-01..OPT-05 (plan .plans/e2e-scenarios.md, "F17 AI optimizer").
//
// Verified against the code:
// - Every /api/opt/* route is WORKSPACE-scoped (resolveWorkspaceContextForRequest;
//   reads need canReadWorkspace, mutations canWriteWorkspace, else 403;
//   anonymous 401). Experiments, variants, metrics, auto actions and even the
//   "global" signals (lib/ai/content-global-optimizer.ts trainGlobalSignals /
//   getLatestGlobalSignals with the caller's organizationId) are filtered by
//   the workspace; a foreign experiment/variant/action answers 404.
// - The /app/admin/experiments, /[id] and /auto-actions pages have no
//   platform-admin gate (app/app/admin/layout.tsx has none; only the uptime,
//   feature-flags and audit-logs pages call requirePlatformAdminPage); they
//   read the caller's active workspace (resolveWorkspaceContext) and 404 a
//   foreign experiment (summariseExperiment(id, organizationId) -> notFound()).
// - Detail page (app/app/admin/experiments/[id]): h1 "Eksperimen #<id>",
//   "Konten #<contentId> • Axis <axis> • Status <status>", "Varian & Metrik"
//   table, BayesianStatsPanel ("Analisis Bayesian A/B", rows "<conv> / <impr>",
//   behind flag bayesian_ab_overlay, default on), VariantActionPanel buttons
//   "Generate Variant" (POST /api/opt/local/variant), "Simpan Metrik" (POST
//   /api/opt/local/metrics) and "Set Pemenang" (POST /api/opt/choose-winner),
//   with feedback texts "Varian AI baru dihasilkan.", "Metrik varian
//   diperbarui.", "Pemenang eksperimen diset.".
// - lib/ai/content-local-optimizer.ts chooseWinner() only sets
//   winnerVariantId/status completed/endAt; it does NOT create an AiAutoAction.
//   The only AiAutoAction producer reachable over HTTP is
//   POST /api/opt/schedule/apply -> lib/ai/scheduler.ts
//   applyScheduleRecommendation() -> lib/ai/approval-gates.ts logAutoAction
//   (actionType SCHEDULE_UPDATE, plus an AI_AUTO_ACTION audit row, entity
//   "AiAutoAction"). /app/admin/auto-actions is read-only (no Revert button);
//   revert is POST /api/opt/auto/revert {actionId, reason} (status reverted,
//   reason replaced, AI_AUTO_REVERT audit row).
// - OPT-04 payload (app/api/opt/schedule/apply/route.ts requestSchema):
//   { contentId:int, experimentId?:int, variantId?:int, recommendation:
//   { recommendedAt, day, hour:int, confidence, reason, quotaRemaining, limit,
//   autoEligible, source: "local"|"global" } }. The gate
//   (evaluateAutoPublish) recomputes the quota and uses only `confidence`
//   (SCHEDULE threshold 0.75) and sampleSize = max(round(confidence*120), 60)
//   (>= 50), so confidence 0.9 reaches auto-publish. The quota
//   (AI_SA_MAX_AUTOPUBLISH_PER_DAY, 1 in playwright.env.ts) counts only
//   AUTOPUBLISH actions created today, but applyScheduleRecommendation logs
//   SCHEDULE_UPDATE and nothing in the app creates AUTOPUBLISH, so the quota
//   is never consumed: product bug, OPT-04b is test.fail.
// - There is no GET /api/opt/global route (only POST /api/opt/global/train);
//   recommend (POST /api/opt/schedule/recommend {contentId}) uses the best
//   SCHEDULE variant with impressions in the workspace (source "local"), else
//   the workspace's trained schedule insights (source "global", confidence
//   0.72), else 404. "Stubbed signals" are therefore metrics the test records.
// - The RBAC workspace holds leftover experiments (WS-06); every scenario here
//   uses fresh users/workspaces and never counts shared rows.
import { expect, test, type Api } from "../../fixtures";
import type { ExperimentRecord } from "../../support/api-factories";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const randomContentId = () => 100_000 + Math.floor(Math.random() * 1_000_000_000);

type Variant = ExperimentRecord["variants"][number] & {
  performance: { impressions: number; clicks: number; conversions: number; dwellMs: number };
  payload: Record<string, unknown>;
};
type ExperimentView = {
  experiment: ExperimentRecord["experiment"] & { status: string; winnerVariantId: number | null; endAt: string | null };
  variants: Variant[];
  baselineVariantId: number | null;
  winnerVariantId: number | null;
};
type AutoAction = {
  id: number;
  organizationId: string | null;
  actionType: string;
  contentId: number | null;
  experimentId: number | null;
  variantId: number | null;
  reason: string | null;
  confidence: number | null;
  status: string;
};
type Recommendation = {
  recommendedAt: string;
  day: string;
  hour: number;
  confidence: number;
  reason: string;
  quotaRemaining: number;
  limit: number;
  autoEligible: boolean;
  source: "local" | "global";
};

async function json<T>(responsePromise: ReturnType<Api["get"]>, status = 200, label = "request"): Promise<T> {
  const response = await responsePromise;
  expect(response.status(), `${label}: ${await response.text().catch(() => "")}`).toBe(status);
  return (await response.json()) as T;
}

const getExperiment = (api: Api, id: number) =>
  json<{ experiment: ExperimentView }>(api.get(`/api/opt/variants/${id}`), 200, `GET /api/opt/variants/${id}`).then(
    (body) => body.experiment,
  );

const autoLogs = (api: Api) =>
  json<{ actions: AutoAction[] }>(api.get("/api/opt/auto/logs?limit=100"), 200, "GET /api/opt/auto/logs").then(
    (body) => body.actions,
  );

/** A schedule recommendation the gate auto-applies (see header: confidence >= 0.75). */
const autoRecommendation = (reason: string, overrides: Partial<Recommendation> = {}): Recommendation => ({
  recommendedAt: new Date(Date.now() + 86_400_000).toISOString(),
  day: "Rabu",
  hour: 10,
  confidence: 0.9,
  reason,
  quotaRemaining: 1,
  limit: 1,
  autoEligible: true,
  source: "local",
  ...overrides,
});

const metrics = (variantId: number, impressions: number, clicks: number, conversions: number) => ({
  variantId,
  impressions,
  clicks,
  conversions,
  dwellMs: 60_000,
});

test.describe("AI optimizer", () => {
  test(
    "OPT-01 starting an experiment lists it, the detail page shows 'Eksperimen #id', and the experiments/variants APIs return it",
    {
      annotation: covers("/app/admin/experiments", "/app/admin/experiments/[id]", "/api/opt/local/start", "/api/opt/experiments", "/api/opt/variants/[experimentId]"),
    },
    async ({ isolatedUser, newApiUser, playwright, baseURL }) => {
      const { page, api } = isolatedUser;
      const contentId = randomContentId();
      const hook = `OPT-01 hook ${tag()}`;

      await page.goto("/app/admin/experiments");
      await expect(page.getByRole("heading", { name: "Mulai Eksperimen" })).toBeVisible();
      await expect(page.getByText("Tidak ada eksperimen aktif.")).toBeVisible();

      await page.getByLabel("Content ID").fill(String(contentId));
      await page.getByLabel("Hook", { exact: true }).fill(hook);
      await page.getByRole("button", { name: "Mulai Eksperimen" }).click();
      await expect(page.getByText("Eksperimen dimulai. Variasi baseline siap diukur.")).toBeVisible();

      const row = page.getByRole("row").filter({ hasText: `Content #${contentId}` });
      await expect(row).toBeVisible();
      await expect(row).toContainText("Hook");
      await expect(row).toContainText("Running");
      await expect(row).toContainText(hook);

      await row.getByRole("link", { name: "Lihat" }).click();
      await expect(page).toHaveURL(/\/app\/admin\/experiments\/\d+$/);
      const id = Number(new URL(page.url()).pathname.split("/").pop());
      await expect(page.getByRole("heading", { name: `Eksperimen #${id}`, exact: true })).toBeVisible();
      await expect(page.getByText(`Konten #${contentId} • Axis HOOK • Status running`)).toBeVisible();

      const { experiments } = await json<{ experiments: ExperimentView[] }>(api.get("/api/opt/experiments"), 200, "GET /api/opt/experiments");
      const listed = experiments.find((entry) => entry.experiment.id === id);
      expect(listed?.experiment).toMatchObject({ contentId, axis: "HOOK", status: "running", organizationId: isolatedUser.user.workspace.organizationId });
      expect(listed?.variants.map((variant) => [variant.variantKey, variant.payload.hook])).toEqual([["baseline", hook]]);

      const detail = await getExperiment(api, id);
      expect(detail.experiment).toMatchObject({ id, contentId, axis: "HOOK" });
      expect(detail.baselineVariantId).toBe(detail.variants[0].id);

      // Tenant scoped: another workspace sees nothing.
      const other = await newApiUser("opt01-other");
      expect((await other.api.get(`/api/opt/variants/${id}`)).status()).toBe(404);
      const otherList = await json<{ experiments: ExperimentView[] }>(other.api.get("/api/opt/experiments"));
      expect(otherList.experiments.some((entry) => entry.experiment.id === id)).toBe(false);
      expect((await other.api.get(`/app/admin/experiments/${id}`)).status(), "detail page of a foreign experiment").toBe(404);

      const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
      try {
        expect((await anonymous.get("/api/opt/experiments")).status()).toBe(401);
      } finally {
        await anonymous.dispose();
      }
    },
  );

  test(
    "OPT-02 generating a variant and recording metrics renders both variants and the Bayesian panel",
    { annotation: covers("/app/admin/experiments/[id]", "/api/opt/local/variant", "/api/opt/local/metrics") },
    async ({ isolatedUser, newApiUser }) => {
      const { page, api, factory } = isolatedUser;
      const hook = `OPT-02 hook ${tag()}`;
      const { experiment } = await factory.createExperiment({ baseline: { hook } });

      await page.goto(`/app/admin/experiments/${experiment.id}`);
      await expect(page.getByRole("heading", { name: `Eksperimen #${experiment.id}`, exact: true })).toBeVisible();
      const insight = page.locator("section").filter({ has: page.getByRole("heading", { name: "Varian & Metrik" }) });
      await expect(insight.locator("tbody tr")).toHaveCount(1);

      await page.getByRole("button", { name: "Generate Variant" }).click();
      await expect(page.getByText("Varian AI baru dihasilkan.")).toBeVisible();
      await expect(insight.locator("tbody tr")).toHaveCount(2);

      const generated = await getExperiment(api, experiment.id);
      expect(generated.variants.map((variant) => variant.variantKey).sort()).toEqual(["baseline", "variant-1"]);
      const baseline = generated.variants.find((variant) => variant.variantKey === "baseline")!;
      const challenger = generated.variants.find((variant) => variant.variantKey === "variant-1")!;

      // Baseline metrics through the form, challenger metrics through the API.
      const metricsForm = page.locator("form").filter({ has: page.getByRole("heading", { name: "Catat Metrik Varian" }) });
      await metricsForm.getByRole("combobox").selectOption(String(baseline.id));
      await page.getByLabel("Impressions").fill("200");
      await page.getByLabel("Clicks").fill("30");
      await page.getByLabel("Conversions").fill("12");
      await page.getByRole("button", { name: "Simpan Metrik" }).click();
      await expect(page.getByText("Metrik varian diperbarui.")).toBeVisible();

      const recorded = await json<{ metrics: { impressions: number; conversions: number } }>(
        api.post("/api/opt/local/metrics", { data: metrics(challenger.id, 200, 40, 20) }),
        200,
        "POST /api/opt/local/metrics",
      );
      expect(recorded.metrics).toMatchObject({ impressions: 200, conversions: 20 });

      const measured = await getExperiment(api, experiment.id);
      expect(measured.variants.find((variant) => variant.id === baseline.id)?.performance).toMatchObject({ impressions: 200, clicks: 30, conversions: 12 });
      expect(measured.variants.find((variant) => variant.id === challenger.id)?.performance).toMatchObject({ impressions: 200, clicks: 40, conversions: 20 });

      await page.reload();
      const bayesian = page.locator("section").filter({ has: page.getByRole("heading", { name: "Analisis Bayesian A/B" }) });
      await expect(bayesian).toBeVisible();
      await expect(bayesian.locator("tbody tr")).toHaveCount(2);
      await expect(bayesian.locator("tbody tr").filter({ hasText: "baseline" })).toContainText("12 / 200");
      await expect(bayesian.locator("tbody tr").filter({ hasText: "variant-1" })).toContainText("20 / 200");

      // A foreign workspace cannot write metrics to these variants.
      const other = await newApiUser("opt02-other");
      expect((await other.api.post("/api/opt/local/metrics", { data: metrics(challenger.id, 1, 1, 1) })).status()).toBe(404);
      expect((await other.api.post("/api/opt/local/variant", { data: { experimentId: experiment.id } })).status()).toBe(404);
    },
  );

  test(
    "OPT-03 'Set Pemenang' completes the experiment; a schedule auto action appears on /app/admin/auto-actions and the revert API marks it reverted",
    {
      annotation: [
        ...covers("/app/admin/experiments/[id]", "/api/opt/choose-winner", "/app/admin/auto-actions", "/api/opt/auto/logs", "/api/opt/auto/revert", "/api/opt/schedule/apply"),
        {
          type: "doc-mismatch",
          description:
            "The plan expects choosing a winner to create an AiAutoAction and a Revert control on /app/admin/auto-actions. In code chooseWinner() (lib/ai/content-local-optimizer.ts) writes no AiAutoAction (asserted), the only producer is POST /api/opt/schedule/apply (SCHEDULE_UPDATE), and the auto-actions page is read-only; revert is API-only (POST /api/opt/auto/revert).",
        },
      ],
    },
    async ({ isolatedUser, newApiUser }) => {
      const { page, api, factory } = isolatedUser;
      const { experiment } = await factory.createExperiment({ baseline: { hook: `OPT-03 hook ${tag()}` } });
      const withVariant = await json<{ experiment: ExperimentView }>(
        api.post("/api/opt/local/variant", { data: { experimentId: experiment.id, tone: "urgent", targetMetric: "conversions" } }),
        200,
        "POST /api/opt/local/variant",
      );
      const challenger = withVariant.experiment.variants.find((variant) => variant.variantKey === "variant-1")!;
      expect(challenger).toBeTruthy();

      await page.goto(`/app/admin/experiments/${experiment.id}`);
      const winnerForm = page.locator("form").filter({ has: page.getByRole("heading", { name: "Tetapkan Pemenang" }) });
      await winnerForm.getByRole("combobox").selectOption(String(challenger.id));
      await page.getByRole("button", { name: "Set Pemenang" }).click();
      await expect(page.getByText("Pemenang eksperimen diset.")).toBeVisible();
      await expect(page.getByText(`Axis HOOK • Status completed`)).toBeVisible();

      const completed = await getExperiment(api, experiment.id);
      expect(completed.experiment.status).toBe("completed");
      expect(completed.experiment.endAt).not.toBeNull();
      expect(completed.winnerVariantId).toBe(challenger.id);
      expect(completed.variants.find((variant) => variant.id === challenger.id)?.isWinner).toBe(true);

      await page.goto("/app/admin/experiments");
      await expect(page.getByRole("row").filter({ hasText: `Content #${experiment.contentId}` })).toContainText("Completed");

      // Choosing a winner logs no auto action (plan mismatch, see annotation).
      expect((await autoLogs(api)).filter((action) => action.experimentId === experiment.id)).toEqual([]);

      const reason = `OPT-03 schedule ${tag()}`;
      const applied = await json<{ applied: boolean; action: AutoAction }>(
        api.post("/api/opt/schedule/apply", {
          data: {
            contentId: experiment.contentId,
            experimentId: experiment.id,
            variantId: challenger.id,
            recommendation: autoRecommendation(reason),
          },
        }),
        200,
        "POST /api/opt/schedule/apply",
      );
      expect(applied.applied).toBe(true);
      expect(applied.action).toMatchObject({
        actionType: "SCHEDULE_UPDATE",
        status: "applied",
        experimentId: experiment.id,
        variantId: challenger.id,
        organizationId: isolatedUser.user.workspace.organizationId,
      });
      const actionId = applied.action.id;
      expect((await autoLogs(api)).find((action) => action.id === actionId)).toMatchObject({ status: "applied" });

      await page.goto("/app/admin/auto-actions");
      await expect(page.getByRole("heading", { name: "AUTO Actions Log" })).toBeVisible();
      const actionRow = page.getByRole("row").filter({ hasText: reason });
      await expect(actionRow).toContainText("Schedule Update");
      await expect(actionRow).toContainText("applied");
      await expect(actionRow).toContainText("90.0%");

      // Another workspace cannot see or revert it.
      const other = await newApiUser("opt03-other");
      expect((await autoLogs(other.api)).some((action) => action.id === actionId)).toBe(false);
      expect((await other.api.post("/api/opt/auto/revert", { data: { actionId } })).status()).toBe(404);

      const revertReason = `OPT-03 revert ${tag()}`;
      const reverted = await json<{ action: AutoAction }>(
        api.post("/api/opt/auto/revert", { data: { actionId, reason: revertReason } }),
        200,
        "POST /api/opt/auto/revert",
      );
      expect(reverted.action).toMatchObject({ id: actionId, status: "reverted", reason: revertReason });
      expect((await autoLogs(api)).find((action) => action.id === actionId)).toMatchObject({ status: "reverted" });

      await page.reload();
      await expect(page.getByRole("row").filter({ hasText: revertReason })).toContainText("reverted");

      // Both steps are audited (entity "AiAutoAction").
      await expect
        .poll(async () => {
          const response = await api.get("/api/admin/audit-logs?entity=AiAutoAction");
          const { logs } = (await response.json()) as { logs: Array<{ action: string; entityId: string }> };
          return logs.filter((log) => log.entityId === String(actionId)).map((log) => log.action).sort();
        })
        .toEqual(["AI_AUTO_ACTION", "AI_AUTO_REVERT"]);
    },
  );

  test(
    "OPT-04a a schedule/apply payload with confidence 0.9 reaches auto-publish under AI_SA_MAX_AUTOPUBLISH_PER_DAY=1 and is logged",
    { annotation: covers("/api/opt/schedule/apply", "/api/opt/schedule/recommend", "/api/opt/auto/logs") },
    async ({ newApiUser }) => {
      const { api, factory } = await newApiUser("opt04a");
      const { experiment, variants } = await factory.createExperiment({ axis: "SCHEDULE", baseline: { schedule: { day: "Rabu", hour: 10 } } });
      await json(api.post("/api/opt/local/metrics", { data: metrics(variants[0].id, 120, 12, 6) }), 200, "metrics");

      // The app's own recommendation reports the configured daily limit.
      const { recommendation } = await json<{ recommendation: Recommendation }>(
        api.post("/api/opt/schedule/recommend", { data: { contentId: experiment.contentId } }),
        200,
        "POST /api/opt/schedule/recommend",
      );
      expect(recommendation).toMatchObject({ limit: 1, source: "local", day: "Rabu", hour: 10 });

      const reason = `OPT-04a ${tag()}`;
      const first = await json<{ applied: boolean; evaluation: { decision: string; limit: number; quotaRemaining: number }; action: AutoAction }>(
        api.post("/api/opt/schedule/apply", {
          data: { contentId: experiment.contentId, experimentId: experiment.id, recommendation: { ...recommendation, confidence: 0.9, reason } },
        }),
        200,
        "first apply",
      );
      expect(first).toMatchObject({ applied: true, evaluation: { decision: "auto", limit: 1, quotaRemaining: 0 } });
      expect(first.action).toMatchObject({ actionType: "SCHEDULE_UPDATE", status: "applied", contentId: experiment.contentId });
      expect((await autoLogs(api)).filter((action) => action.contentId === experiment.contentId).map((action) => action.id)).toEqual([first.action.id]);

      // Below the SCHEDULE confidence threshold (0.75) the gate asks for approval and logs nothing.
      const low = await json<{ applied: boolean; evaluation: { decision: string } }>(
        api.post("/api/opt/schedule/apply", {
          data: { contentId: experiment.contentId, recommendation: autoRecommendation(`OPT-04a low ${tag()}`, { confidence: 0.5 }) },
        }),
        200,
        "low-confidence apply",
      );
      expect(low).toMatchObject({ applied: false, evaluation: { decision: "needs_approval" } });
      expect((await autoLogs(api)).filter((action) => action.contentId === experiment.contentId)).toHaveLength(1);
    },
  );

  test(
    "OPT-04b with AI_SA_MAX_AUTOPUBLISH_PER_DAY=1 the second auto-publish of the day is blocked and only the first is logged",
    {
      annotation: [
        ...covers("/api/opt/schedule/apply", "/api/opt/auto/logs"),
        {
          type: "product-bug",
          description:
            "The daily auto-publish quota is never consumed: lib/ai/approval-gates.ts getAutoPublishUsage counts only actionType AUTOPUBLISH, but applyScheduleRecommendation (lib/ai/scheduler.ts) logs SCHEDULE_UPDATE and nothing in the app creates AUTOPUBLISH. With AI_SA_MAX_AUTOPUBLISH_PER_DAY=1 the second POST /api/opt/schedule/apply still answers { applied: true } and a second action is logged. Also: the gate trusts the client-supplied recommendation.confidence.",
        },
      ],
    },
    async ({ newApiUser }) => {
      test.fail(true, "product bug: schedule auto-applies never consume the AI_SA_MAX_AUTOPUBLISH_PER_DAY quota (approval-gates counts AUTOPUBLISH only)");
      const { api } = await newApiUser("opt04b");
      const contentId = randomContentId();
      const apply = (reason: string) =>
        json<{ applied: boolean; evaluation: { decision: string; reason: string; quotaRemaining: number }; message?: string }>(
          api.post("/api/opt/schedule/apply", { data: { contentId, recommendation: autoRecommendation(reason) } }),
          200,
          "POST /api/opt/schedule/apply",
        );

      const first = await apply(`OPT-04b first ${tag()}`);
      expect(first).toMatchObject({ applied: true, evaluation: { decision: "auto" } });

      const second = await apply(`OPT-04b second ${tag()}`);
      expect(second, "second auto-publish of the day is blocked by the quota").toMatchObject({
        applied: false,
        evaluation: { decision: "needs_approval", quotaRemaining: 0 },
        message: "Kuota autopublish harian habis",
      });
      expect((await autoLogs(api)).filter((action) => action.contentId === contentId)).toHaveLength(1);
    },
  );

  test(
    "OPT-05 recommend, global/train and the local start/variant/metrics APIs work per workspace; GET /api/opt/global does not exist",
    {
      annotation: [
        ...covers("/api/opt/schedule/recommend", "/api/opt/global/train", "/api/opt/local/start", "/api/opt/local/variant", "/api/opt/local/metrics", "/api/opt/experiments"),
        {
          type: "doc-mismatch",
          description:
            "The plan lists GET /api/opt/global; no such route exists (app/api/opt/global has only train/route.ts with POST), so it answers 404. The 'global' signals are workspace-scoped (trainGlobalSignals({ organizationId })), derived from the workspace's own recorded metrics; there is no external signal source to stub.",
        },
      ],
    },
    async ({ newApiUser }) => {
      const { user, api, factory } = await newApiUser("opt05");
      const empty = await newApiUser("opt05-empty");

      // Local start / variant / metrics via the API.
      const { experiment, variants } = await factory.createExperiment({ axis: "SCHEDULE", baseline: { schedule: { day: "Rabu", hour: 10 } } });
      expect(experiment).toMatchObject({ axis: "SCHEDULE", status: "running", organizationId: user.workspace.organizationId });
      expect(variants.map((variant) => variant.variantKey)).toEqual(["baseline"]);
      const baselineId = variants[0].id;

      const withVariant = await json<{ experiment: ExperimentView }>(
        api.post("/api/opt/local/variant", { data: { experimentId: experiment.id, tone: "curious", targetMetric: "ctr" } }),
        200,
        "POST /api/opt/local/variant",
      );
      expect(withVariant.experiment.variants.map((variant) => variant.variantKey).sort()).toEqual(["baseline", "variant-1"]);
      expect(withVariant.experiment.variants.find((variant) => variant.variantKey === "variant-1")?.payload.schedule).toBeTruthy();

      await json(api.post("/api/opt/local/metrics", { data: metrics(baselineId, 200, 25, 8) }), 200, "metrics");
      expect((await api.post("/api/opt/local/metrics", { data: { variantId: baselineId } })).status(), "invalid metrics payload").toBe(400);
      expect((await api.post("/api/opt/local/start", { data: { contentId: 1, axis: "NOPE", baseline: {} } })).status(), "invalid start payload").toBe(400);

      const { experiments } = await json<{ experiments: ExperimentView[] }>(api.get("/api/opt/experiments?axis=SCHEDULE"));
      expect(experiments.map((entry) => entry.experiment.id)).toEqual([experiment.id]);

      // Recommendation from the local experiment...
      const local = await json<{ recommendation: Recommendation }>(
        api.post("/api/opt/schedule/recommend", { data: { contentId: experiment.contentId } }),
        200,
        "recommend (local)",
      );
      expect(local.recommendation).toMatchObject({ source: "local", day: "Rabu", hour: 10, limit: 1 });
      expect(Number.isNaN(Date.parse(local.recommendation.recommendedAt))).toBe(false);

      // ...and from the workspace's trained schedule insights for unrelated content.
      const global = await json<{ recommendation: Recommendation }>(
        api.post("/api/opt/schedule/recommend", { data: { contentId: randomContentId() } }),
        200,
        "recommend (global)",
      );
      expect(global.recommendation).toMatchObject({ source: "global", day: "Rabu", hour: 10, confidence: 0.72, autoEligible: false });

      // A workspace without data has no recommendation.
      expect((await empty.api.post("/api/opt/schedule/recommend", { data: { contentId: experiment.contentId } })).status()).toBe(404);

      expect((await api.get("/api/opt/global")).status(), "GET /api/opt/global is not a route").toBe(404);

      type Signal = {
        axis: string;
        window: string;
        signal: {
          topPerformers: Array<{ experimentId: number; variantId: number; organizationId: string | null }>;
          scheduleInsights?: Array<{ day: string; hour: number; support: number }>;
        };
      };
      const trained = await json<{ signals: Signal[] }>(
        api.post("/api/opt/global/train", { data: { axis: "SCHEDULE" } }),
        200,
        "POST /api/opt/global/train",
      );
      expect(trained.signals.map((signal) => signal.window).sort()).toEqual(["30d", "7d"]);
      for (const signal of trained.signals) {
        expect(signal.axis).toBe("SCHEDULE");
        expect(signal.signal.topPerformers).toEqual([
          expect.objectContaining({ experimentId: experiment.id, variantId: baselineId, organizationId: user.workspace.organizationId }),
        ]);
        expect(signal.signal.scheduleInsights?.[0]).toMatchObject({ day: "Rabu", hour: 10, support: 200 });
      }

      // Workspace scoped: the empty workspace trains to nothing.
      const emptyTrained = await json<{ signals: Signal[] }>(empty.api.post("/api/opt/global/train", { data: {} }), 200, "train (empty)");
      expect(emptyTrained.signals).toEqual([]);
    },
  );
});
