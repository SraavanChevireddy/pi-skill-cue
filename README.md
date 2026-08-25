# pi-skill-cue

Your skills only help if the model reads them. `pi-skill-cue` makes sure it does.

## The problem

Pi loads skills through progressive disclosure: the system prompt lists every skill's
name and description, and the model is expected to load the rest itself when a task
matches. Pi's own documentation concedes the failure mode:

> "the agent uses `read` to load the full SKILL.md (models don't always do this; use
> prompting or `/skill:name` to force it)"

A user installs thirty or forty skills, the descriptions sit in one undifferentiated
block far from the request that actually needs them, and the model skims past the one
that mattered. The user gets generic behaviour, blames the skill, and stops writing
skills.

## Install

```
pi install npm:pi-skill-cue
```

No API key, no network calls, no runtime dependencies, no per-turn cost. It works the
moment it's installed, with zero configuration.

## How it works

**Route.** On every prompt, a deterministic lexical scorer ranks installed skills
against the prompt, the skill's own "use when …" phrases, any user-configured regex
triggers, and signals from the working directory. If a match clears the threshold, a
short directive naming the skill and its path is appended to that turn's system prompt
— the one place attention is strongest.

**Gate.** For skills a user explicitly names in config, `pi-skill-cue` can block
`write` or `edit` until the model has actually read that skill's `SKILL.md`, either by
a `read` tool call on that path or a `/skill:<name>` invocation. Gates are advisory by
default and enforcement is opt-in per skill.

**Report.** A local, append-only ledger records injections, reads, blocks, and
outcomes, so `/cue-report` can show which skills fire, which never do, and
`/skill-doctor` can lint descriptions that are structurally incapable of ever
matching.

## Benchmark

Numbers from `npm run bench`, against the synthetic corpus and labelled prompts in
[`bench/`](bench/):

| Metric | Value |
|---|---|
| Cases | 49 |
| Precision@1 | 0.821 |
| Recall@3 | 0.821 |
| False-positive rate | 0 |
| Hard-subset precision@1 | 0 (6 cases) |

The hard subset is six prompts that share almost no vocabulary with their target
skill's description — paraphrases like "this is acting weird" for a debugging skill.
Lexical routing cannot reach them, and the number above is exactly zero: not rounded
up, not excluded. An optional model-assisted escalation for ambiguous cases is
deferred until the lexical approach alone is shown to be insufficient in practice.

Most routing packages assert that they select correctly. This one publishes a number
and fails CI on regression against it.

## Configuration

`~/.pi/agent/skill-cue.json`, merged with `.pi/skill-cue.json` where the project file
wins per top-level key. Absent config is valid and yields advisory-only behaviour.

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

`triggers.ticket-workflow` above matches ticket keys shaped like `ABC-123`. Unknown
keys are ignored; invalid values fall back to defaults rather than throwing.

## Commands

| Command | Behaviour |
|---|---|
| `/cue` | Current status: enabled, last match, and its reason. |
| `/cue off` | Disable routing and gating for this session. |
| `/cue on` | Re-enable for this session. |
| `/cue-report` | Per-skill table: injections, reads, blocks, never-fired flag. |
| `/cue-report --purge` | Delete the local ledger. |
| `/skill-doctor` | Lint installed skills for routability problems. |

## Privacy

The ledger is a local, append-only file under `~/.pi/agent/skill-cue/`.
It never leaves your machine.
`/cue-report --purge` deletes it. The extension makes no network calls in the
routing path, ever — there is nothing to call out to.

## Failure behaviour

Fail-open by design. Every hook body is wrapped; on any error the extension does
nothing and the turn proceeds exactly as vanilla pi. A router that occasionally misses
is a mild loss. A router that can break a session is uninstalled the first time it
does.

Gates carry an explicit anti-deadlock rule: if the same gate blocks the same tool
twice, it releases permanently for the rest of the session rather than re-arming. No
routing benefit justifies a block a user cannot escape.

## Contributing

Before publishing, copy `.leakpatterns.example` to `.leakpatterns.local` (gitignored)
and add any identity- or employer-specific terms relevant to your environment. `npm run
check:leaks` checks the packed tarball and git index against both the built-in generic
patterns and that local file.
