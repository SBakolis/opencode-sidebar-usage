# Manual Smoke Test

Record exact commands and observed results here when performing a live
smoke test with a real OpenCode installation.

## Prerequisites

- OpenCode installed and running (`opencode serve` or TUI mode)
- OpenAI/ChatGPT authentication (`opencode auth login -p openai`)
- The `opencode-codex-meter` plugin installed and built

## Steps

### 1. Install the plugin

```bash
cd opencode-codex-meter
npm run build
npm pack
# Install the tarball or reference the local path in opencode.json
```

Add to `opencode.json`:
```json
{ "plugin": ["./path/to/opencode-codex-meter"] }
```

### 2. Start a new OpenCode session

```bash
opencode
```

Complete one assistant turn (send a prompt, wait for response).

### 3. Verify idle toast

- [ ] A toast appears after the assistant turn completes
- [ ] Toast shows separate input/output totals (e.g., "gpt-5.5: 184k in / 8.5k out")
- [ ] Toast shows quota windows if authenticated (e.g., "5h 37% · week 62%")

### 4. Verify streaming idempotency

- [ ] Send a long prompt that triggers multiple streaming updates
- [ ] Verify the final total is counted once (not multiplied by update count)

### 5. Verify multiple models

- [ ] Use a second model in the same session (e.g., switch model mid-session)
- [ ] Run the `codex_usage` tool
- [ ] Verify both models appear in the detailed output

### 6. Verify codex_usage tool

```
Ask the agent: "Call the codex_usage tool"
```

- [ ] Tool returns a detailed report
- [ ] Input and output totals are separate
- [ ] Per-model breakdown is correct
- [ ] Compare totals with `session.messages()` source data

### 7. Verify CLI

```bash
# Get the session ID from OpenCode
codex-meter --session <session-id>
codex-meter --session <session-id> --json
```

- [ ] Human output matches the tool output
- [ ] JSON has `schemaVersion: 1`
- [ ] Exit code is 0

### 8. Verify quota-only mode

```bash
codex-meter --quota-only
codex-meter --quota-only --json
```

- [ ] Quota data is shown without session tokens
- [ ] Exit code is 0

### 9. Test network failure

```bash
# Block network access to chatgpt.com
# (e.g., via firewall or hosts file)
codex-meter --quota-only
```

- [ ] Token reports still work
- [ ] Quota shows `unavailable` or `stale`
- [ ] Exit code is 0

### 10. Test missing/expired auth

```bash
# Temporarily rename auth.json
mv ~/.local/share/opencode/auth.json ~/.local/share/opencode/auth.json.bak
codex-meter --quota-only
```

- [ ] Plugin does not crash
- [ ] Quota shows `unauthenticated`
- [ ] Token reporting continues
- [ ] No refresh attempt is made
- [ ] No credential is logged

```bash
# Restore
mv ~/.local/share/opencode/auth.json.bak ~/.local/share/opencode/auth.json
```

### 11. Verify session deletion cleanup

- [ ] Delete a session in OpenCode
- [ ] Verify in-memory state is cleaned up (no memory leak)
- [ ] Use a debug metric that contains no sensitive data

## Results

Record observed results here:

```
Date: ____
OpenCode version: ____
Plugin version: ____
Platform: ____

Step 3: ____
Step 4: ____
Step 5: ____
...
```

## Note on Live Testing

If real Codex credentials are unavailable, use sanitized fixtures and
mock transport. Document the unperformed live check here. Lack of real
credentials must not block fixture-based acceptance.
