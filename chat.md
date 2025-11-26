# Chat feature implementation notes

## What already exists
- Broker client usage lives in `src/mcp.ts` (`hol.chat.*` tools) and `src/workflows/chat.ts`/`src/workflows/openrouter-chat.ts` for pipeline flows. These only call `client.chat.createSession/sendMessage/getHistory/compactHistory/endSession` and rely on `RegistryBrokerClient` from `@hashgraphonline/standards-sdk`.
- Memory capture hooks (`recordMemory`/`loadMemoryContext`) already wrap chat send/history steps; any new chat tool should preserve this behavior or explicitly opt out.
- Reference demos in `reference/registry-broker/` illustrate richer chat capabilities not yet wired into the MCP surface:
  - `encrypted-chat.ts` shows `RegistryBrokerClient.initializeAgent` for key setup (`ensureEncryptionKey`, `encryption.autoDecryptHistory`) and the `chat.startConversation` / `chat.acceptConversation` handshake with `encryption: { preference: 'required' }`, plaintext-sending via `conversation.send`, and decrypted history (`chat.getHistory(sessionId, { decrypt: true })`).
  - `registry-broker-history-demo.ts` exercises history compaction and credit top-ups when a 402 is returned.
  - `openrouter-chat.ts` is a minimal non-encrypted chat flow that parallels `src/workflows/openrouter-chat.ts`.

## Tasks: add encrypted chat
1) **Model the broker encryption API in schemas**
   - [x] Extend `chatSessionSchema` / new schemas in `src/mcp.ts` to accept encryption preferences and key setup inputs. Mirror the demo options: `encryptionRequested` (existing field), `encryption` block with `{ preference: 'required' | 'preferred' | 'disabled' }`, `ensureEncryptionKey` with `{ uaid, generateIfMissing, label? }`, and `autoDecryptHistory` flag passed to `RegistryBrokerClient.initializeAgent`.
   - [x] Add Zod schemas for conversation start/accept payloads: `hol.chat.startConversation` should take `{ uaid (target), senderUaid, auth?, encryption?, onSessionCreated? }`; `hol.chat.acceptConversation` should take `{ sessionId, responderUaid, auth?, encryption? }`. Include validation that one of `senderUaid/responderUaid` is present and that `encryption.preference === 'required'` when plaintext is expected.

2) **Wire encryption-aware client initialization**
   - [x] Add a helper (e.g., `createEncryptedBrokerClient`) that wraps `RegistryBrokerClient.initializeAgent` to set default headers, opt into `autoDecryptHistory`, and ensure long-term keys via `ensureEncryptionKey` from the demo. Cache initialized clients per UAID so follow-up calls reuse keys.
   - [x] Use this helper inside new MCP tools and workflows instead of the shared `withBroker` singleton when encryption is requested, but preserve existing `withBroker` for non-encrypted flows.

3) **Expose MCP tools for encrypted flows**
   - [x] New tools in `src/mcp.ts`:
     - `hol.chat.ensureEncryptionKey` → calls `initializeAgent` with `ensureEncryptionKey` only; returns key metadata.
     - `hol.chat.startEncryptedConversation` → wraps `client.chat.startConversation`, relays `sessionId` via callback, and returns conversation summary.
     - `hol.chat.acceptEncryptedConversation` → wraps `client.chat.acceptConversation`.
     - `hol.chat.sendEncrypted` → uses conversation handle if available, else falls back to `chat.sendMessage` with `{ encryptionRequested: true }`. Accepts `{ sessionId, plaintext, auth?, decryptHistory? }` and pulls decrypted history via `chat.getHistory(sessionId, { decrypt: decryptHistory ?? true })`.
   - [x] Keep existing `hol.chat.*` behavior intact; when `encryptionRequested` is true, pass through to broker but do not break current required fields. Add guards to refuse mixed plaintext/ciphertext payloads.

