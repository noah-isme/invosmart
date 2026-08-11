# Scope: Milestone 3 (R3: Federation Bus Asymmetric Encryption)

## Architecture & Overview
Enhance `lib/federation/bus.ts` and `lib/federation/protocol.ts` to replace/augment legacy symmetric HMAC signing with asymmetric digital signatures (RSA/Ed25519) and hybrid payload encryption (AES-256-GCM + RSA/Ed25519 key encapsulation).

## Feature Inventory
| # | Feature | Description | File Targets | Status |
|---|---------|-------------|--------------|--------|
| 1 | Augmented Schema Protocol | Extend `federationEventSchema` in `lib/federation/protocol.ts` to support optional/required fields for `encryptedPayload`, `encryptedKey`, `iv`, `keyId`, `signature`, and algorithm parameters. | `lib/federation/protocol.ts` | PLANNED |
| 2 | Asymmetric Signing & Verification | Upgrade `lib/federation/bus.ts` to support asymmetric digital signatures using `crypto.sign` and `crypto.verify` (RSA/Ed25519 key pairs from `FEDERATION_PRIVATE_KEY` / `FEDERATION_PUBLIC_KEY`), with fallback to HMAC when keys are absent. | `lib/federation/bus.ts` | PLANNED |
| 3 | Hybrid Payload Encryption & Decryption | Implement AES-256-GCM payload encryption with envelope encryption of symmetric key via asymmetric public/private keys in `deliver()` and `ingest()`. | `lib/federation/bus.ts` | PLANNED |
| 4 | Unit Test Verification & Security Edge Cases | Update unit test suites (`test/federation-bus.test.ts` and `test/federation-agent.test.ts`) covering asymmetric signing, hybrid encryption/decryption, tampered signatures, corrupted payloads, missing keys, and HMAC fallback. | `test/federation-bus.test.ts`, `test/federation-agent.test.ts` | PLANNED |

## Interface Contracts
### `lib/federation/protocol.ts`
- `federationEventSchema`: Zod schema supporting fields: `id`, `type`, `tenantId`, `timestamp`, `signature`, `payload` (optional or decrypted), `encryptedPayload` (optional string), `encryptedKey` (optional string), `iv` (optional string), `keyId` (optional string).

### `lib/federation/bus.ts`
- `FederationBus`: Handles `deliver(event)` and `ingest(event)`. Supports key pair configuration (`FEDERATION_PRIVATE_KEY`, `FEDERATION_PUBLIC_KEY` or constructor params). Encrypts and signs payloads before network delivery; verifies signature and decrypts payload upon ingestion. Supports backward-compatible HMAC fallback if asymmetric keys are not provided.

## Code Layout Ownership
- `lib/federation/bus.ts`
- `lib/federation/protocol.ts`
- `test/federation-bus.test.ts`
- `test/federation-agent.test.ts`
