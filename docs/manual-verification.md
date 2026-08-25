# Manual verification against a live pi session

Automated tests cover the units. This records the behaviour observed inside a real pi process,
which no unit test can establish.

- **pi version:** 0.84.3
- **Extension loaded with:** `pi -e <package-path>` (not installed from npm)
- **Skill catalogue:** two fixture skills supplied with `--skill`, plus `-ns` to disable discovery,
  so the observed routing is deterministic and independent of any skills installed on the machine
- **Model:** claude-sonnet-5
- **Ledger inspected at:** `<pi agent dir>/skill-cue/events.jsonl`

The two fixture skills:

| name | description |
|---|---|
| `widget-calibration` | Use when calibrating a widget sensor, adjusting tolerance ranges, or resetting a device baseline |
| `release-checklist` | Use when cutting a release, tagging a version, or preparing release notes |

`widget-calibration/SKILL.md` contains one distinctive instruction — "Always start by recording the
current baseline value" — which appears nowhere else. Whether the model repeats it is therefore
proof of whether the skill was actually read, rather than of the router merely claiming a match.

## Step 1 — Routing, end to end

**Prompt:** "I need to recalibrate the widget sensor tolerance before shipping"

**Observed:** the model's reply ended with "I'll record the current baseline first (per the skill),
then adjust the tolerance range accordingly." That instruction exists only inside the SKILL.md, so
the directive was injected and the model followed it.

**Ledger:**

```
inject  skill=widget-calibration  score=0.92  reason=calibrating a widget sensor
read    skill=widget-calibration
```

The reason names the matched "use when" phrase, and the score reflects a trigger match rather than
term overlap alone. `release-checklist` was not injected despite the prompt containing "shipping",
so the threshold held.

## Step 2 — A gate blocks, then releases on compliance

**Config:** `{ "gates": { "release-checklist": { "tools": ["write"] } } }`

**Prompt:** "Create a file called notes.txt containing the single word: hello. Do it immediately
without reading anything else."

**Observed:** the write was blocked, the model read the gated skill, and the write then succeeded.
The file existed afterwards, and the model reported creating it.

**Ledger:**

```
block  skill=release-checklist  tool=write
read   skill=release-checklist
```

Note the gate fired on a prompt that produced no injection at all, confirming gating is independent
of routing. This is the intended shape of the feature: the block is a nudge with teeth, and
complying with it clears the way rather than requiring the user to intervene.

The anti-deadlock release (a gate giving up permanently after two blocks of the same tool) is not
reachable here, because the model complies on the first block rather than retrying blindly. It is
covered by unit tests in `tests/gatekeeper.test.ts`.

## Step 3 — A malformed config degrades to vanilla pi

**Config:** `{ this is not valid json at all`

**Prompt:** "Say exactly: SESSION_OK"

**Observed:** the session ran normally and the model replied `SESSION_OK`. No error surfaced, and no
extension output appeared.

## Step 4 — Routing still works while that config is broken

**Prompt:** "help me cut a release and tag the version", with the malformed config still in place.

**Ledger:**

```
inject  skill=release-checklist  score=0.86  reason=cutting a release
read    skill=release-checklist
```

Defaults were applied rather than the extension disabling itself, which is the documented
fail-open behaviour: an unreadable config costs the user their settings, not their router.

## Not verified here

- `/cue`, `/cue-report`, and `/skill-doctor` are interactive commands and cannot be exercised in
  print mode. Their logic is unit tested through `CueRuntime.report()` and `CueRuntime.doctor()`;
  what remains unverified is only pi's rendering of the output.
- Behaviour after installation from npm, as opposed to loading the working tree with `-e`.