4) **Encrypted chat workflow**
   - [x] Add `src/workflows/encrypted-chat.ts` modeled after `reference/registry-broker/encrypted-chat.ts`: initialize two agents (or reuse supplied UAIDs), ensure keys, run `startConversation`/`acceptConversation` with `preference: 'required'`, exchange two plaintext messages, and fetch decrypted history from both perspectives. Return the session summary plus decrypted entries.
   - [x] Register the workflow in `src/workflows/index.ts` and expose via MCP as `workflow.encryptedChat` with inputs `{ requesterUaid, responderUaid, requesterAuth?, responderAuth?, requesterMessage?, responderMessage?, disableMemory? }`.
   - [x] Integrate memory capture only on decrypted plaintext to avoid persisting ciphertext blobs.

5) **Transport support (optional but recommended)**
   - [ ] If SSE/stdio streaming should surface partial ciphertext events, ensure new tool handlers forward streaming responses from `RegistryBrokerClient` (similar to existing `streaming` flag) and gate them behind an opt-in flag to avoid regressions.

## Tasks: harden/confirm regular chat
1) **Close parity gaps with reference demos**
   - [x] Bring `registry-broker-history-demo.ts` logic into automated tests: simulate 402 on `chat.compactHistory`, then ensure a top-up call is issued and compaction retry succeeds. Add a test double for `RegistryBrokerClient` in `tests/workflows/history-topup.spec.ts`.
   - [x] Mirror `reference/registry-broker/openrouter-chat.ts` auth handling in `src/workflows/openrouter-chat.ts` by asserting bearer auth is required when `registry === 'openrouter'` (or feature-flag to keep backward compatibility).

2) **Strengthen tool and workflow coverage**
   - [x] Add unit tests for `hol.chat.sendMessage` auto-session creation in `src/mcp.ts` (when only `uaid` is provided) and ensure `recordMemory` is invoked for both user/assistant roles.
   - [x] Create a workflow spec for `workflow.chatSmoke` to assert sequence: createSession → sendMessage → history → compact (skip on 401/402) → endSession. Mock `withBroker` to inject errors and verify skip logic matches expectations.
   - [x] Add regression tests for `hol.chat.compact` when `preserveEntries` defaulting logic is applied via schema defaults.

3) **Manual verification scripts**
   - [x] Add a `scripts/chat-smoke.ts` (non-MCP) that mirrors `reference/registry-broker/history-demo.ts` but points at the compiled client (`dist/index.js`), so `pnpm chat:smoke` can hit a real UAID with optional `OPENROUTER_API_KEY`. Keep it read-only with no credit purchases unless `--top-up` is passed.

4) **Documentation/configuration**
   - [x] Update `.env.example` with encryption-related variables (`ENCRYPTED_CHAT_KEY_LABEL`, `ENCRYPTED_CHAT_PREFERENCE`, `ENCRYPTED_CHAT_AUTO_DECRYPT=1`) and credit top-up knobs (`HISTORY_COMPACTION_TOP_UP_HBAR`, `CHAT_HISTORY_TTL_SECONDS`).
   - [x] Extend `README.md` and `AGENTS.md` architecture sections with the encrypted chat flow diagram: initializeAgent → startConversation/acceptConversation → send(plaintext) → getHistory({ decrypt: true }) → endSession.

## Validation checklist
- [x] Unit: `pnpm test --run --coverage` with added specs for new MCP tools and workflows.
- [x] Integration (mock): exercise `workflow.encryptedChat` with stubbed `RegistryBrokerClient` to confirm both sides receive decrypted plaintext, and that memory capture only stores plaintext when enabled.
- [ ] Integration (broker): run adapted demos from `reference/registry-broker/encrypted-chat.ts` against staging with two UAIDs and verify decrypted history on both participants; re-run `workflow.chatSmoke` to ensure legacy flows are unaffected.
- [ ] Transport smoke: `pnpm dev:stdio` and `pnpm dev:sse` with `workflow.encryptedChat` prompt to confirm streaming/text payloads serialize without leaking ciphertext.
