# pi-skill-cue — Design

**Date:** 2026-08-24
**Status:** Approved for planning
**Package:** `pi-skill-cue` (npm, MIT, public)

## Problem

Pi loads skills through progressive disclosure: the system prompt lists every skill's
name and description, and the model is expected to `read` the full `SKILL.md` when a
task matches. Pi's own documentation concedes the failure mode:

> "the agent uses `read` to load the full SKILL.md (models don't always do this; use
> prompting or `/skill:name` to force it)"

The result is skill blindness. A user installs thirty or forty skills, they sit in a
wall of descriptions near the top of the context, and the model skims past the one
that mattered. The user gets generic behaviour, blames the skill, and stops writing
skills. Three compounding causes:

1. **Position and volume.** Descriptions sit in one undifferentiated block, far from
   the user's actual request, competing with each other for attention.
2. **No enforcement.** A skill that says "You MUST use this before any creative work"
   has no mechanism behind the word MUST.
3. **Bad descriptions.** Many skills are described for humans, not for a router — no
   trigger words, no "use when" phrasing, overlapping scope with siblings. Some skills
   are structurally incapable of ever firing, and their authors have no way to know.

## Goals

- Raise the rate at which the correct skill is loaded for a given prompt.
- Make selected skills enforceable when the user opts in.
- Tell users which of their skills never fire, and why.
- Work immediately on install: no API key, no network, no config, no per-turn cost.
- Never break or degrade a session, even when the router is wrong.

## Non-goals

- Authoring or generating skills.
- Replacing pi's skill discovery, loading, or `/skill:name` commands.
- Semantic embedding search (evaluated and rejected: model download, native deps,
  cold start).
- Mandatory LLM routing (evaluated and rejected: per-turn cost and latency on every
  turn, breaks offline).

## Approach

Advisory by default, enforcement opt-in per skill. With zero configuration the package
only ever adds a short routing directive to the system prompt for the current turn.
Gates engage only for skills the user explicitly names in config.

The routing engine is deterministic lexical scoring. An optional escalation to a cheap
model, disabled by default, resolves ambiguous cases only.

## Architecture

Six units. Each has one job, a defined interface, and no reach into another's
internals.

| Unit | Responsibility | Depends on |
|---|---|---|
| `catalog.ts` | Normalise pi's loaded skills into `SkillRecord[]`: name, absolute path, description, extracted trigger phrases, body keywords, source. Cached by file mtime. | `systemPromptOptions.skills`, fs |
| `scorer.ts` | Pure function `(prompt, signals, records) → RankedMatch[]`, each with a machine-readable reason. No I/O, no state, no clock. | none |
| `injector.ts` | Convert ranked matches into a budget-capped directive block appended to the turn's system prompt. | scorer output |
| `gatekeeper.ts` | Track satisfied skills for the session; block guarded tools while a gate is unsatisfied; enforce the anti-deadlock rule. | session state |
| `ledger.ts` | Append-only JSONL of injections, reads, blocks, and outcomes under `~/.pi/agent/skill-cue/`. Local only. | fs |
| `doctor.ts` | Lint descriptions, cross-reference the ledger for never-fired skills, propose rewrites. | catalog, ledger |

`scorer.ts` being pure is the load-bearing decision. It makes match quality a number
produced by a unit test rather than an impression, which is what lets us tune scoring
without regressing it.

## Data flow

```
user prompt
   │  before_agent_start
   ├─→ catalog (mtime-cached)  →  scorer  →  matches above threshold?
   │        no ─→ return undefined (session unchanged)
   │       yes ─→ injector appends directive to this turn's system prompt
   │              ledger records the injection
   │
   ├─ model reads SKILL.md ──observed on tool_call(read)──→ gatekeeper marks satisfied
   │
   ├─ model calls write/edit ──→ gatekeeper: unsatisfied gate for this tool?
   │        yes ─→ { block: true, reason: "read <name> at <path> first" }
   │         no ─→ proceed
   │
   └─ ledger ──→ /cue-report, /skill-doctor
```

### Scoring signals

In descending weight:

