# Plan: Unified Settings Synchronization via NIP-44

## Objective
Consolidate local settings (Theme preference, Fiat currency preference, Wallet connection metadata) and the existing AI settings into a unified settings schema stored on Nostr relays as a NIP-44 encrypted Kind 30078 event.

## Strategy
1. **Design a Unified Settings Schema**: Extend the settings envelope to include optional fields for `theme`, `currency`, and `wallet`.
2. **Refactor settings management**:
   - Update `app/services/ai-drafting.ts` (or create a unified settings service, keeping backwards compatibility/integration in place).
   - Hook the Theme, Currency, and Wallet state changes to auto-sync back up to the Nostr settings event if an account is active.
   - On account hydration, apply the restored settings (Theme, Currency, Wallet) locally.
3. **Verify via Tests**: Update the tests in `app/services/ai-drafting.test.ts` to cover the unified settings serialization, encryption, decryption, and hydration.

## Tasks

### 1. Research & Audit
- [x] Task 1.1: Verify current import paths and usage of `loadAIDraftingSettings` and `hydrateAIDraftingSettings` in pages/components.
- [x] Task 1.2: Audit reactivity of Theme, Currency, and Wallet to ensure setting updates trigger save actions appropriately without infinite update loops.

### 2. Implementation
- [x] Task 2.1: Define the unified schema and update `app/services/ai-drafting.ts` to parse, serialize, save, and load the unified settings.
- [x] Task 2.2: Integrate the theme hook/provider, currency store, and wallet provider to listen to active account changes, trigger hydration, and publish updates when modified.

### 3. Verification & Hardening
- [x] Task 3.1: Run and expand the settings vitest tests in `app/services/ai-drafting.test.ts`.
- [x] Task 3.2: Verify that settings can be successfully read and written.
- [x] Task 3.3: Ensure no credentials or keys are exposed in unencrypted payloads.
