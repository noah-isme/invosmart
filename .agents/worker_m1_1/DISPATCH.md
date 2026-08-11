## 2026-08-11T01:10:29Z

You are a Worker agent (Identity: teamwork_preview_worker) assigned to Milestone 1: Contextual Bandit Model Migration.
Working directory: /home/noah/project/invosmart/.agents/worker_m1_1

Input Files to Read:
- /home/noah/project/invosmart/.agents/ORIGINAL_REQUEST.md
- /home/noah/project/invosmart/PROJECT.md
- /home/noah/project/invosmart/.agents/sub_orch_m1/SCOPE.md
- /home/noah/project/invosmart/.agents/explorer_m1_1/handoff.md
- /home/noah/project/invosmart/lib/ai/content-local-optimizer.ts

Write Ownership:
You exclusively own and may edit:
- /home/noah/project/invosmart/lib/ai/content-local-optimizer.ts
- /home/noah/project/invosmart/lib/__tests__/content-local-optimizer.test.ts (create this file)

Task Objective:
Implement the LinUCB Contextual Bandit Model migration in `lib/ai/content-local-optimizer.ts` and write a comprehensive unit test suite in `lib/__tests__/content-local-optimizer.test.ts` as specified in the Explorer handoff report.

Detailed Requirements:
1. LinUCB Mathematics & Matrix Helper:
   - Implement an 8x8 matrix inversion helper (Gauss-Jordan elimination with partial pivoting) and matrix/vector operations.
   - Construct 8-dimensional feature vector x_a (bias, CTR, conversion rate, normalized dwell, volume signal, axis context, tone context, target metric weight).
   - Compute LinUCB predicted reward r_hat = theta^T * x_a and uncertainty bound s_a = sqrt(x_a^T * A^-1 * x_a).
   - UCB score = r_hat + alpha * s_a (where alpha = 0.5).
2. Dynamic Confidence Calculation:
   - Replace static artificial formula with dynamic confidence: clamp(0.50 + 0.45 * (1.0 - (s_a / (1.0 + s_a))), 0.50, 0.95).
3. Prior Weight & Matrix Update:
   - In `recordVariantPerformance()`, compute updated observed engagement score r, retrieve/initialize bandit state, update A_new = A_old + x_a * x_a^T and b_new = b_old + r * x_a.
   - Update variant `confidence` in DB with new dynamic confidence calculation based on updated matrix A.
   - Persist bandit state in `payload.metadata.banditState` cleanly.
4. Interface Contract Preservation:
   - Preserve existing signatures: `synthesiseVariantPayload`, `recordVariantPerformance`, `summariseExperiment`, `generateVariant`.
5. Edge Cases & Cold Start:
   - Handle 0 impressions (cold start) with max exploration bonus s_a.
   - Handle 0 conversions with high impressions safely without division by zero.
6. Comprehensive Unit Testing:
   - Create `lib/__tests__/content-local-optimizer.test.ts` testing feature vector extraction, LinUCB matrix operations, cold start behavior, dynamic confidence scaling, performance recording, and full experiment flow.
7. Verification:
   - Run the unit tests using `npm run test` or `npx vitest run lib/__tests__/content-local-optimizer.test.ts` and document exact command output in your handoff.