1. **Trigger phrase hit.** Phrases extracted from the description's "Use when …" /
   "Use this when …" clauses, matched against the prompt.
2. **User regex triggers.** Config-supplied patterns per skill. A ticket-key pattern or
   a filename pattern is an unambiguous signal and should not be left to similarity
   scoring.
3. **Term overlap, IDF-weighted.** Prompt terms against name plus description, weighted
   so terms common across the whole catalogue ("code", "file", "use") contribute close
   to nothing.
4. **Context signals.** File extensions present in `cwd`, whether the prompt names a
   tool or command the skill mentions, and whether the session is mid-edit.

Scores are normalised to `0.0`–`1.0` so `threshold` is meaningful and stable across
catalogue sizes. Output is capped: at most `maxSkills` (default 3) and roughly 600
characters injected per turn. An injection as bloated as the wall of descriptions it replaces has solved
nothing.

### Injection shape

Appended to the end of the turn's system prompt, where attention is strongest:

```
## Skill match for this request
This request matches the skill `test-driven-development`
(/abs/path/to/SKILL.md). Read it before writing implementation code.
Reason: prompt matched trigger "implementing any feature or bugfix".
```

Never modifies the user's prompt text. Never re-injects a skill already read in the
current session.

## Gates

Declared in config, not in skill frontmatter. The Agent Skills specification defines a
fixed frontmatter shape, and custom keys there produce validation warnings in every
harness that reads the same skill directory.

A gate names a skill and the tools it guards (default `write`, `edit`). It is satisfied
for the remainder of the session once the skill is read, observed either as a `read`
tool call on that `SKILL.md` path or a `/skill:<name>` invocation. The block reason
names the skill and its absolute path.

**Anti-deadlock rule:** if the same gate blocks the same tool twice in a row, the third
attempt is allowed with a warning. An agent trapped in a block loop burns tokens and
user trust, and no routing benefit justifies that. Gates also never engage under
`--no-skills`, and `/cue off` disables the extension for the session.

## Configuration

`~/.pi/agent/skill-cue.json`, merged with `.pi/skill-cue.json` where the project file
wins. Merge is per top-level key: a key present in the project file replaces the global
value outright rather than deep-merging, so `gates` and `triggers` are declared whole in
one place and there is never a question of which half of an object is in effect. Absent
config is valid and yields advisory-only behaviour.

```json
{
  "enabled": true,
  "maxSkills": 3,
  "threshold": 0.35,
  "verbose": false,
  "mute": ["some-noisy-skill"],
  "triggers": { "ticket-workflow": ["\\b[A-Z]{2,}-\\d{3,}\\b"] },
  "gates": { "test-driven-development": { "tools": ["write", "edit"] } },
  "escalate": { "enabled": false, "model": null }
}
```

`verbose` controls visibility only: when false (default) the directive is injected into
the system prompt silently; when true the same text also renders as a visible session
message, for debugging why a skill fired. It does not change routing.

Unknown keys are ignored. Invalid values fall back to defaults with a single warning,
never an exception.

## Commands

| Command | Behaviour |
|---|---|
| `/cue` | Current status: enabled, catalogue size, gates configured, last match with reason. |
| `/cue off` \| `/cue on` | Toggle for the session. |
| `/cue-report` | Per-skill table over recent sessions: injections, reads, blocks, never-fired flag. |
| `/cue-report --purge` | Delete the local ledger. |
| `/skill-doctor` | Lint the catalogue; report unroutable skills with reasons and suggested descriptions. |

`/skill-doctor` may call the active model to draft rewrites. That is acceptable because
it is explicit, one-off, and user-initiated — unlike per-turn routing.

### Doctor lint rules

- Description shorter than 40 characters, or absent.
- No trigger phrasing ("use when", "when the user", an imperative verb list).
- Description duplicates or subsumes a sibling's, making the pair unresolvable.
- Never fired across the last N recorded sessions despite being loaded.
- Name and description share no terms, so neither path can match.

## Failure behaviour

Fail-open without exception. Every hook body is wrapped; on any error the extension
logs to the ledger and returns `undefined`, and the turn proceeds exactly as vanilla
pi. A router that occasionally misses is a mild loss. A router that can break a session
is uninstalled the first time it does.

