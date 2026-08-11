## 2026-08-10T18:50:25Z
You are Worker 1 (teamwork_preview_worker) for Milestone M3 (R3: Federation Bus Asymmetric Encryption).
Your working directory is: /home/noah/project/invosmart/.agents/worker_m3_1

Read the following files before starting work:
- /home/noah/project/invosmart/.agents/ORIGINAL_REQUEST.md
- /home/noah/project/invosmart/PROJECT.md
- /home/noah/project/invosmart/.agents/sub_orch_m3/SCOPE.md
- /home/noah/project/invosmart/.agents/explorer_m3_1/handoff.md

Your task:
Implement asymmetric digital signing (RSA/Ed25519) and hybrid payload encryption (AES-256-GCM) for the Federation Bus in `lib/federation/protocol.ts` and `lib/federation/bus.ts`, and update unit test suites in `test/federation-bus.test.ts` and `test/federation-agent.test.ts`.

Detailed steps from technical blueprint (/home/noah/project/invosmart/.agents/explorer_m3_1/handoff.md):
1. Update `lib/federation/protocol.ts`:
   - Enhance `federationEventSchema` and types (`FederationEvent`, `FederationEventInput`, `SignatureAlgorithm`) to support optional wire encryption fields (`encryptedPayload`, `encryptedKey`, `iv`, `keyId`, `signatureAlgorithm`) alongside optional `payload`. Refine schema to require either `payload` OR valid `encryptedPayload`, `encryptedKey`, and `iv`.
2. Update `lib/federation/bus.ts`:
   - Add export `generateFederationKeyPair()` returning `{ publicKey, privateKey }` via `crypto.generateKeyPairSync("rsa", ...)`.
   - Update `FederationBusOptions` to accept `privateKey`, `publicKey`, `keyId`, `peerPublicKeys`.
   - Support environment fallbacks (`FEDERATION_PRIVATE_KEY`, `FEDERATION_PUBLIC_KEY`, `FEDERATION_KEY_ID`).
   - Implement asymmetric signing using `crypto.createSign("SHA256")` / `crypto.createVerify("SHA256")` for RSA signatures (`rsa-sha256`) with automatic HMAC-SHA256 fallback (`hmac-sha256`) when asymmetric keys are absent.
   - Implement hybrid payload encryption (`encryptPayload`) using AES-256-GCM symmetric encryption + RSA-OAEP symmetric key encapsulation.
   - Implement hybrid payload decryption (`decryptPayload`) using RSA-OAEP key unwrapping + AES-256-GCM payload decryption.
   - Integrate signature verification and decryption into `ingest(event)` and payload encryption into `deliver(event)`.
3. Update `test/federation-bus.test.ts` and `test/federation-agent.test.ts`:
   - Write comprehensive tests for keypair generation, asymmetric sign/verify, hybrid encrypt/decrypt, tampered signature rejection, corrupt payload rejection, missing key handling, and backward-compatible HMAC fallback.
4. Verification:
   - Run tests using `npx vitest run test/federation-bus.test.ts test/federation-agent.test.ts` and `npm run test`.
   - Run TypeScript check using `npm run build` or `npx tsc --noEmit`.

DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Write your final status, code change summary, and full test output to `/home/noah/project/invosmart/.agents/worker_m3_1/handoff.md` and notify parent when complete.
