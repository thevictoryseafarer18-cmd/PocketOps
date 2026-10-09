# PocketOps

**A personal workflow assistant with inspectable memory and a review-before-send step.**
Built for the Nebius × NVIDIA Global AI Hackathon (track: *Personal AI*).

PocketOps drafts a **daily briefing** or a **short reply** from the notes and tasks you choose, using only
preferences you have approved. Before any personal context goes to a hosted model, it shows you the **exact text**
and waits for your approval. You can edit or redact that text, or cancel.

> PocketOps is privacy-*conscious*, **not** "fully private" or "local-only". Inference runs on Nebius Token Factory,
> so approved context leaves your machine. See [Privacy boundary](#privacy-boundary).

## Quick start

Requirements: Node.js 20 or newer.

```bash
npm install
cp .env.example .env      # then edit .env (see below). Optional: without it the app runs in sample mode
npm start                 # http://127.0.0.1:3000
```

```bash
npm run check             # syntax check of all JS + secret scan + test suite
npm test                  # tests only
```

### Enable the real Nebius model call

1. Create an API key in [Nebius Token Factory](https://tokenfactory.nebius.com).
2. Edit `.env`:

| Variable | Required | Purpose |
|---|---|---|
| `NEBIUS_API_KEY` | yes | Token Factory key. Server-side only; never sent to the browser. |
| `NEBIUS_MODEL` | yes | An NVIDIA open model served by Token Factory. No default is hard-coded. |
| `NEBIUS_BASE_URL` | recommended | OpenAI-compatible base URL **for the same region as the model**. Code default: `https://api.tokenfactory.nebius.com/v1` |
| `NEBIUS_MAX_TOKENS`, `NEBIUS_TEMPERATURE`, `NEBIUS_TIMEOUT_MS` | no | Tuning (defaults 1500 / 0.3 / 60000) |
| `PORT`, `HOST` | no | Default `3000`, `127.0.0.1` (reachable from this machine only) |
| `POCKETOPS_DATA_FILE` | no | Default `./data/store.json` |

**Model identifier.** `.env.example` uses `nvidia/nemotron-3-super-120b-a12b` with the `us-central1` base URL
(`https://api.tokenfactory.us-central1.nebius.com/v1`), the pairing shown in Nebius' public Nemotron example when this was written.
Token Factory model IDs are **region-scoped** and the catalogue changes, so treat this as a starting point, not a guarantee.
Verify it with the **"Check model availability"** button on *Privacy & setup*. That button calls `GET /models` with only your key and lists
NVIDIA/Nemotron IDs. You can also run `curl "$NEBIUS_BASE_URL/models" -H "Authorization: Bearer $NEBIUS_API_KEY"`.
A wrong region or model usually shows up as a 404 "model not found" or a 401, and PocketOps explains this in the error.

**Without configuration** the app runs in **sample mode**. The full flow works, but drafts come from simple
rules, are labelled **SAMPLE DRAFT / "no model was called"**, and nothing is sent. Sample output is never presented as model output.

## Demo workflow

1. **Add data.** Add notes/tasks/messages, or press *Load synthetic demo data* (everything is labelled `DEMO · synthetic`).
2. **Ask.** Choose *Daily Briefing* or *Draft a Reply*; tick only the items (and saved preferences) this request needs.
3. **Review.** PocketOps shows the exact text to be sent, which items/memories are included, and the destination host and model.
   Edit it, use *Scan for sensitive-looking text* → *Redact all found*, use *Redact selection*, or press *Cancel, send nothing*.
   Tick the consent box and press **Approve & send to Nebius**.
4. **Result.** A clearly labelled **DRAFT** with `[S1]`/`[M1]` source chips, a provenance panel (which approved memories and
   source items informed it, and what was *not* included), and the exact text that was sent.
5. **Possible preference.** If your wording reveals a preference ("short and friendly project update"), or the model proposes one,
   PocketOps **asks**. Nothing is saved until you press *Yes, save this memory* (you can edit the wording first).
6. **Reuse.** On the next request the saved memory is pre-selected, appears in the review text as `[M1]`, and is listed in provenance.
7. **Manage.** *Memory* lets you inspect (text, scope, source, usage), edit, delete one, or delete all. Provenance marks a memory as
   *edited since* or *deleted since*.

A timed script is in [DEMO_SCRIPT.md](DEMO_SCRIPT.md). Submission text is in [docs/SUBMISSION.md](docs/SUBMISSION.md).

## Architecture

```
Browser (vanilla JS SPA, no build step)         Node 20 + Express                          Nebius Token Factory
 ├ Home / Notes & tasks / Compose                ├ /api/items, /api/memories (CRUD)           (OpenAI-compatible)
 ├ Review screen (editable exact context) ─────► ├ /api/prepare  builds context, NO model call
 ├ Result + provenance + suggestions             ├ /api/generate requires explicit approval ─► POST /chat/completions
 └ Memory manager, Activity, Privacy             ├ /api/models/check ────────────────────────► GET /models (key only)
                                                  └ data/store.json (plain JSON, mode 0600)
```

- `server/context.js` builds the context text (`[M#]` memories, `[S#]` source items) and the fixed system prompt.
- `server/app.js` implements a **two-step protocol**. `/api/prepare` returns the draft context and stores it as a short-lived,
  single-use, in-memory *pending review* (15 min, never written to disk). `/api/generate` proceeds only with
  `approved: true` and a valid pending id, and sends **the text the browser submits**, i.e. what was reviewed and edited. The
  server adds nothing to it. Provenance is recomputed from the tags still present in that text, so deleting a `[S2]` block removes S2 from provenance.
- `server/nebius.js` is the only code that talks to Nebius. The key is read from the environment, used only in the
  `Authorization` header, scrubbed from error messages, and never returned by any endpoint.
- `server/preferences.js` has the rule-based preference detection (runs locally on your instruction text) and the parser for the model's optional
  `PREFERENCE_SUGGESTION:` line. Both only *propose*. The only path that creates a memory from a suggestion is the
  `…/suggestions/:id/approve` endpoint, which the *Yes, save this memory* button calls.
- `server/sample.js` is the rule-based sample mode (no network).
- `public/lib/redact.js` is the pattern scan (emails, phone numbers, links, long numbers), shared by browser and tests.

### Where the model is used
| Uses the NVIDIA model via Nebius | Does **not** use a model |
|---|---|
| Writing the briefing/reply draft; optionally proposing a preference | Storing/editing/deleting memory and notes; choosing what is sent; redaction scan; provenance; local preference detection; sample mode |

## Privacy boundary

| Stays in the app | Sent to Nebius (only after you approve that specific call) |
|---|---|
| Notes, tasks, messages; saved memories; drafts; activity log; API key (server-side) | The exact context text on the review screen + PocketOps' fixed system instructions |

- Memory is **opt-in**. Code never saves a suggestion on its own.
- Stored memories and notes are not sent until you approve the review screen for that call. Items you don't tick are not included.
- The activity log records the exact text of each approved request locally, so you can audit what was sent.
- **Persistence and security limits:** data lives in one **plain-text, unencrypted JSON file** (`data/store.json`, created with file mode 0600,
  git-ignored). There are no accounts or authentication, and the server binds to `127.0.0.1` by default. Anyone with access to the machine, the file,
  or the running port can read it. Setting `HOST=0.0.0.0` exposes the app to your network without authentication, so don't do that on untrusted networks.
- Once text is sent, Nebius' own data-handling terms apply; PocketOps cannot recall it.
- Redaction is a convenience pattern check, not a guarantee. You are the final judge.
- PocketOps never sends messages or takes external actions; outputs are drafts you copy yourself. It needs no email, calendar or account access.
- Basic hardening: strict CSP, JSON-only API (no cross-site form posts), body size limits, no request-body logging, DOM built without `innerHTML`.

## What is implemented

- Home with Daily Briefing / Draft a Reply, data-boundary and model-use explanations, and empty states
- Notes/tasks/messages CRUD; synthetic demo data (loadable/removable), clearly badged; demo vs user badges everywhere
- Rule-based and model-proposed preference suggestions with approve/edit/dismiss
- Memory manager: add, inspect, edit, delete, delete all; scope (all/briefing/reply); source and usage stats
- Review-before-send screen: exact editable context, redact selection / scan / redact all, reset, cancel, consent gate, size estimate
- Real Nebius Token Factory chat-completions call (configurable model/base URL), status pill, model availability check, and handling for auth, 404 model/region, rate limit, timeout, network and empty-response errors
- Provenance with source chips, "not included" counts and the exact sent text; activity log; JSON export; erase-all
- Sample mode when unconfigured (never faked as model output)
- Responsive layout, skip link, labelled controls, keyboard-operable two-step deletes, focus management, `prefers-reduced-motion`

## Verification status

Run in this repository's development sandbox:
- `npm run check` (syntax check of all JS, secret scan, 14 automated tests): **passing**. The tests cover context building, redaction, preference logic, config, and the API (approval gating, exact-text sending, provenance, memory approval/edit/delete, error handling, no key leakage) against a **local mock** of an OpenAI-compatible server.
- Browser walk-through with headless Chromium in sample mode, and in live mode against the **same local mock**: full flow, consent gating, error + retry, no console errors, no horizontal overflow at 390px. This was manual/scripted outside the repo; there is no browser test in `npm run check`.

**Not verified:** a call to the real Nebius Token Factory. The development environment had no API key. The request follows Nebius' documented OpenAI-compatible API, but the
exact model ID/region pairing, the response shape (e.g. reasoning-model output) and latency must be confirmed with your key (use *Check model availability* and a first draft).
The app strips `<think>…</think>` blocks and errors clearly on empty output (raise `NEBIUS_MAX_TOKENS` if a reasoning model spends its budget thinking).

## Limitations / not implemented

- **Nebius AI Cloud deployment is not implemented** (no Dockerfile or IaC). The app was verified only as a local Node process. Before hosting it you would need to add authentication, TLS and a persistent volume, because the current storage has no access control.
- Single user, no accounts, no encryption at rest, no import from real email/calendar (intentionally out of scope).
- Pending reviews live in server memory (lost on restart; 15-minute expiry).
- The sample-mode drafter is deliberately simple; the sensitive-text scan is pattern-based and will miss names, addresses, etc.
- Model preference suggestions depend on the model following the `PREFERENCE_SUGGESTION:` format; rule-based detection covers a few style words (concise/friendly/professional/bulleted).
- Emoji icons depend on the system emoji font.

## License

MIT, see [LICENSE](LICENSE). NVIDIA Nemotron models are used via API and governed by their own licence (NVIDIA Open Model License). PocketOps does not redistribute model weights.