Specifics:

- Catalogue parse failure on one skill drops that skill, not the catalogue.
- Ledger write failure is swallowed; routing continues.
- Gate evaluation error fails open (tool proceeds).
- No network calls in the routing path, ever.
- Ledger stays on the machine. Nothing is transmitted anywhere.

## Testing

- **Unit:** `scorer.ts` against fixture catalogues; `catalog.ts` frontmatter and
  trigger extraction, including malformed input; `gatekeeper.ts` satisfaction and the
  anti-deadlock counter; config merge precedence and invalid-value fallback.
- **Integration:** a fake `before_agent_start` event asserting the directive appears in
  the returned system prompt and the user's prompt is untouched; a `tool_call` event
  asserting block and pass-through.
- **Benchmark:** `bench/` holds a synthetic skill corpus plus roughly 60 labelled
  prompts mapped to their expected skill. `npm run bench` reports precision@1,
  recall@3, and false-positive rate. CI fails on regression against a committed
  baseline; the README publishes the current numbers.

The benchmark serves three purposes at once: a regression net for scoring changes, an
honest accuracy claim, and a differentiator — competing routing and memory packages
assert that they select correctly and none of them publish a number.

## Leak prevention

The repository is public. The development machine carries employer-internal skills,
internal tooling, internal ticket-key conventions, and a username embedded in every
absolute path. None of it ships.

**Hard rules**

1. **No harvested corpus.** The benchmark corpus is authored from scratch or drawn only
   from skills that are already public. Employer-internal or private skill directories
   are never copied, quoted, paraphrased, or listed in the repository.
2. **No real paths.** Fixtures use `/fixtures/...` or `/tmp/...`. No `/Users/<name>/`
   string appears in any tracked file.
3. **Generic examples.** README and config samples use invented skill names and
   `ABC-123`-style ticket keys. No internal project keys, product names, hostnames,
   or repository names.
4. **Allowlist packaging.** `package.json` `files` explicitly lists what ships
   (`dist/`, `README.md`, `LICENSE`). Not `.npmignore`, which fails by omission.
5. **Ledger never tracked.** Runtime data lives under `~/.pi/agent/skill-cue/`, outside
   any repository. `.gitignore` covers `*.jsonl`, `.pi/`, and local scratch paths.

**Automated guard**

`npm run check:leaks` runs against the packed tarball contents (`npm pack --dry-run`)
and the git index, failing the build on any hit. It combines:

- Built-in generic patterns, committed: absolute `/Users/` or `/home/` paths, email
  addresses, private IP and internal-TLD forms, common API-key and token shapes,
  `.env` files, anything resembling a credential.
- A local, untracked pattern file (`.leakpatterns.local`, gitignored) holding the
  employer- and identity-specific terms. Those terms deliberately do not live in the
  repository, since a committed denylist naming internal projects is itself a
  disclosure.

The check runs in CI (generic patterns only) and as a `prepublishOnly` hook locally
(both sets), so publishing without the local pattern file present fails loudly rather
than silently skipping the strict pass. The release checklist requires a manual read of
`npm pack --dry-run` output before the first publish.

## Shipping

- `keywords: ["pi-package", "skill", "router"]` for gallery discovery.
- `pi.video`: a guarded `write` blocked with "read `test-driven-development` first",
  followed by `/cue-report` showing how many installed skills have never fired.
- README leads with the thirty-second value demonstration, then the benchmark table,
  then the privacy statement, then configuration.
- MIT licence.

## Open risks

- **Lexical recall on paraphrase.** "This is acting weird" will not match
  `systematic-debugging` on term overlap. Mitigations: trigger phrase extraction, user
  regex triggers, opt-in escalation. The benchmark must include paraphrase cases so
  the weakness is measured rather than hidden.
- **Over-injection fatigue.** If a directive appears every turn it becomes wallpaper.
  Mitigated by the threshold, the per-session dedupe, and the cap.
- **Pi API drift.** `before_agent_start` and `tool_call` shapes may change. Mitigated
  by fail-open behaviour and pinning the peer dependency range.
