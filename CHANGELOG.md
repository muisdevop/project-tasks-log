# Changelog

Notable changes to GID Task Flow, kept by hand in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
format. Versioning follows SemVer.

## [Unreleased]
- **The register now carries the 93 original findings plus 101 rows this campaign has filed against itself;
  the shipped workbook's re-audit sheet holds all 194 of them, every one Fixed.**
- **The sixteenth re-audit pass read the deliverable's own figures back against the artefacts and refused the
  ones nothing prints.** Two findings, both inside the instruments filed at the previous pass to police the
  register — and the second moved rows a reviewer would read, because eleven of them cited exit codes under
  labels no script ever emits.
  - **RA-87 — a control's own output became the evidence its subject lacked.** A register tally that reads
    every figure the log recites back against the transcripts has to decide what its own transcript is, and
    the instruments built for RA-79/RA-86 read every `.txt` in the scratch directory alike. Two shapes leaked:
    the frozen red censuses print the very pair they refuse, so a merged print set let a refused figure certify
    its own recital; and a shell redirect of a control's stdout into the corpus promoted its refusal lines to
    prints, moving labels out of the refused bucket and inflating the census of known tokens. Repaired by
    holding a report apart from a measurement — a report print supports a figure only for an entry that names
    that report's filename, checked per recital — by refusing a whole output family rather than one filename,
    by masking every refused pair in a report (`TOKEN at value`, which the figure grammar cannot read as a
    print), and by assembling invented labels at run time so no script's bytes carry them. The counterfactual
    that was supposed to prove the refusal was itself found broken in an unrelated way: it compared the sweep's
    output without the space the sweep emits, so it could have failed forever while printing a green census
    line. Neither half would have surfaced from a run whose subject was the deliverable; both surfaced because
    the control was asked to prove it can say no (`ctrl29-unprinted-recitals.txt`).
  - **RA-88 — a recital whose label no instrument prints.** The tally looked figures up under labels it had
    been told to expect, so a row citing `VERIFY_RC` where the transcript says `wb-ctrl-placeholders_RC`, or
    `CONTROLS_RC` where the batch echoes `ctrl3_noexit_RC`, was skipped as out of scope — the blind spot in a
    check whose whole job is to detect. The campaign's own prose shorthand was the source, and it had shipped
    in eleven places: a fresh-database migration exit, the workbook verifier's refusals, a coverage step, a
    patch run, and a gate row's summary of its own controls. Repaired by measurement, not deletion. Where the
    specimen still existed it was re-cited to lines the artefact really prints; where the transcript had been
    overwritten the gate was re-run — `gate-ra20.sh` spins a throwaway Postgres and an application migration
    from empty storage and prints the fresh-migrate census again (`gate-ra20-fresh-migrate.txt`). The tally
    gained a bucket for labels no capture machine-prints, and that bucket is proved on a subject built for it:
    an invented label recited through an entry of the log is refused, while the shipped column reads zero
    (`ctrl28-register-tally.txt`). The deliverable now carries the eighth instrument in its own gate row, so
    the row that lists the controls which read the log is read by the control that refuses unprinted figures.
- **The fifteenth re-audit pass turned the previous pass's controls into evidence and found six of them
  depending on their own surroundings.** RA-80..RA-86, all tooling, all caught by asking an instrument whether
  it could have said no.
  - **RA-80 — an exemption list justified only by comments.** The writer tolerates a small set of figures no
    transcript need support, and the reason each one is tolerated lived in prose beside it, so the list could
    not be checked: an exemption that had outlived its guard would have looked exactly like one that had not.
    Each exemption is now re-derived from the shipped source every run, and a control replays the blinded
    census to show the exemption is what holds the figure out.
  - **RA-81 — a quotation of history assembled from a live constant.** Two rows restated a previous pass's
    cover sentence, and one of them built the restatement out of a value that still moves, so the history
    changed when the present did. The quotations are now frozen against the artefacts that carry them.
  - **RA-82 — a count frozen in a sentence beside the transcript that prints it.** A row enumerated the
    outcomes of its own control and opened with how many there were, while reading the tree from the
    transcript every build; one half was live and the other was a remembered number.
  - **RA-83 — a precondition that could only be met by destroying the evidence it judged.** Every control
    transcript must name the gated tip or a documentation-only descendant, and restamping a transcript to
    satisfy that rule rewrites the bytes that were the proof. The restamp path is now measured rather than
    trusted: it re-derives the tree through the batch's own writer and refuses a run whose specimen capture is
    still on disk.
  - **RA-84 — a guard that could not tell a quoted specimen from a pointer.** The rule that stops a sentence
    sending a reviewer to a numbered sheet could not see the difference between naming a cell as the thing
    under test and citing it as a location, and the deliverable was stopped by its own description of the
    stop.
  - **RA-85 — an oracle that passed only while the defect it guarded against was still present.** The tally
    tolerates exactly one figure that nothing need support, the pipeline's own success marker; the exemption
    was written so that it held the figure out even after the figure acquired real evidence, which is the
    state in which the check stops meaning anything. The exemption is now asserted against the writer's
    source and measured by blinding it.
  - **RA-86 — a certifying corpus that could not distinguish an instrument's output from a capture of a
    screen.** Same-stem grouping handed a hand-made text file the standing of an instrument's current run, and
    the live instance was in a product row rather than a tooling one: RA-12 recited a docker build exit as the
    proof a gate had run and failed, while every artefact that prints that figure prints the successful rebuild
    — the value had come from the operator's terminal. Standing is now a property of the artefact: the sweep
    reads every campaign script and treats a file no script names as a capture that may certify only a figure
    the reciting entry also names it in.
- **The fourteenth re-audit pass read the instruments that measure the deliverable, and four of them could not
  see their own subjects.** RA-72..RA-79, all in the campaign's tooling, found by replaying each shipped
  predicate and its repaired form over the same bytes.
  - **RA-72 — anchored patterns without the flag that makes them anchored.** Four transcript parsers in the
    register restamper were written `/^…$/` against files that are not one line, so a read either matched
    nothing or matched a whole transcript. Widened with `m`, and the sweep that checks the class reads every
    call site of both writers rather than the fraction the first census claimed.
  - **RA-73 — a needle pinned to a remembered key order.** GitHub's run record was parsed positionally out of
    a capture whose objects serialise alphabetically; the same data with keys reordered reads as nothing, while
    `JSON.parse` reads both identically. The replacement is anchored to key names.
  - **RA-74 — two predicates in the wrong shape.** A lower-case needle on a transcript printed as `Largest
    chunk` counts zero and would have raised a stale-figure finding against a correct row, and a residual
    denylist carried a bare control label that fires on the *correct* restamped path while the full-path form
    does not — a guard refusing the repair it exists to certify.
  - **RA-75 — instruments that had never been read back.** The axe census, the provenance-header capture and
    the mismatch needle were each weaker than their greens looked; the census that certified RA-72 had scanned
    a fraction of the call sites it declared closed, and is corrected in place against the transcript that
    still prints the widened figure.
  - **RA-76 — mutations anchored to the bytes of the day.** Two controls prove a guard fires by mutating a
    copy of an artefact; both anchored to a literal string that later moved, so the proof had quietly become a
    no-op. The anchors are now derived from the artefact each run.
  - **RA-77 — a precondition that could only be met by the repair it gated.** The writer may quote a red
    attribution run only where every blamed row is one this run rewrites, and the hand-listed set did not
    contain the rows the repair had to perform, so the writer could not do the thing its own allowance
    required. The rule was widened to a predicate over regenerated rows and measured against the census it
    excuses, refuses and must never blanket-pass.
  - **RA-78 — an oracle measuring a different quantity from the claim it judged.** A provenance clause says a
    transcript records a measurement taken at a tree; the shipped test asked whether the file contains the sha,
    which a transcript satisfies by quoting it — including by printing the very accusation against itself. Two
    runs of the same verifier over the same bytes used to disagree about which row was stale; the recorded-tree
    oracle refuses a quote, accepts a header and a CI run record, and the two runs now agree.
  - **RA-79 — the deliverable recites figures and nothing read them back.** Every register entry and gate row
    quotes counts an instrument printed, and no instrument asked whether a transcript on disk still prints the
    pair. The register tally is that check, and its first green run was against a census that could not see
    two-thirds of the class — which is why the sixteenth pass went back to it.
- **The thirteenth re-audit pass went back to the instruments that measure the deliverable, and two of
  them were reporting something other than what they measured.** Five findings, all in the campaign's own
  tooling and none in the product — but the first changed a number a reviewer would read. The register
  now carries 93 original findings plus 84 rows this campaign has filed against itself (`sheet 12`,
  177 rows, all Fixed). Every count quoted in an earlier entry is the count at that entry's own pass;
  the live figures are in the workbook and in the gate log, which re-derive them on each edit.
  - **RA-67 — the axe scan census was pinned to one source line, and its guard froze the blind spot.**
    The metrics generator counted axe assertions with a regex anchored to
    `accessibility.spec.ts:162:9` and then refused any run whose route count was not the literal `7`.
    Against the very CI matrix log the previous workbook was built from, that parse sees **63 scans
    over 7 routes** while the log itself holds **72 over 8**: the route it cannot see is the drawer-only
    axe assertion, which lives at [tests/e2e/accessibility.spec.ts:189](tests/e2e/accessibility.spec.ts)
    and `:206` and `:229` (RA-27/RA-29's tests). So the guard was green on the incomplete parse and would
    have refused the correct one — it certified the under-count and forbade the fix, and the shipped
    accessibility rows understated the gate by nine scans and one route. The generator now derives the
    census from the spec (route labels in the describe block plus every drawer test carrying the same
    assertion) and asserts `scans == routes × projects` against the log: measured at the gated tip,
    72 = 8 × 9, and deleting a single axe line from a copy breaks the identity at 71 over 8, which is
    what makes the guard falsifiable (`ctrl23-axe.txt`).
  - **RA-68 — the CI provenance header shipped blank in all five job captures.** The capture script put
    `cut -d'\"'` inside a `$( )` inside a double-quoted echo, so the backslash survived into the
    substitution, `cut` received a two-character delimiter, errored, and emitted
    `CI_RUN_HEAD_SHA=` with no value — while a grep for the short sha still reported hits from the job
    log body, which is why the capture looked populated. Reproduced on the real API record
    (`ctrl23-pass14-tooling.txt`): the shipped hoisted form yields the full 40-hex tip. Two repairs,
    because one repair was the original defect: the extraction is asserted non-empty where it happens,
    and the metrics generator additionally requires the sha to appear on **at least two lines** of the
    job log — a header written by the capturer proves only that the capturer ran (real matrix log
    `hits=5` accepted, header-only fixture `hits=1` refused).
  - **RA-69 — the campaign's own state file carried fields no sheet reads, and they contradicted the
    fields the sheets do read.** The pass-14 regeneration rebuilt `metrics.json` from the census of its
    consumers: the 47 kept keys are each re-parsed from a transcript measured at the gated tip or
    deleted outright. The one dropped key is documented rather than assumed — `red` went after a grep
    showed its only mention in the workbook builder is a comment, so that row reads its own transcript
    instead of a remembered record. The generator was falsified in four directions at
    `TREE=d36de9d DIRTY=0` (`ctrl22-metrics-falsify.txt`): a wrong tip argument, a provider smoke whose
    two transcripts disagree, a stale tree stamp, and no CI run at the tip each throw; a green copy
    reproduces the shipped file byte-for-byte.
  - **RA-70 — an instrument the campaign must not repair was quietly becoming one.** The provenance
    batch's dependency-advisory step greps npm's JSON for a byte sequence npm never emits, so it exits
    1 on a clean tree and the batch stops there — and that stop is RA-54's evidence, asserted by exact
    string by the deliverable writer. Fixing the needle would therefore invalidate the citation of the
    defect it documents, with nothing in the script saying so. The coupling is now measured in three
    states (live batch accepted, mismatch line deleted refused, needle repaired-to-green refused) and
    written as a comment above the step, naming the file where the green verdict actually comes from.
  - **RA-71 — the hygiene gate could not see a `.env`, and its transcript contradicted its own row.**
    The step's pattern was written inside double quotes, so the `\|` that should have been ERE
    alternation reached grep as an escaped pipe — a literal `|` — and the `.env` branch demanded the
    characters `^/|` in front of every match, which no path has. The `.db$` and `.zip$` anchors did
    survive, so the step still printed hits and looked alive. Replaying the shipped line with `eval`, so
    the quoting bash applies at run time is the quoting measured, sees 3 of 6 danger paths and names
    neither `.env` nor `.env.example`; replayed against the tracked tree it exits 1 with zero hits, which
    is exactly the reading `gate-tip14-hygiene.txt` recorded — while the row's own sentence states
    "exactly 1 hit: `.env.example`", a figure parsed from a second campaign instrument that does see it
    (`ctrl24-hygiene.txt`). RA-44 had corrected that sentence and its census and left the gate itself
    untouched, and the row's citation names the blind one. `ci.yml` has no hygiene step, so this gate is
    the campaign's only runtime enforcement and a committed `.env` walks straight through it. The
    predicate now lives in a single-quoted variable in a file, and the step prints the pattern, the
    allowlist, every hit and a verdict rather than a bare exit status that cannot tell "nothing matched"
    from "nothing was looked at". Five phases falsify it: the repaired step names and refuses `.env`,
    calls the real tree clean while naming the one template it allows, refuses the real tracked list with
    a `.env` appended, and its census equals the sweep's where the shipped predicate read 0. Its
    transcript was restamped through the batch's own transcript writer, extracted from `gate-tip14.sh`
    rather than reimplemented, at a documentation-only descendant of the gated tip with a clean worktree.
  - **Regeneration, and the discipline it rests on.** Because the gated tip moved to the commit that
    carries the twelfth pass's product fixes, every figure the workbook quotes was re-measured there
    rather than carried: 63 files / 860 tests, coverage 96.51 / 90.54 / 96.56 / 97.06 (the figures at
    the twelfth pass's code, not the previous tip's), 46 component tests in 5 files, the
    155-test browser matrix at 143 passed / 12 skipped, 16 SQLite and 5 PostgreSQL migrations, 28/28
    container-smoke checks on each provider, `gid-task-flow:chg14` built from the clean tip and booted
    behind Coolify-shaped names, and both CI runs for the tip green on 5/5 jobs. The AGENTS.md gate was
    run twice against this content — once on the working tree that became this documentation commit,
    once on the committed tip with a clean worktree — and both transcripts stamp their own tree.
- **The twelfth re-audit pass went back to the product, and found four real defects — the first
  since the tenth pass.** None were in the deliverable machinery this time; they were in the
  accounting, the throttle, the idempotency store, and a one-active-task invariant that the test
  suite could never fail because of the database it ran on. The register now carries 93 original
  findings plus 79 rows this campaign filed against itself (sheet 12, 172 rows, all Fixed), and the
  gated tip rebuilt, re-booted on both providers, and passed `container-smoke` 28/28 on each.
  - **RA-63 — one `Idempotency-Key` could answer two different endpoints.** The store keyed a
    replay on the client key plus a body fingerprint, with no method or path. A caller that reused a
    key across `POST /api/jobs` and `POST /api/projects` got the stored *job* body back as a 200
    instead of creating the project — a wrong payload, not an error. The store key is
    `method:pathname:clientKey` now ([src/lib/idempotency.ts:141](src/lib/idempotency.ts)); the
    echoed header keeps the caller's original key so the wire contract is unchanged.
    [tests/unit/idempotency.test.ts:161](tests/unit/idempotency.test.ts) fires the same key and body
    at two routes; `:186` keeps the same-endpoint replay correct.
  - **RA-64 — the rejected-token throttle was a brake applied after the skid.** `authenticate` ran
    the Prisma digest lookup *before* charging the per-IP `token-reject` budget, so a flood of bad
    tokens each paid a database round-trip before the limiter refused, and a *valid* token was still
    charged against the rejection budget — good callers got locked out for other callers' failures.
    A non-consuming `peekRateLimit` ([src/lib/rate-limit.ts:20](src/lib/rate-limit.ts)) reads the
    bucket before the lookup ([src/lib/auth.ts:207](src/lib/auth.ts)); only a genuinely rejected
    token now consumes. [tests/unit/auth-tokens.test.ts:234](tests/unit/auth-tokens.test.ts) and
    `:246` cover both halves.
  - **RA-65 — after-midnight work was banked as zero.** `workingTimeDiffSeconds` walked calendar
    days from `startOfLocalDay(startedAt)`, so a slice that belongs to an overnight shift begun the
    previous day never saw that shift's window. A Tue-03:00→04:00 slice under a 22:00–06:00
    Monday-only schedule banked 0 instead of 3600. The cursor opens one day earlier
    ([src/lib/business-time.ts:166](src/lib/business-time.ts)) while attribution stays on the
    shift's starting weekday. [tests/unit/business-time-edges.test.ts:131](tests/unit/business-time-edges.test.ts),
    `:139`, and [tests/task-lifecycle.test.ts:118](tests/task-lifecycle.test.ts) pin the before/after.
  - **RA-66 — the one-active-task-per-project invariant was untestable on the database it was
    tested on.** The resume handler holds the project's other in-progress tasks, then applies the
    change with a conditional `updateMany`. SQLite's single writer serialises two "concurrent"
    resumes whether or not the code locks anything, so the suite passed for the wrong reason. On
    PostgreSQL the pool runs both transactions at once, both read the same empty other-runners set,
    and both commit a task to `in_progress` — two runners on one project. The repair takes a
    provider-conditional `SELECT … FOR UPDATE` on the owning Project
    ([src/app/api/tasks/route.ts:45](src/app/api/tasks/route.ts), mirrored in the break-log
    transaction at [src/app/api/breaks/log/route.ts:168](src/app/api/breaks/log/route.ts)). The new
    [scripts/resume-race-probe.mjs](scripts/resume-race-probe.mjs) drives a *running* container's
    authenticated API, because that is the only place the failure is reachable: against the pre-lock
    image it put two tasks in progress in **11 of 12** rounds; on the gated locked image it held
    exactly one runner in **8 of 8** rounds on PostgreSQL and **8 of 8** on SQLite.
  - A note on local reproducibility, kept honest: the campaign's own gate aborted at the e2e step
    with `EACCES`, not because the product broke but because the hard-coded dev-server port 3177 and
    the runtime ports 3011/3012 had fallen inside a Windows Hyper-V dynamic port reservation. The
    e2e port is env-overridable and the repo default is fine on Linux CI, so the product and its
    defaults were left untouched; only the throw-away gate scripts were pointed at free ports, and
    the matrix then ran 143 passed / 12 skipped / 0 failed.
- **The eleventh re-audit pass certified the deliverable where it is actually delivered.** Five
  rows, none of them product defects again; the first four were found by running a command against the
  artefact a reviewer opens rather than the scratch copy the pipeline had been checking. The
  register now carries 93 original findings plus 75 rows this campaign filed against itself
  (`sheet 12`, 168 rows, all Fixed) and the verification log has 46 rows.
  - **RA-58 — the workbook's cover claimed a commit that was no longer where it was built.**
    `build-workbook.cjs` interpolated `metrics.json`'s `head` into the summary sentence and never
    asked git where HEAD was, so the sentence stayed true of the pass that wrote the metrics file
    and false of the workbook generated from it. The builder now derives HEAD from git, diffs it
    against the measurement tip and throws unless every differing path is documentation.
    `ctrl18-doctip.sh` measures both halves: a throw-away copy pointed at a metrics file whose tip
    is v0.2.0's own commit exits 1 after naming all 76 non-documentation files that differ and
    writes no workbook, while the shipped builder exits 0 printing the one-file delta it accepted.
    Neither the shipped builder nor its metrics file is edited by the control.
  - **RA-59 — a provenance clause printed a worktree state its transcript never recorded.** The
    clause-builder emitted `DIRTY=0` from a constant for every row it stamped, which certified a
    clean tree for measurements taken by GitHub's runner, where no local worktree exists at all.
    Four runs of the shipped verifier against copies of the log (`ctrl19-dirty.txt`): the
    pre-repair log exits 1 with `DIRTY_CLAIMED_NOT_RECORDED` on 4 rows whose transcripts are CI
    capture files, the one row whose transcript genuinely records `DIRTY=1` is rewritten to the
    constant's value and exits 1 naming the clause against the transcript's own line, a frozen
    copy whose clause still names an older cycle's tree exits 1 on that row, and the shipped log
    exits 0. The clause now reads its dirtiness out of the cited transcript and throws
    when they disagree; the CI-capture rows say instead that there is no local worktree to be clean.
  - **RA-60 — the mechanism that rewrites those clauses had stopped reaching them.** The strip was
    anchored on a single space before the clause's label; the replacement consumed that space and
    wrote the clause back without it, so from the next run onward the pattern matched nothing and
    every clause froze on the day it was written — which is why RA-59's repair landed only on rows
    appended after it. `ctrl20-clausestrip.sh` reads the shipped `stripClause` out of the script
    that writes the log and executes that: 35 of 42 rows in the pre-repair snapshot carried an
    unreachable clause, 0 of 46 do now, and the same row run through both strips records
    `OLD_STRIP_REACHED=0 NEW_STRIP_REACHED=1`. The obvious repair — dropping the space from the
    anchor — would have cut the self-check row short, because its prose quotes the clause's shape,
    so the shipped rule takes the last occurrence and the writer refuses to ship a clause it
    cannot reach.
  - **RA-61 — the check that ties the workbook's authored-cell manifest to the workbook was a check
    on the filesystem.** It required the manifest's mtime to be no older than the artefact's minus a
    five-second grace, but the builder writes its manifest *before* it zips, so the artefact is
    always the newer of the two and only that grace kept the rule from failing every build — and the
    deliverable is copied to its shipping path minutes later. The campaign found it by shipping:
    verifying the copy a reviewer opens returned one problem while the identical bytes in the build
    directory certified clean. Pointed at a genuine workbook from an earlier pass, the same rule
    reports nothing at all. Content and verdict were uncorrelated in both directions, and RA-50's
    own lesson — that mtimes cannot carry this proof because the zip writer fixes them — had never
    been applied to this sibling rule. The binding is by content now: the builder hashes the workbook
    it wrote and appends the digest, byte count and authored-cell count to
    `C:/tmp/workbook-builds.json`, and the verifier requires the bytes under certification to match a
    recorded build whose cell count equals the manifest's. `ctrl21-buildhash.sh` runs the
    pre-repair verifier from a snapshot taken before the edit, so the historical behaviour stays
    testable, and measures six outcomes: the old rule accepts a copy inside the window, refuses a
    byte-identical copy past it, and raises nothing about the manifest for a previous pass's
    workbook; the shipped rule certifies the identical copy, refuses the stale build (0 of 27
    logged), and refuses a manifest with one declared cell deleted. The pipeline gained a seventh step for it: the workbook is
    now copied to the `audit-report/` path and verified *there*, which is the step the old rule made
    impossible.
  - **RA-62 — a precondition that only the repair it gated could satisfy.** RA-59's control
    required its fourth run, the verifier against the live log, to exit 0 before the script that
    re-stamps the log's clauses was allowed to run — but the one stale clause it found (row 42,
    still naming the previous cycle's tree) could only be re-stamped by that script. The first
    way out tried was the wrong one: truncating the log to 41 rows turned the control green, and
    the builder then refused the result (`ctrl14-selfcheck.txt counts 46 gate rows, gates.json
    holds 41`, kept as `ctrl19-builder-refusal.txt`) — a green control over a different artefact
    is not evidence about this one. In the same run the pipeline row read its step census from the
    previous run's transcript, which carried no ship step yet. Three changes: the live run now
    reports the log as it stood and no longer gates the control; a frozen copy of the stale-clause
    log is the RED half that does gate it; and the writer certifies the log it is about to ship
    with a dry run over those exact bytes (`ctrl19-dryrun.txt`: `DRY_LOG_RC=0`, 46 rows, no
    problems, clean tree) and throws before writing if that run is red. The pipeline row now takes
    its step count from `pipeline-pass13.sh` itself and its exit codes from the run made after
    the log is written.
  - The AGENTS.md gate is unchanged since `ff86693` (`gate-chg14-chain.txt`, clean tree, image,
    both provider boots, both smoke runs, CI on both triggers); every commit since differs from it
    only in `CHANGELOG.md`, which is exactly the rule RA-58's builder guard now enforces rather than
    leaves to trust.

- **The tenth re-audit pass audited the gate log's attributions — and the tooling that certifies
  them.** Six rows, again none of them product defects: every one was found by running a command
  the campaign had previously only described, and each repair is measured in both directions. The
  register now carries 93 original findings plus 70 rows this campaign filed against itself
  (`sheet 12`, 163 rows, all Fixed), and the verification log has 42 rows.
  - **RA-52 — the gate log asserted trees it could not evidence.** Rows put a commit in their
    verdict line, and the whole of `C:/tmp` held exactly one transcript that recorded a tree at all:
    `gate-chg13-chain.txt`, which recorded `TREE=879735e…` with `DIRTY=1` — a dirty worktree. So the
    documentation-tip row's "at ff86693" named a commit absent from all six transcripts it cites.
    Repaired by measurement: the AGENTS.md gate re-ran on the committed tip with a clean worktree
    (`gate-chg14-chain.txt` opens `TREE_BEFORE=ff86693c2af8e5b45584aeb2f3eff67f3a866dab
    DIRTY_BEFORE=0` and closes on the same tree), a 24-step batch re-ran every locally reproducible
    check with its own tree stamp before and after, GitHub's jobs supply the matrix, axe and both
    container boots with the API's `headSha` in the capture, and every row now carries a
    `Provenance (RA-52):` clause naming the tree a transcript it cites records — or declares itself
    history-only. Two rows do: the one-off `pg_stat_activity` sampling and the pre-convention
    image-identity controls. A sixth pipeline step, `verify-attributions`, fails any row whose
    verdict names a commit its cited transcripts do not contain, cites a file that does not exist,
    or carries no clause. Measured red first: `ctrl14-attribution-red.txt` — `ROWS=40`,
    `ATTRIBUTION_PROBLEMS=3`, exit 1.
  - **RA-53 — the attribution verifier invented missing evidence.** Its filename pattern listed
    `gate-…|ctrl…|pass…` and, the third branch unanchored, cut the tail off
    `ruleF-controls-pass13.txt` and reported a file called `pass13.txt` as `MISSING`. A checker that
    fabricates missing evidence trains a campaign to wave its findings through. It now matches whole
    filename tokens and takes the basename: the fabricated problem is gone and the three real ones
    stood.
  - **RA-54 — the provenance batch stopped on a green tree.** Its dependency-advisory step grepped
    npm's JSON for `"total":0`, a byte sequence npm never emits (it writes `"total": 0`), so
    `gate-tip14-batch.txt` ends `audit-runtime RC=1 WANT=0 MISMATCH` after twenty green steps. An
    unsatisfiable needle is indistinguishable from a real regression: the same line would have
    covered three actual advisories and zero. The verdict now comes from `audit-parse.cjs` reading
    `metadata.vulnerabilities`, and `ctrl14-audit-needle.sh` proves both directions at the tip —
    `OLD_NEEDLE_ON_GREEN_RC=1` with `PARSED_TOTAL=0`, `NEW_PARSER_ON_INJECTED_RC=1` against a
    fabricated audit holding three runtime advisories, `NEW_PARSER_ON_REAL_GREEN_RC=0`.
  - **RA-55 — the clause-builder's own needle could not be satisfied.** It demanded four numbers
    each followed by a literal `%` from vitest's text reporter, which prints a pipe table with no
    percent sign in it, so the script threw before writing a single provenance clause and blamed the
    row for evidence that was on line 1076 of the transcript it had just read
    (`ctrl15-needle-red.txt`). It now matches the reporter's actual output.
  - **RA-56 — a citation to a transcript that does not exist.** Row 41 named
    `gate-chg14-ci-boot-postgres.txt`; the capture writes `gate-chg14-ci-boot-pg.txt`. This is the
    verifier's first true positive against the repaired log (`ctrl16-attribution-red.txt`), and the
    pipeline stopped there, so no workbook shipped pointing a reader at a missing file.
  - **RA-57 — the workbook's front page cited a sheet that does not exist.** Cell `C5` closed by
    sending readers to the gate rows on a thirteenth sheet of a twelve-sheet workbook, where the gate
    log is sheet 11 and the remediation backlog is sheet 9 — a misdirection away from the very
    attributions RA-52 exists to make checkable. Nothing compared prose sheet numbers with the
    sheets being written, so the builder now derives the sheet list from its own `workbook.xml`,
    scans every inline string of every worksheet (27 mentions across 12 sheets) and throws before
    zipping. `ctrl17-sheetref.sh` measures both directions: a throw-away copy with the sentence
    reverted exits 1, names the sheet and the part, and writes no workbook; the shipped builder
    exits 0. The guard's first run against the shipped builder caught the sentence describing it,
    because quoting a bad reference is still a bad reference.
  - Register sentences that quoted live counts were also removed, since a sentence that changes
    between runs cannot be diffed: RA-50 no longer recites the registers' newest mtime, RA-52 takes
    its pre-repair figures from the red control artefact, RA-56 defers the census to the verifier's
    own output, and each of those rewrites is announced on stdout by the script that owns the log
    rather than applied silently.
  - Two new gate rows: row 41 is the clean-tip AGENTS.md gate plus the provenance batch, row 42 is
    the sheet-reference guard's controls. `bash C:/tmp/pipeline-pass13.sh` is now six steps, and it
    prints the tree it ran on at both ends.

- **The ninth re-audit pass pointed the method at the report itself.** Nothing below is a product
  defect: every row was produced by re-running a command this campaign had previously only
  described, in the gate log, the workbook builder and the verifiers that certify them. Nine rows,
  and the register now carries 93 original findings plus 64 rows this campaign filed against
  itself (`sheet 12`), all closed.
  - **RA-43 — a gate row whose stated command exits 1 at the tip.** "Compose files parse" claimed
    success for `docker compose -f docker-compose.yml config -q`, which SEC-14's required-variable
    guards make abort with `APP_PASSWORD_HASH is missing a value`. The product was right and the
    row was unreproducible; the row now states the command with the two secrets supplied, and the
    empty-secret case keeps its own row asserting the abort.
  - **RA-44 — a hygiene grep reporting "no match" while matching something.** The sweep returned
    `.env.example`, which the same row describes as deliberately tracked. Harmless content, but a
    verifier whose failure mode is invisible is one nobody re-runs, so the row now states the
    expected hit count and the refresh throws unless the grep yields exactly that one path.
  - **RA-45 — the shipped workbook contained its own template.** 35 authored note cells, 4 of them
    rendering `${m.componentTests}` and friends as literal text, because the notes object mixes
    template literals (which interpolate) with plain strings (which do not) — and the placeholder
    scan could not see the shape, since its pattern matched undotted names only. Every note now
    passes through one interpolation choke point that throws on an unresolvable or leftover
    placeholder, and the verifier refuses any authored cell containing `${`.
  - **RA-46 — the verifier printed its problems and returned 0.** The check that found RA-45 was
    advisory. It now derives its exit code from the problem count, and the control proves both
    halves: one deliberately-broken workbook through a copy with that line removed exits 0 while
    printing the same problem count the real verifier exits 1 on.
  - **RA-47 — tip-evidence needles no artefact could satisfy.** They demanded whole prose sentences
    from a sheet rendered row by row. Each needle is now a fragment the gate log really prints
    (tip SHA, image tag, 64-hex digest, `28 checks`, both migration counts, `155 selected`, the
    tag's short SHA, the CI run id) and is first asserted against `gates.json`, so a workbook is
    never blamed for a check that was impossible.
  - **RA-48 — five register sentences the code had outgrown.** RA-41 grew the component project
    from 44 to 46 tests, RA-27 un-skipped the mobile viewports and moved the chromium matrix row
    from 28 to 47 passed / 4 skipped, and the counts checker quoted two repeat-run totals with no
    run log behind them. The checker now requires provenance: a claim may cite a transcript, and it
    opens that file and demands the number beside a test count, so a figure can be either measured
    or explicitly anchored to a named commit — not waived.
  - **RA-49 — a status checker certifying the previous build.** It read its default extraction
    directory while the workbook was being unpacked elsewhere, reported a row-count mismatch as a
    defect in the current artefact, and was wrong about both. `verify-workbook.cjs` now drops a
    `.provenance.json` recording the xlsx it unpacked, that build's mtime, the unpack time and the
    register mtimes, and the checker refuses a directory with no record or an out-of-date one.
  - **RA-50 — the fix for RA-49 could not have worked.** It compared extracted-part mtimes against
    the registers, but the zip writer stamps every entry with a fixed DOS date so repeated builds
    stay byte-comparable: an unpacked part reports 1979-12-31 forever, so the guard would have
    failed every run including green ones. A check that cannot pass is as dead as one that cannot
    fail, and the register asserted it was in force. Replaced by the explicit record above, with
    both red paths and the green path measured.
  - **RA-51 — the self-check row of the gate log had itself drifted.** Its census still read "32 of
    37 rows" after the log grew, and its commit pattern was a bare 7-hex-character regex over
    prose, so decimal constants in evidence text (`4838400`, `5548099`, `5548828`) were counted as
    trees. The census is now re-derived by the script that edits the log, the self-check row is
    excluded from its own count, and a candidate only counts when `git` confirms a commit with that
    prefix.
  - Two new gate rows make the deliverable one owned command instead of five hand-run checks:
    `bash C:/tmp/pipeline-pass13.sh` (build → verify → status census → quoted-count proof →
    citation sweep, fail-fast, one transcript per step) and `bash C:/tmp/ctrl13-stale.sh` (the
    provenance guard's red and green directions). Hand-run steps are how RA-49 stayed invisible for
    a whole pass.

- **The eighth re-audit pass audited the fixes, and found the same defect class in them.** Every
  row below came from re-running something rather than re-reading it.
  - **RA-39 — rule F read the *first* assignment, and only one of the two syntaxes it claims to
    read.** `RA-38`'s own text says the check "reads the postgres branch of
    `docker-entrypoint.sh`"; the code took `matchAll(...)[0]` from that branch and looked for
    `NAME="value"`, which is shell syntax. `prisma/postgres/migrate.config.mjs` declares its
    paths as object keys (`schema: "schema.prisma"`), so the second read found nothing and rule F
    reported the pair as guarded while comparing a shell variable to `null`. Two independent ways
    to keep it green with the configs truly disagreeing — a repeated shell assignment below the
    real one, a repeated object key above it — because the shell and an object literal both keep
    the *last* value. It now enumerates every assignment in both syntaxes, resolves the last, and
    fails when a branch assigns the same thing twice. Five controls measured, each expected red
    and each red on the clause it targets: a duplicate quoted `MIGRATIONS_DIR` in the entrypoint
    branch, the same duplicate unquoted (the other half of the regex), a duplicate `path:` key in
    the operator config, and `db:migrate:postgres` gaining `--schema` or `--url` — a flag that
    overrides the very config the command names, which would make every comparison above true of
    a file Prisma never opens. Restored tree exits 0 with the three files byte-identical.
  - **RA-40 — the README's restatement of the engine's wall-clock rule was wrong in the way that
    matters.** After `RA-34` replaced the contradicting sentence, the replacement described the
    substitution as firing when a *segment* holds no business seconds. It does not:
    `src/lib/task-lifecycle.ts:82-96` branches on `computed === 0` against the cumulative banked
    value, so a task that has already banked daytime seconds gets zero — not the wall clock — for
    a later out-of-hours increment. The engine's own comment made the same error. Both now state
    the cumulative condition and the mixed-day double-count it prevents. (The citation in this
    bullet read `77-93` until the comment edit moved the lines below it — the RA-38 decay pattern
    reproduced inside its own fix, which is why it is stated against the tree this commit ships.)
  - **RA-41 — two of the four `RA-33` projection cases were green under the bug they were filed
    against, and the running-row case accepted any plausible number.** The deleted line was
    `elapsedSeconds === 0 && endedAt ? span : value`, so it fired only on an exact zero: the
    banked-45 case was green before and after, and the running-row case asserted
    `typeof number && >= 0`, which the raw span satisfies as happily as the business-seconds
    answer. The header had claimed the suite "would fail if it came back" — true of two cases. It
    now says which case pins which regression, and pins the running row on the fixture's own
    arithmetic (8 business hours of every 24, so the answer sits near a third of the wall span and
    strictly below it). Controls: reverting the removed expression fails exactly cases 1 and 3;
    serving running rows their span fails the upper bound; flooring them to the stored 0 fails the
    lower. All three failed where predicted, and only there.
  - **RA-42 — the same fixture's `workDays` contained a value the API would reject, and the
    engine silently ignored it.** `[1, 2, 3, 4, 5, 6, 0]` reads as a seven-day job. Days are
    numbered Mon=1…Sun=7 (`business-time.ts:172` normalises JS Sunday to 7) and
    `validators.ts:36` constrains the array to 1..7, so the `0` matched nothing and the job ran
    six days — which is what made the first version of RA-41's bound wrong (`4838400`, i.e. 168
    six-hour days, below the derived floor). Found by running the test rather than reading it, and
    now fixed with the range the validator accepts plus a comment saying why `0` is the trap.
- **RA-38: the register was re-derived from commits, so re-reading it against the files found
  five false citations and ten stale sentences.** A `Fixed` row is a claim about code, and
  RA-36's prose-only re-derivation had not checked a single citation. The consequential one:
  `RA-20` recorded that `scripts/check-migration-parity.mjs` is the guard keeping the operator's
  committed Postgres migrate config and the container's boot-config equivalent — it is not, that
  script compares the two migration *sets* and never reads either config, so what had been logged
  as "accepted design, parallel by construction" was an unguarded divergence. Fixed with code
  rather than wording: **rule F** of `npm run db:parity:migrations` resolves
  `prisma/postgres/migrate.config.mjs` relative to its own directory, reads the postgres branch of
  `docker-entrypoint.sh`, and fails when the two resolve to different schema or migrations paths,
  when the generated config stops being built from `$SCHEMA_REL`/`$MIGRATIONS_REL`, or when
  `db:migrate:postgres` stops passing `--config` — because a guard over a file nothing loads reads
  like coverage. Control measured: retargeting the operator config at `other.prisma` exits 1
  naming the mismatch; the shipped tree exits 0. The other four were mis-attributed mechanisms —
  `PAR-09` credited `prisma migrate deploy` to the postgres service container's entrypoint when it
  is the app container's (`docker-entrypoint.sh:80`), and described rule E as catching
  provider-specific branches when it requires a backfill above the `CREATE UNIQUE INDEX`
  (`check-migration-parity.mjs:121,329`); `RA-20` conflated the config's `/app`-vs-`/tmp`
  writability fallback (lines 40-45) with the schema marker's `/data`-vs-`/tmp` (60-63); `RA-10`
  cited `Dockerfile:13-16` for a sentence on 17. The stale numbers were the predictable half:
  `SEC-01`/`TC-01`/`RA-11` quoted 61 files / 843 tests and 128 selected, `PM-04` quoted 13/2
  migrations and 27/27 checks, `TC-01` quoted coverage digits the fresh run does not produce
  (measured 96.64 / 90.65 / 96.54 / 97.21), `TC-04` described `npm test` from before RA-28/RA-37
  changed it, and `RA-32` asserted that no test had ever applied a data migration in the same
  sentence citing the test that does. One thing deliberately not overwritten: `PM-04`'s 13 and 2
  is true of the run it recorded, so it now reads "13 and 2 at that run; 16 and 5 at f5a19f5" — a
  register that edits its own history cannot be audited.
- **The seventh re-audit pass turned six recorded gaps into measured ones.** It started by
  re-reading rows already marked `Fixed` whose own `gap` field still described an open defect,
  and it ends with none of them in that state.
  - **RA-30 — a CI step label that quietly stopped matching the step.** `ci.yml` announced
    "Matrix (128 scenarios, axe on the 3 desktop engines)" while the run selected 155 and axe
    had been scanning all three viewports since RA-27. A label nobody re-derives is a claim
    that decays: it had already been wrong for two pushes. The step is now named for what it
    asserts (`3 engines x 3 viewports, axe included`) with a comment saying why no scenario
    count belongs there — `playwright.config.ts` owns the number, and the uploaded report is
    the measurement.
  - **RA-31 — an evidence sentence describing a failure the transcript does not show.** The
    RA-27 control was recorded as "makes the mobile walk report the leaked stops". Re-running
    the control (`invisible` → `opacity-0`) fails one assertion earlier: at 375px the drawer is
    reported *visible*, so `expect(nav).toBeHidden()` at `tests/e2e/accessibility.spec.ts:217`
    stops the test before the tab-count line at 220. The control still does its job — the guard
    catches the deleted class — but a report that names the wrong line is the beginning of an
    untrustworthy audit, so the changelog and both registers now quote what was observed.
  - **RA-32 — legacy negative seconds were clamped on read, and read wrong.** FL-D fixed the
    reads and FL-08 stopped new negatives, but `GET /api/stats` sums `elapsedSeconds` with a
    Prisma `_sum` the *database* computes, so no JS clamp is in that path: a stored `-12` kept
    subtracting from a project total. Measured in `tests/integration/negative-seconds-repair.test.ts`
    before the repair — a project holding 600 + 300 of work reported **888**. Migration
    `20261011150000_clamp_negative_seconds` repairs the rows (`Task.elapsedSeconds`,
    `JobAttendance.totalWorkSeconds`) with one statement that is valid on both engines, and the
    test applies the shipped file to prove the aggregate then reads **900**, that no negative
    row survives, and that a second application changes nothing. Because the harness builds its
    schema with `db push`, no other test exercises a data migration, so the same file is also
    checked for byte-identity across the two provider sets. One subtlety the test had to learn:
    a migration does not move `updatedAt`, so the stats watermark is unchanged and `/api/stats`
    serves the pre-repair total for the whole TTL — invalidation, not the clamp, is what makes
    the repair visible.
  - **RA-33 — the projection FL-C changed had no test at all.** `tests/integration/task-list-elapsed-projection.test.ts`
    now pins it through the real route handler: a completed row banked `0` lists `0` even though
    its timestamps span three hours, a held-then-cancelled row lists the 45 seconds the engine
    banked and not the fifteen hours between its stamps, and a legacy `-12` lists `0`. A running
    row is left to the engine's own rule, which the test documents rather than duplicates.
  - **RA-34 — README stated a rule the engine deliberately breaks.** "Every task records real
    worked time against the job's business hours" reads as an absolute, while
    `applyTaskTransition` banks wall-clock time for a segment that holds zero business seconds —
    intentional, and pinned since the first pass by `tests/task-lifecycle.test.ts` ("uses
    wall-clock elapsed when business-time increment is zero", 21:00→23:00 = 7200 under a
    09:00–17:00 day). Nothing in the engine said so, which is exactly how a deliberate rule gets
    "fixed" into a regression. The branch now carries its reason and its test name, and README
    states the exception beside the rule.
  - **RA-35 — FL-H was fixed and untested at the boundary it exists for.** `validateBreakWindow`
    is module-private, and `breaks.test.ts` only ever probed one hour ahead — far outside the
    two-minute tolerance where the defect lived. The new case logs breaks whose clock is 90
    seconds *behind* and 90 seconds *ahead*, requires both to be written (201), and requires the
    stored row to hold non-negative seconds with no `endedAt` before its `startedAt`; the
    forward-skew row must read `Break duration: 00:00:00`. The control was measured, and it had
    to be the faithful one: removing only the `Math.max(0, …)` floor left the test green, because
    the current bound no longer tests for negatives — restoring the pre-fix
    `wallClockSeconds < 0 ||` rejection is what makes it fail, at **`offset 90000ms: expected 400
    to be 201`**. That is FL-H's original symptom (a just-started break answered "too old to
    log") seen from the other side, and it is why a control that passes is information, not a
    nuisance.
  - **RA-36 — eleven findings were marked `Fixed` while their own `gap` sentence still described
    the defect.** The register carries a residual column, and closing a finding in code does not
    close it in that column: after `998e60d` repaired PAR-03/04/06/08 and later passes moved CI to
    Node 22, put axe on every viewport and moved stale-image protection into
    `scripts/check-image-loaded.mjs`, eleven rows still asserted the pre-fix world ("the axe spec
    scans desktop viewports only", "the shipped column default is still wrong", "CI on Node 20
    remains the layer that catches behaviour", "this needs two new migrations"). A reader of the
    workbook — the deliverable — would have found a `Fixed` status arguing with its own evidence
    line. Every non-empty gap was re-checked against the current tree this pass, the stale ones
    were re-derived with the file:line that closes them (partial unique index in both migration
    sets, `export-data.ts:340` null placement, `breaks/route.ts:51` id tie-break, `ci.yml`
    `node-version: "22"`), and the ones that are genuinely accepted trade-offs were kept and
    stated as decisions rather than as unfinished work: `prisma generate` on every boot (PAR-01),
    unlocked `UserSettings` reads outside the route (PAR-05), `PGPASSWORD` visible in the child's
    environment (RA-15), the conservative clock floor that can drop worked seconds (FL-08), and the
    safety copy that cannot be taken from an unreachable target (RA-13).
  - **RA-37 — the lint row in the previous report claimed a clean tree, and its own transcript
    said otherwise.** The pass-6 gate entry read "Zero errors and zero warnings across src/, tests/
    and scripts/ at dc8fd49"; the transcript it was written from
    (`C:/tmp/gate-pass10-test.txt:35`) contains `tests/e2e/accessibility.spec.ts:213:11 warning
    'toggle' is assigned a value but never used` and `✖ 1 problem (0 errors, 1 warning)` — an
    unused locator this campaign's own RA-27 edit introduced. The chain stayed green because
    `eslint` exits 0 on warnings, so the number in the report was neither measured nor
    measurable. Two changes: the dead locator is gone, and `npm run lint` is now
    `eslint --max-warnings=0`, so a warning fails the gate locally and in CI instead of becoming a
    sentence someone has to re-check by hand. Same class as RA-31 and RA-24 — an evidence claim
    the artefact does not support.
  - **RA-11 stopped being a one-sided guard.** CI retries a failed spec once and local runs do not
    retry at all, which is correct for signal but leaves no way to reproduce a suspected flake
    where it was seen. `npm run test:e2e:repeat` now runs the matrix five times over
    (`--repeat-each=5`, proven against `tests/e2e/accessibility.spec.ts`), `playwright.config.ts`
    says so beside the `retries` line, and README and CONTRIBUTING list the command.
- **RA-27 stopped being a recorded gap, and the scan it replaced found a real violation
  (RA-29).** The axe browser gate had skipped every viewport below 1440px on the argument
  that contrast belongs to the design tokens rather than the viewport. That is true of the
  tokens and false of the page: below `md` the shell is different DOM — a fixed header with a
  disclosure trigger, an off-canvas drawer, an overlay — and none of it had ever been audited,
  which is also what made the closed drawer's tabbability an assumption rather than a test
  (RA-08's fix rests entirely on `invisible` doing the work `aria-hidden` used to claim). The
  skip is gone: seven routes are scanned at 375, 768 and 1440, the open drawer gets its own
  scan, and two tests walk the tab sequence — a closed drawer must leak zero stops into
  `#app-sidebar`, a docked sidebar must be reachable, Enter opens and Escape returns focus to
  the trigger. The control ran: swapping `invisible` for `opacity-0` in the sidebar class
  string makes the mobile walk fail — at 375px the drawer is then reported *visible*, so the
  assertion before the tab-count stops the test — *and* makes
  `tests/unit/components/sidebar-shell-a11y.test.tsx` fail on the missing CSS terms, so the
  class is now guarded twice. Scanning the never-scanned row paid for itself on the first run:
  `scrollable-region-focusable` (serious) on the dashboard's project table at chromium-tablet —
  768px is the narrowest case the desktop-shaped tables ever render (`md` turns them on while
  the docked sidebar takes 256px, so a 620px table sits in a 512px column) and every cell in
  that wrapper is text, so it scrolled with no keyboard access at all. Both `overflow-x-auto
  md:block` wrappers in `src/components/dashboard-stats.tsx` are now `role="region"`, named,
  and focusable.
- **RA-28: the local gate and CI's gate were not the same gate, and CI was right.** Push run
  38157949879 and PR run 38157952716 failed `OpenAPI document matches the routes` at `fa7571f`
  while the same tree passed 843 tests, lint, typecheck, build and the container smoke locally.
  The cause was measured rather than guessed: that commit's advisory work moved `zod` 4.3.6 →
  4.6.5, zod renders its `datetime()` and `email()` patterns differently, and `docs/openapi.yaml`
  — generated from the zod schemas — went stale with no test touching it. CI ran the check; `npm
  test` did not, so "green locally" had a hole in it. `npm test` now opens with the Prisma-client
  precheck, `db:parity`, `db:parity:migrations` and `docs:openapi:check` (about two seconds), which
  is the general rule this campaign keeps re-learning: a check that only CI runs is a check that
  reports the damage after the push. README's "There is no axe/pa11y CI job" and its `npm test`
  descriptions were stale in the same way and now describe the chain that exists.
- **The fifth re-audit pass found four more defects in this pass's own work, and disproved two
  of the things it had been told.** Reviewing the newest code rather than the newest commit
  produced FL-C, FL-D, RA-23, RA-25 and RA-26 — plus two claims that did not survive checking,
  recorded here because a clean audit is a measured thing, not an asserted one.
  - **FL-C — the list projection invented work time for a held-then-cancelled task.** When a
    terminal row banked `elapsedSeconds: 0`, `GET /api/tasks` fell back to measuring the wall
    clock between `startedAt` and `endedAt`. That was written for rows predating server-side
    banking, and it stayed plausible until FL-08's hold branch began moving `startedAt` to the
    hold checkpoint: a task held for three hours and cancelled without ever working then
    displayed three hours, and a row whose hold crossed the work-day boundary displayed
    `totalElapsedSeconds` of 54000 (fifteen hours) for zero recorded work. `Math.max(0, …)`
    cannot catch this because the number is positive. The fallback is gone — a terminal row
    shows exactly what the engine banked, floored at zero — because every write path has gone
    through `applyTaskTransition` since FL-02/03/05, so the banked column *is* the record, and
    "no work was recorded" is the honest display for a zero. Pinned by
    `tests/unit/terminal-elapsed-invention.test.ts`.
  - **FL-D — the report could read a legacy negative and print it as time.** `formatDuration`
    rendered `-12` as `-1:-1:-12` (measured), and `computeTaskTotals` summed raw values, so a
    set of rows displaying 600 + 0 + 300 totalled 888 — a total smaller than its own rows.
    Both now clamp at the read boundary; the control case is in the same new test file, which
    fails against the previous implementations.
  - **RA-23 — the RA-21 image gate failed a build that had actually succeeded.** It compared the
    tag's `Created` timestamp against the script's start, but a fully-cached build reuses the
    cached config, timestamp included. Measured: `npm run docker:build -- gid-task-flow:pass7-cache`
    exported, loaded and unpacked the tag in 0.2s and then exited 1 with
    `IMAGE_STALE … created at 2026-10-11T15:51:13Z`. A gate that produces false failures gets
    bypassed, which is the very defect RA-21 was raised for. The check is now identity-based:
    buildx writes a metadata file with the digests of the image it produced, and
    `scripts/check-image-loaded.mjs` requires the tag in the local store to carry one of them —
    true for a warm build and a cold one, false for a build that never landed. It accepts both
    the config digest and the descriptor digest because with provenance/SBOM attestations
    `docker image inspect .Id` reports the *manifest list*, not the config. Re-measured: the
    same cached rebuild now prints `IMAGE_LOADED` and exits 0, and three controls fail exactly
    as they must — mismatched digests `IMAGE_STALE` (1), unknown tag `IMAGE_MISSING` (2), absent
    metadata `IMAGE_UNVERIFIABLE` (3). The BSD `date -j -f` branch the same review flagged as
    broken is gone with the timestamp logic.
  - **RA-25 / RA-26 — the Prisma precheck was checking less than it claimed.** It read only the
    datasource provider, so a client generated from an older `prisma/schema.sqlite.prisma`
    passed and failed later at query time (a 500 from an API route, not a test failure); and
    `npm run db:generate:postgres` still clobbered the SQLite client with no notice. The check
    now also compares the generated schema text with the source it should have come from —
    normalising Prisma's reformatting and dropped comments, measured identical on the current
    tree — and `db:generate:postgres` prints `CLIENT_CLOBBER_NOTICE` first (`--expect=` makes
    the check usable in the other direction for the Postgres dev server). Controls run: an
    injected extra model in the generated schema → exit 1, restored → 0, notice → 0, postgres
    client on disk → 1, regenerate → 0.
  - **Checked and disproved:** *the auto-hold path crashes because its projection has no
    `startedAt`* — all four engine call sites (`tasks/route.ts:318/456/477`,
    `breaks/log/route.ts:192/210`) select or construct `startedAt`, the column is a non-nullable
    `DateTime` in both schemas, and `typecheck` is clean. *A shipped migration had been edited
    in place* — that migration was **added** by `998e60d` and is absent from the `v0.2.0` tree,
    so no database has ever recorded its checksum; reverting it would have restored the
    copy-and-swap form the previous pass measured deleting four tables under
    `foreign_keys=ON` inside a transaction. The file's own immutability note is corrected to
    state that provenance instead. *`.env.local` leaks credentials into the test run* — no
    `.env.local` exists in this repo, `.dockerignore` excludes `.env` and `.env.*`, the
    Dockerfile has no `COPY . .`, and the harness sets its own `DATABASE_URL` rather than
    inheriting one.
- **RA-21 and RA-22: two process defects that cost this pass real time are now gates, not
  reminders.** Both were things the docs already told you to be careful about, which is the
  proof that a warning is not a control.
  - **RA-21 (`scripts/docker-build.sh`, `npm run docker:build`).** This host builds with the
    docker-container/buildx driver, where `docker build -t …` exits 0 and writes only to the
    build cache: measured on 2026-10-11, the build reported success and `docker images` had
    never heard of the tag, so the container the gate then booted was an image from before the
    fix and its green belonged to old code. The script passes `--load` and then requires the tag
    to exist *and* to have been created after the script started — an existing-but-old tag is
    the same false green, so both halves are needed. Its controls were run, not assumed: with
    the build line skipped, an existing `pass7` tag fails with
    `IMAGE_STALE: … created at 2026-10-11T15:51:13Z, before this build started` (exit 1) and an
    unknown tag fails with `IMAGE_MISSING` (exit 1); the unparseable-timestamp case exits 1 as
    `IMAGE_UNVERIFIABLE` rather than comparing as zero. The real build on the final tree printed
    `IMAGE_OK gid-task-flow:pass7` and exited 0.
  - **RA-22 (`scripts/check-prisma-client.mjs`, `npm run db:client:check`).** Both Prisma
    schemas emit into the same `node_modules/.prisma/client`, so generating the Postgres client
    silently replaces the SQLite one the integration harness needs — and the suite then fails
    with an adapter/provider error that reads like a broken test. `npm test` and
    `npm test:integration` now open with a check that reads the `provider` out of the generated
    `schema.prisma`. Measured: clean state → `PRISMA_CLIENT_OK … targets sqlite` (0); after
    `npm run db:generate:postgres` → `PRISMA_CLIENT_CHECK_FAILED … Fix: npm run db:generate` (1);
    after `npm run db:generate` → back to 0. A missing client is exit 2 with the same remedy, so
    the check cannot pass on an absent artefact. CI is unaffected by construction: its quality
    job runs `npx vitest run` with its own pinned generate step, not `npm test`.
- **RA-08 stopped being an accepted risk and was fixed.** It had been recorded as the one
  re-audit finding carried as Risk accepted: the SSR shell ships the sidebar with
  `aria-hidden="true"` because `useMediaQuery` cannot know the viewport on the server, so the
  axe gate had to wait for hydration before scanning. The fix was already in the file and
  nobody had noticed — the class string carries the breakpoint in pure CSS
  (`invisible … md:visible … md:translate-x-0`), and `visibility: hidden` already removes a
  subtree from both the accessibility tree and the tab sequence. A media query is the one
  thing a server render can get right without JavaScript, so the viewport-derived attribute
  was redundant *and* the only part that could be wrong: a screen reader parsing the markup
  before hydration was told the navigation does not exist. `aria-hidden` and the now-unused
  `isDesktop` prop are gone from `Sidebar`; `tests/unit/components/sidebar-shell-a11y.test.tsx`
  renders the layout with `useMediaQuery` mocked to the server's answer (it fails against the
  old markup, which is how it was written first) and asserts both that the shell makes no such
  claim and that the CSS terms which replace it are present.
- **FL-08 (found by this pass's own docker gate): the task engine believed a clock that ran
  backwards.** The dual-provider boot on the new base failed one smoke check on SQLite and
  passed it on Postgres — `PATCH complete` banked `elapsedSeconds: -12`. It was not a provider
  defect: the Docker VM corrected its clock between two requests, and `now` in
  `src/app/api/tasks/route.ts:451` is that request clock, so `applyTaskTransition` happily
  computed `workingTimeDiffSeconds(startedAt, now)` (0, because its own `endedAt <= startedAt`
  guard fired), hit the `computed === 0` wall-clock fallback, and stored the negative — with an
  `endedAt` earlier than the row's `startedAt`. A reproduced probe against the live container
  showed `startedAt 14:36:20.577Z / endedAt 14:36:11.921Z`, and `date -u` in the same container
  was in step with the host minutes later: transient, and therefore exactly the kind of input a
  time-keeping product must not trust. `/api/attendance` already clamps (`secondsBetween` is
  `Math.max(0, …)`); the task side now does too — a transition instant is floored at the
  segment's own `startedAt`, which also stops a hold checkpoint from sliding backwards and
  re-counting the segment it had already banked, and banked seconds are never negative. The
  list projection in `GET /api/tasks` clamps what it displays, so a row written before this fix
  cannot show negative work time. Four tests in `tests/task-lifecycle.test.ts` pin it,
  including the resume-after-step-back case whose absence would report 9000s instead of 7200s,
  and the smoke check now asserts `endedAt >= startedAt` as well as `elapsed >= 0` — the ordering
  is what a task already holding banked time would otherwise hide.
- **SEC-01's runtime tree is now empty.** The previous pass reported 20 advisories against
  `--omit=dev` and recorded the rest as needing semver-majors that were "scheduled upgrade
  work". The majors were taken. Four `overrides` were needed because the flagged leaves are
  each pinned to an **exact** version by their parent — `chevrotain`→`lodash@4.17.21`,
  `@prisma/config`→`deepmerge-ts@7.1.5`, `prisma`→`mysql2@3.15.3`,
  `@tailwindcss/typography`→`postcss-selector-parser@6.0.10` — so `npm audit fix` could not
  move any of them, and the top-level `lodash@4.18.1` the earlier pass had installed was a
  *second* copy rather than a fix (measured: after overriding, no nested copies remain).
  Then `puppeteer` went 24.43.1 → **25.13.0**, which is the change the advisory chain
  actually required: `@puppeteer/browsers@3.2.4` depends on neither `extract-zip` nor
  `proxy-agent` any more (`node_modules/extract-zip` is now absent, not newer), clearing the
  last 8 runtime Highs. Puppeteer is a runtime dependency — `src/lib/pdf-render.ts` exports
  the PDFs — so it could not be reclassified as dev and counted as solved. Counts, in order:
  runtime 20 → 8 → **0**, full tree 26 → 14 → **6**. The 6 that remain are dev-only lint and
  build tooling with no upstream remedy: `eslint-config-next` is already at the version that
  matches `next@16.4.0` and npm proposes a two-major *downgrade* to 14.2.35, `braces`,
  `fast-glob` and `micromatch` are flagged across every published version, and the `esbuild`
  Low is pinned by `tsx` and `vite`.
- **The Node floor moved to `>=22.12.0`, and the base image with it, because puppeteer 25
  demands it** (`puppeteer/package.json` `engines.node`). This is the change an earlier pass
  of the same finding considered and explicitly declined "for a release cut"; once the
  advisory work required it, it was made properly: `node:20-alpine3.20@sha256:3bc9a4…` →
  `node:22-alpine3.23@sha256:baf676f7…` (the image reports `v22.23.3`), `node-version: "20"` →
  `"22"` in all three CI jobs, `engines`, `scripts/check-engines.mjs` and `engines:check`
  re-armed, and every apk pin re-**read** from the new base with `apk policy` rather than
  guessed: `python3=3.12.15-r0 make=4.4.1-r3 g++=15.2.0-r2`, `curl=8.22.0-r0`,
  `chromium=149.0.7827.53-r0`. `npm run engines:check` over 1261 installed manifests (426 of
  which declare `engines.node`) reports 0 excluding either 22.23.3 or 24.18.0.
  `scripts/engine-strict-probe.sh` now installs in the shipping image — `PROBE_EXIT=0 … accepts
  the manifest set on 22-alpine3.23` — and its falsification control was run too: the same
  probe with `ENGINES_PROBE_IMAGE=node:20-alpine3.20` exits 1 with `npm error code EBADENGINE …
  Not compatible with your version of node/npm: project-tasks-log@0.2.0`, which is now the
  intended outcome. Verified end to end on the final tree of this pass, on the new base:
  `npm run db:generate`, `npm test` (the client precheck, lint, typecheck, 61 files / 843
  tests), `npm run build`, `npm run test:e2e` (86 passed / 42 skipped on the 3×3 engine ×
  viewport matrix), `npm run docker:build -- gid-task-flow:pass7` (`--load` plus the landed-tag
  check), and both provider boots behind Coolify-style container names with `npm run
  smoke:container REQUIRE_PDF=1` — 28 checks, 0 failed on SQLite and the same on Postgres 16,
  each returning a real `application/pdf` from the image's Chromium (35316 and 34985 bytes).
  That gate is what surfaced FL-08 above.
- **PAR-03's repair was rewritten, because the guard the fourth pass added was too weak to
  catch what the repair itself could do.** Rule E only asked for *an* `UPDATE`/`DELETE` above
  the `CREATE UNIQUE INDEX`; a statement that writes a different table, or writes the right
  table without touching the predicate column, passed it while leaving the duplicates in
  place. Rule E is now per statement and requires the target to be the index's own table *and*
  the predicate column to appear where it changes rows — in the `SET` list of an `UPDATE`, in
  the `WHERE` of a `DELETE`. Six controls, all behaving as predicted: shipped file green; no
  backfill red; `UPDATE "Project" …` red; `UPDATE "JobAttendance" SET "totalWorkSeconds" = 0
  WHERE "checkOutTime" IS NULL` red (the shape the weak rule accepted); backfill below the
  `CREATE` red; a `DELETE`-form repair green, so a different valid fix is not failed for style.
- **The same pass found a data-loss condition in its own PAR-03 fix.** The repair used
  Prisma's copy-and-swap rebuild for a default change — `CREATE TABLE new_Job`, copy,
  `DROP TABLE "Job"`, rename. `PRAGMA foreign_keys` is a no-op inside a transaction, so on a
  connection that enabled the pragma *before* opening it the `DROP` does not fail: the
  `ON DELETE CASCADE` arms on Project, Task, JobAttendance and BreakType fire and those four
  tables are emptied while the migration still exits 0. Measured on a populated database
  through all three (pragma, transaction) conditions: `OFF/OFF lost=nothing`,
  `ON/OFF lost=nothing`, `ON/ON lost=Project,Task,JobAttendance,BreakType`. The repair is now
  additive — `ADD COLUMN` with a constant default, `UPDATE`, `DROP COLUMN`, `RENAME COLUMN` —
  which never destroys the table identity the children point at, and measures
  `lost=nothing` in all three conditions with the same resulting default, index, empty
  `PRAGMA foreign_key_check` and no orphans. `tests/unit/migration-job-workdays-repair.test.ts`
  (11 tests) pins that matrix and carries its own controls: the copy-and-swap form empties the
  same fixture, and an unrepaired database stores `1, 2, 3, 4, 5` where `JSON.parse` throws.
  Prisma's own `migrate deploy` was re-measured on a populated database both before and after
  the repair (rows preserved, default becomes `'[1, 2, 3, 4, 5]'`), and `migrate diff` reports
  no drift in either direction — the additive form reorders the column list, and SQLite, unlike
  Prisma, cares.
- The fourth re-audit pass looked at the code the third pass had just written and found a
  defect class nobody had tested: **PAR-09**. `20261010180500` can only create its unique
  index because the statement above it closes the rows the old race produced — but on a
  database that already holds two open check-ins, the `CREATE UNIQUE INDEX` alone fails
  (`UNIQUE constraint failed: JobAttendance.jobId`, measured), the migration aborts, and the
  deployment never boots. Nothing in the suite
  could see that: the integration tests build a clean schema with `db push`, and
  `db:parity:migrations` compared text. Two things now hold it. `scripts/check-migration-parity.mjs`
  gained rule E (a required partial index must be preceded in the same file by a statement that
  resolves existing violations, checked in **both** sets — measured: removing the backfill from
  one set or from both exits 1, and rule C still fires when only the predicate diverges).
  And `tests/unit/migration-attendance-backfill.test.ts` replays the *real* SQLite migration
  files in directory order onto a temp database with `better-sqlite3` (a declared dependency),
  plants three open rows on one job plus controls, applies the migration, and asserts the
  outcome row by row: one open row per job, the highest id keeps its seconds, the losers close
  at their own check-in time with zero, closed history untouched, a second open row refused, a
  second *closed* row allowed, the index still present after the `Job` rebuild in
  `20261010182000`, and that rebuild's default now parsing as JSON. Proven to fail: deleting the
  backfill from the migration turns 3 of its 4 tests red, restoring turns them green. The same
  fixture ran against Postgres 16 with the shipped files — `UPDATE 2`, `CREATE INDEX`,
  `duplicate key value violates unique constraint "JobAttendance_one_open_check_in"` for the
  open control, `INSERT 0 1` for the closed one. `POST /api/attendance`'s contract text in
  `docs/openapi.yaml` was regenerated to say the constraint is the database's now, not the
  transaction's, since both paths answer the same 409.
- The four provider-parity findings the previous pass deliberately left open are fixed,
  each one measured on both shipped engines rather than argued from the schema.
  **PAR-04** (High, the one-open-check-in race) is closed where it can be closed for both
  providers: a partial unique index `JobAttendance_one_open_check_in` on
  `("jobId") WHERE "checkOutTime" IS NULL`, written identically into both migration sets,
  backed by an in-migration backfill that closes orphaned open rows first so no existing
  deployment can fail at boot, and `src/app/api/attendance/route.ts` maps the resulting
  `P2002` to the same 409 its pre-check already returns. A Postgres-only `FOR UPDATE`
  would have left SQLite unprotected; this cannot. Proven on real data — Postgres answers
  `duplicate key value violates unique constraint "JobAttendance_one_open_check_in"`,
  SQLite answers `SQLITE_CONSTRAINT_UNIQUE` with `open rows = 1` — plus three integration
  tests including two concurrent requests that yield exactly `[200, 409]`.
  Because `db push` builds the test database from the schema alone and Prisma cannot
  express a partial index, `tests/integration/helpers/harness.ts` now applies the
  SQLite file through `RAW_SQL_OBJECT_MIGRATIONS`, and `npm run db:parity:migrations`
  pins all three halves (both sets declare it, the harness applies it).
  **PAR-03** (the unquoted `DEFAULT [1, 2, 3, 4, 5]`) is repaired by a new SQLite
  migration that rebuilds `Job` copy-and-swap with `DEFAULT '[1, 2, 3, 4, 5]'`; a fresh
  `migrate deploy` now stores `"[1, 2, 3, 4, 5]"` which parses as JSON, and Prisma's own
  `migrate diff` reports no drift in either direction, so the shipped schema files stayed
  truthful. The parity check's shrink-only exception list now requires a `repairedBy`
  migration that exists, quotes the default, and sorts after the defective version.
  **PAR-06** (NULL `endedAt` ordering) now requests `{ sort: "desc", nulls: "first" }`
  explicitly, which the generator resolves to `NULLS FIRST` on Postgres and an `IS NULL`
  ordering term on SQLite, so the same export rows come first on both. **PAR-08**
  (collation-dependent tie-break) replaces `name: "asc"` with `id: "asc"` in
  `src/app/api/breaks/route.ts`, and a test inserts `apple` then `Tea` in the same
  instant to prove adjacency by id rather than by collation.
- Two commands that had never been run against a real database, and the gate that now
  watches both of them (RA-20, PAR-02, PAR-03). (a) `npm run db:migrate:postgres` was
  `prisma migrate deploy --schema prisma/postgres/schema.prisma`; the root
  `prisma.config.ts` pins `migrations.path` to the SQLite directory, so against a live
  Postgres server it loaded `13 migrations found in prisma/migrations` and died with
  `P3019: The datasource provider postgresql specified in your schema does not match the
  one specified in the migration_lock.toml, sqlite` — the documented way to migrate a
  Postgres deployment had never worked, even though `docker-entrypoint.sh` writes its own
  provider-specific config at boot and its comment admits the failure. It now points at a
  committed `prisma/postgres/migrate.config.mjs` (`db:migrate:dev:postgres` had the same
  defect and got the same fix), and running it against a freshly created database applies
  all three Postgres migrations with exit 0. Writing that file measured one more thing:
  Prisma resolves the paths inside a config relative to *the config file's directory*, not
  the cwd — the first attempt looked for `/app/prisma/postgres/prisma/postgres/schema.prisma`.
  (b) The two migration sets seeded different data: `20260327201323_add_job_hierarchy`
  inserts a default `Job` and the Postgres set contained no `INSERT` at all, so a fresh
  Postgres deployment started with an empty board while a fresh SQLite deployment started
  with "Default Job" — identical schema files, different database. Fixed additively with
  `20261010173500_seed_default_job` (`WHERE NOT EXISTS`, so it cannot collide with a job an
  operator made), verified by the fresh deploy above, which now reports
  `default-job | [1, 2, 3, 4, 5] | 09:00 | 17:00`. (c) `prisma/migrations/…add_job_hierarchy/migration.sql:21`
  declares `"workDays" JSONB NOT NULL DEFAULT [1, 2, 3, 4, 5]`: in SQLite a bracketed token
  is an *identifier* quote, so that is not a JSON array default. Measured against
  `better-sqlite3`: the DDL loads, and an insert that omits the column stores the string
  `1, 2, 3, 4, 5` — not valid JSON. The application is not exposed (`src/app/api/jobs/route.ts`
  always supplies `workDays`), and repairing it means rebuilding `Job` — the table three
  others reference — on data that is already shipped, so at that pass it was recorded as a
  tracked exception rather than fixed blind; the first bullet above is the repair. What is
  new is `scripts/check-migration-parity.mjs`
  (`npm run db:parity:migrations`, wired into CI next to `db:parity`): `db:parity` compares
  the two *schema files* and could see none of this, so the new check compares the
  *migration sets* — which tables each one seeds, and any constant default written as a
  bracket token, with a shrink-only list for the one already applied. Both rules are proven
  to fail: deleting the new Postgres seed migration produces
  `Job is seeded by the sqlite migration set but not by postgres` (exit 1), and an injected
  `DEFAULT [1, 2, 3]` produces the bracket-token message (exit 1), while the tree as
  committed reports `Migration parity OK: both sets seed the same tables (Job)` (exit 0).
  Prisma's table-rebuild copies (`INSERT INTO "new_Job" … RENAME TO "Job"`) are excluded,
  because they move existing rows rather than seeding data.

The 0.2.0 re-audit kept going until the report was clean, and that second pass
found real defects in the layer nothing had tested yet. Entries below are tagged
with the re-audit ids (RA-xx) recorded in sheet 12 of the audit workbook.

### Added
- React component-level tests (OPEN-01). `vitest.config.ts` now declares two
  projects instead of one environment: `node` for the lib and route-handler
  suite, which keeps running against real Prisma in production `NODE_ENV`, and
  `components`, a jsdom project pinned to `NODE_ENV=development` because
  `React.act` does not exist in a production React build. 44 tests over
  `ModalShell`, the task board and subtask editing
  (`tests/unit/components/`), with `render-helpers.ts` recording every fetch so a
  request body is asserted rather than assumed. Dev dependencies only
  (`jsdom`, `@testing-library/*`); nothing in the shipped bundle changes.
- Automated accessibility gates (RA-07), which the audit could previously only
  record as *not claimed*. `tests/unit/components/accessibility.test.tsx` runs
  axe-core over the rendered components in jsdom and carries a control case that
  asserts the same scan reports `button-name` and `aria-dialog-name` on bad
  markup - a gate that cannot fail is indistinguishable from a gate that never
  ran. `tests/e2e/accessibility.spec.ts` injects the same axe-core into
  Chromium, WebKit and Firefox at 1440px and scans seven routes with
  `color-contrast` and the landmark rules enabled, the two axe cannot judge
  without real pixels and a real document. 21 route x engine scans pass.
  `axe-core` is now a declared devDependency rather than a transitive of
  `eslint-plugin-jsx-a11y`.

- The 3 x 3 Playwright matrix now runs in CI. `.github/workflows/ci.yml` installed
  `@playwright/test` and had a `tests/e2e/` directory, but no job ever executed it, so
  every "128 scenarios green" number in the audit was a single local measurement
  nobody else could repeat. A `Responsive + axe matrix` job now runs
  `npx playwright test` (all nine projects) and uploads the HTML report on failure.
  The re-audit that found this also found the matrix's first local red —
  `[webkit-tablet] /projects` hit Playwright's 90s once and passed in 3s in isolation
  — so `tests/e2e/global-setup.ts` now requests every page route once before the
  tests start. `next dev` compiles a route on its first request, and that compile was
  being billed to whichever browser arrived first; warm-up moves it outside every test
  budget and prints the per-route time, and setup now fails with that number if a
  route ever takes more than 60s to serve cold.
- An engines gate that runs in the runtime it is about. `engines` ranges are now
  checked by `npm ci --include=dev` executed inside the digest-pinned base image,
  because `.npmrc`'s `engine-strict=true` makes an engines violation a hard refusal on
  Node 20 while a Node 24 developer machine only warns — the exact asymmetry that
  made RA-09 invisible locally.

### Fixed
- The Postgres half of `db:backup`/`db:restore` had never been executed (RA-13..RA-19).
  Both scripts stayed green through two audit passes because every test forced
  `pg_dump`/`psql` to be *missing* — so nothing ever looked at the arguments the tools
  actually receive. Running them in Linux against a real database that had rows found
  seven defects: the documented Prisma URL (`…?schema=public`) was handed to libpq whole
  and refused (`pg_dump: error: invalid URI query parameter: "schema"`, exit 3), the
  connection string — password included — travelled on argv where any local process can
  read it from `/proc/<pid>/cmdline` (measured `old-argv-password-hits=2`; the tools now
  get discrete `-h/-p/-U/-d` plus `PGPASSWORD`, and the same probe reads 0), `--force`
  restored onto a non-empty database by dropping and recreating the `public` schema
  *without* the safety copy the SQLite path takes (the pre-fix run left no
  `*-pre-restore` directory; the fixed run's copy contains the mutated live rows,
  `mutated=1`), a `--exclude-tokens` manifest claimed rows the dump deliberately omitted
  (`9 tables, 3 rows` against a payload holding zero of them) and then failed its own
  post-restore check — `ApiToken has 0 rows, snapshot says 2`, exit 4, after the database
  was already gone, the entrypoint's schema-hash marker survived a restore so the next
  boot skipped `migrate deploy` onto the restored file (cleared before anything is
  destroyed now: `MARKER_CLEARED`), the documentation named the Postgres payload
  `backup.sql` while the code writes `database.sql`, and the `*_PATH` overrides were
  collected as secret *values*, so the command redacted the very backup-root path it
  exists to print. Eleven new tests cover the set, with the destructive-call ordering
  pinned by which error surfaces first.
- Three provider-parity defects that made the two shipped databases disagree (PAR-01,
  PAR-05, PAR-07). `docker-entrypoint.sh` gated `prisma generate` behind the schema hash
  even though generate writes into the image's own ephemeral `node_modules`, so a
  container whose `/data` volume still held an old hash booted with a stale generated
  client; it now runs on every boot and only `migrate deploy` is gated. `npm run db:seed`
  built a `PrismaBetterSqlite3` adapter unconditionally, so seeding a Postgres deployment
  died on the URL — the adapter now follows the resolved provider. And the report-title
  PATCH (ST-01) read the settings row with a plain `SELECT` inside its transaction, which
  under PostgreSQL's READ COMMITTED lets two concurrent writers each overwrite the other's
  list: the read now carries `FOR UPDATE` where the provider understands it, and nothing
  on SQLite. Five further parity differences — the default `Job` row only the SQLite
  migrations insert, the unquoted `workDays` JSON default, the one-open-check-in race, the
  NULL-`endedAt` ordering that changes which rows survive the export row cap, and
  collation-dependent text tie-breaks — were recorded as findings PAR-02/03/04/06/08 in the
  re-audit sheet instead of fixed blind: they need new migrations on *both* providers plus a
  locking decision, and editing already-applied migrations is not a remedy. All five are now
  fixed additively, in the first bullets of this section.
- SEC-01's accepted-risk rationale was wrong, and the fix it argued against was
  available. The workbook and `docs/security.md` stated that no advisory had a
  non-breaking remedy and that npm's Prisma fix was a downgrade to `prisma@6.19.3`;
  that had been measured with `npm audit fix --force`. Plain `npm audit fix` takes
  `prisma` 7.5.0 → 7.10.0, `puppeteer` 24.40.0 → 24.43.1 and `@tiptap/*`
  3.21.0 → 3.31.4 as same-major upgrades, including `prosemirror-view` 1.42.6 (above
  the paste-XSS fix the old text had rationalised). The runtime tree went from
  31 advisories (9 moderate, 22 high) to 20 (7 moderate, 13 high), and the full tree
  from 43 to 26, with no declared range in `package.json` moving. Taking `prisma@7.10.0`
  needed one override — its newer `@prisma/dev` pulls `@prisma/streams-local`, whose
  engines are `>=22.0.0` in *every* published version, which `engine-strict` refuses
  on the Node 20 image and CI — so `@prisma/dev` is pinned back to the `0.20.0` this
  project already shipped with, with the `hono`/`valibot` leaves it pins raised to
  their patched versions. What still has no non-major remedy is now named per package
  from npm's own `fixAvailable` data instead of inferred.
- `puppeteer@24.43.1` removed `networkidle0` from `page.setContent`'s `waitUntil`
  union; `src/lib/pdf-render.ts` waits for `load` now, which for a document handed
  over whole by `setContent()` already means every referenced resource has finished.
  `npm run typecheck` is what caught it, and the unit test that pins the call was
  updated with it.
- The engines probe now installs where it will not leave debris behind (RA-12). It went
  red on GitHub Actions for a reason that had nothing to do with `engines`: the install
  wrote ~800 packages onto a bind mount as the container's root, so the script's own
  cleanup trap failed as the runner user after `npm ci` had already succeeded. The same
  script failed differently here, because a Git Bash `/tmp` is not the daemon's `/tmp` —
  the bind source resolved inside the VM, the container saw an empty directory, and npm
  reported a misleading "no package-lock.json". The manifests are mounted read-only and
  the install runs in the image's own filesystem now, the host path is normalised first,
  and a `PROBE_INPUT_MISSING` guard names the cause instead of npm's error. Both a
  two-package fixture (installs, cleans up) and a `jsdom@30` fixture (refused with
  `EBADENGINE` on `node v20.19.2 / npm 10.8.2`) were run against it, because a gate that
  cannot fail proves nothing.
- The toolchain now refuses a dependency that cannot run on the shipped Node (RA-09).
  CI caught what this host could not: `jsdom@30` declares `engines.node` as
  `^22.22.2 || ^24.15.0 || >=26.0.0`, so the new component suite died in CI's forked
  worker with `webidl.util.markAsUncloneable is not a function` - npm only *warns*
  about engines by default, and the developer machine ran Node 24. Two changes,
  because pinning jsdom back to `26.1.0` (engines `>=18`) would have fixed today's run
  and left the same trap armed for the next install: `package.json` now declares
  `engines.node` as `^20.19.0 || ^22.12.0 || >=24.0.0`. The floor is `prisma@7`'s own
  `^20.19`; the digest-pinned `node:20-alpine3.20` builder reports `v20.19.2`, one patch
  clear of it, and the README had been stating "no `engines` field exists"
  as if that were acceptable. `.npmrc` sets
  `engine-strict=true` so an incompatible package stops `npm ci` with its name and
  range instead of surfacing three jobs later. The pre-fix Docker build transcript is
  the proof that warnings alone were not enough: it prints 18 `npm warn EBADENGINE
  Unsupported engine` blocks - `jsdom@30.1.2` and eight of its dependencies, once per
  install step - each against `current: { node: 'v20.19.2', npm: '10.8.2' }`, and the
  build still succeeded. A re-sweep of the installed tree at this change finds
  1379 `node_modules/**/package.json` files, 482 of which declare `engines.node`, and
  none of those ranges excludes either `20.19.2` or `24.18.0`.
  `.npmrc` is deliberately not copied into the image, so the release build path is
  unchanged.
- `ModalShell` was not a dialog to assistive technology (RA-01). It rendered a
  plain `div`: no `role`, no `aria-modal`, no name, no Escape, no focus handling,
  so a screen reader announced a task form as unnamed page text and Tab walked
  straight out of the modal into the page behind it. It is now
  `role="dialog"` + `aria-modal="true"` + `aria-labelledby` aimed at the visible
  heading (`PageHeader` gained a `headingId` prop for exactly that), Escape
  closes, focus moves to the first control on open and back to the opener on
  close, and Tab wraps inside the panel. The document `keydown` listener is
  removed on cleanup, which is why the ST-04 timer/listener guard's expected
  listener count moved from 10 to 11.
- Controls that had no accessible name (RA-02). axe reported `select-name` and
  `label` as *critical*: the heading selector in `rich-text-editor.tsx`, the
  report-title selector in `export-page-content.tsx`, the break-type selector in
  `global-break-widget.tsx`, the default-title radios in
  `report-title-options-manager.tsx`, and the three `field-label` fields in
  `breaks-config.tsx` plus the input form in `confirm-dialog.tsx` - each of those
  labels was a sibling with no `for`, which does not name anything. The two
  mechanisms worth recording: neither axe nor Testing Library's role/name queries
  read a `placeholder` as a name, and a `<label>` only names a control through
  `htmlFor`/`id` or by wrapping it. Fixed with `htmlFor` pairs (via `useId` where
  the component is reused), `aria-label` on the selectors and radios, and the
  repo's existing `sr-only` label convention on the board and subtask inputs.
- The check-in and check-out buttons failed their own contrast budget (RA-06).
  White on `bg-green-500` measures **2.21:1** against the 4.5:1 the app's token
  table promises, and the red twin was worse, while `globals.css` already shipped
  `.btn-success` (4.6:1) and `.btn-danger` (5.5:1). `job-attendance.tsx` now uses
  those tokens, so the ratio comes from the documented scale instead of a
  hand-picked colour. Only a real browser can see this class of defect: jsdom has
  no painted pixels, which is why the e2e axe gate exists.
- Failures were displayed but never announced (RA-04). The task board and the
  subtask list rendered their error strings in hand-rolled `div`s, so a rejected
  save - a 409 state-machine conflict, a 503 from a paged search - changed pixels
  and told assistive technology nothing. Both now use the repo's `StatusBanner`,
  which carries `role="alert"` for the error tone.
- The subtask delete button could be focused while invisible (RA-03). It was
  `opacity-0` with only a hover rule restoring it, so keyboard users reached a
  control they could not see and could activate blindly. Added
  `focus-visible:opacity-100`.
- The rich-text surface had no role or name (RA-05). A `contenteditable` div is
  not a textbox to assistive technology unless it says so, and its placeholder is
  a CSS affordance nothing can read; the editor now sets `role="textbox"`,
  `aria-label` from the placeholder and `aria-multiline="true"`.
- The sidebar wordmark was announced twice (RA-02 sweep): the logo `img` carried
  `alt="GID Task Flow"` next to the text "GID Task Flow". It is decorative now
  (`alt=""`), and the link keeps its name from the visible text.
- The app shell no longer forces a horizontal scrollbar at the `md` breakpoint:
  `SidebarLayout`'s `<main>` carried `flex-1` with the CSS default
  `min-width: auto`, so it refused to shrink below the min-content width of the
  drawn page and the seeded dashboard measured 1002px inside a 768px viewport.
  Re-measured with the class removed, the overflow trips WebKit and Firefox at
  768px and not Chromium, whose min-content for this tree fits — the defect is real
  but engine-dependent, which is the argument for a three-engine matrix rather than
  one browser. `min-w-0` fixes it everywhere (RS-01, RS-02).
- The responsive matrix stopped measuring loading skeletons, and its overflow check
  is no longer engine-dependent. The dashboard test asserted no-overflow right after
  the heading appeared, while the stats and reminders were still arriving from
  `/api/*`, so the same layout passed or failed on request timing; it now drains
  in-flight API calls like the other route tests, waits for the stylesheet to be
  provably in effect, names the elements that overflow while their parent fits
  (blaming the deepest leaf had pointed at a PageHeader paragraph that was only a
  symptom), and asserts the shell twice over: its right edge against the viewport,
  and its computed `min-width` against `0px`. The second is the one that catches
  this class of defect on every engine — with `min-w-0` removed, 6 of
  chromium-tablet's 9 responsive tests fail it even though every scroll assertion
  on that engine passes. How the defect above was found: a firefox-tablet failure
  the first pass dismissed as flaky was real, and once the wait was fixed it
  reproduced deterministically.

### Changed
- `/api/export` pipes Chromium's printed document straight to the response instead
  of buffering it: `renderPdfBytes` (`page.pdf()`, one finished buffer) became
  `renderPdfStream` (`page.createPDFStream()`, available since Puppeteer 22 and this
  repository pins 24). The browser is now closed by the stream itself — when the
  body drains, when printing errors, or when the client hangs up mid-download — and
  all three paths are pinned by unit tests, with the integration suite asserting the
  chunks reach the caller unbuffered. This closes the PF-02 residual 0.2.0 left
  open, and corrects the reasoning in the old comment, which claimed no streamable
  PDF API existed. What genuinely stays in memory is the report HTML, because
  `page.setContent()` requires the whole document; that is now stated plainly
  instead of being used to justify the buffer.

## [0.2.0] - 2026-10-09

Audit remediation campaign (93 findings, 2026-10-07 audit workbook). Entries are
tagged with the finding ids they close.

### Added
- `src/lib/task-lifecycle.ts`: one server-authoritative transition machine for
  task status/elapsed time, replacing per-route arithmetic (FL-02..07, SEC-05).
- `src/lib/startup-checks.ts` + `src/instrumentation.ts`: fail-fast validation of
  `SESSION_SECRET` / plaintext `APP_PASSWORD` in production (SEC-03).
- `src/lib/bootstrap.ts`: guarantees the settings row and reports whether login is
  configured at boot instead of returning a blank 500 on first run (BG-05, ST-02).
- `POST /api/breaks/log`: transactional break recording that banks the running task
  first (FL-01, UX-03).
- `src/lib/rate-limit.ts` with per-IP login throttling and `Retry-After` (MF-02).
- Security headers from `next.config.ts`: CSP, nosniff, frame-ancestors,
  Referrer-Policy, Permissions-Policy, HSTS in production (MF-03).
- `src/components/ui/card.tsx` and `src/components/ui/status-banner.tsx`: shared
  Card / SectionCard / SurfaceSection / PageHeader / EmptyState / StatusBanner
  primitives, plus `.btn-*` and `.field-*` component classes and a full light+dark
  design-token set in `globals.css` (UI-03, UI-10, BF-04).
- Off-canvas mobile sidebar with hamburger, skip link, backdrop, Escape and
  route-change close, and a break widget that docks clear of the header on small
  screens (UI-06, RS-01, RS-02).
- Stacked label/value cards as the small-screen rendering of dashboard tables (RS-03).
- `useKeyedApiMutation` alongside `useApiMutation`, so task board, subtasks and
  attendance share one mutation core (UI-04).
- `next/dynamic` code splitting for the TipTap editor and the export builder, plus
  `scripts/measure-bundle.mjs` (`npm run bundle:budget`) reporting and enforcing a
  per-route First Load JS budget (PF-05).
- `scripts/check-schema-parity.mjs` (`npm run db:parity`) failing when the SQLite and
  Postgres Prisma schemas drift (AR-02).
- Coverage tooling (`@vitest/coverage-v8`), `vitest.config.ts` thresholds and
  `test:unit` / `test:integration` / `test:coverage` scripts; `npm test` now chains
  lint + typecheck so a green suite cannot hide lint errors (TC-02, TC-04).
- `src/lib/api-tokens.ts` + `/api/tokens` (AI-02, commit `9a46388`): scoped
  `read`/`write` bearer tokens formatted `gid_<40 hex>`, stored only as a SHA-256
  digest with `expiresAt` / `revokedAt` / `lastUsedAt`, individually revocable, and
  minted/listed/revoked through a cookie-only route so a token can never mint a
  token. `ApiToken` migrations exist for both providers.
- `src/lib/idempotency.ts` (AI-03): `Idempotency-Key` replay semantics
  (replay / 409 on body mismatch / 400 on malformed key / 425 while in flight),
  wired into `POST /api/tokens` today with a 5-minute window.
- `src/lib/security-events.ts` (MF-02): one redacted JSON line per security event
  to stderr — `login.failed`, `login.rate_limited`, `token.rejected|revoked|expired|
  rate_limited|created|revoked_by_operator|mint_denied`, `idempotency.conflict`.
- Rate-limit buckets beyond human login (AI-03): per-token `api` 120/min,
  `tokens-mint` 10/5min, `tokens-list` 60/min, `anonymous` 30/min, plus a
  per-IP rejected-bearer lock (30/5min) in `src/lib/auth.ts` so brute force stops
  costing database lookups.
- Opt-in keyset pagination and substring search on the list routes
  (`GET /api/tasks`, `/api/jobs`, `/api/projects`: `limit` 1..200 default 50,
  opaque `cursor`, `q`, plus `status`/`jobId` filters; `nextCursor` appears only
  when pagination is requested) — byte-compatible with the old payloads otherwise (MF-05).
- Stats aggregation memoised per process (`src/lib/stats-cache.ts`), and the
  `/api/export` handler split into `src/lib/export-data.ts`, `export-html.ts`,
  `export-html-styles.ts` and `pdf-render.ts` so the route holds only transport
  concerns (AR-01, PF-03).
- `docs/security.md`: credential resolution order, token lifecycle, CSRF posture
  and residual risks, rate-limit budgets, idempotency rules, event redaction.
- `docs/architecture.md`: module map, data model, invariants, and **ADR-001
  "the product is single-user by design"** recording the MF-07 decision instead
  of only disclaiming it.
- `docs/CONTRIBUTING.md`: gates, branch/PR and WIP-visibility workflow,
  semver + annotated-tag release procedure, documentation duties, repository
  hygiene findings.
- `.gitattributes`: `* text=auto eol=lf` plus binary overrides, so a Windows
  checkout stops reporting phantom line-ending churn.
- `LICENSE` (MIT) and this `CHANGELOG.md` (PM-02).
- `.gitignore` entries for archives and scratch files, so a repository snapshot
  can never be committed by accident (`*.zip`, `*.tar.gz`, `.tmp-*`).
  PM-01 note: `project-tasks-log.zip` was untracked and never committed
  (`git log --all --diff-filter=A -- project-tasks-log.zip` is empty), and the
  operator has now deleted it — it held a `dev.db` snapshot with real
  client/project/task names.
- `docs/security.md` section 8, "Dependency advisories": the accepted-risk
  posture written down with the actual numbers instead of a hand-wave — 32
  runtime advisories (9 moderate / 23 high), grouped by root cause (Prisma 7
  chain, Puppeteer chain, rich-text chain), each with why npm's own fix is worse
  than the risk, the `--no-sandbox` trade-off, and the fact that SEC-14's
  Chromium pin means CVEs arrive as reviewed maintenance rather than automatic
  patches (SEC-01).
- A non-blocking `Dependency advisory posture (SEC-01)` step in CI, so an
  accepted risk keeps being measured on every run rather than rotting into an
  untracked one.
- `scripts/container-smoke.mjs` (`npm run smoke:container`): the AGENTS.md docker
  gate as code — 28 functional checks (auth refusal and cookie login, task
  lifecycle with server-side timing, `Idempotency-Key` replay, break dedupe,
  stats, `/api/export/data`, a real `%PDF` from the image's own Alpine Chromium
  under `REQUIRE_PDF=1`, token mint/scope/revocation, the hard-delete guard,
  admin event paging, logout) run against the booted container on both providers.
  CI's `smoke` job now executes it instead of the two curl requests it used to
  make, which is what caught AR-06 by hand and could not catch it again. A run
  that hits the login limiter (5 per 5 min per IP, i.e. twice per re-run) aborts
  with the `Retry-After` instead of reporting twenty misleading failures.
  (AR-06, MF-01, PM-04, TC-01)

### Changed
- Elapsed time, task start times and completion outputs are computed from server
  data; client-supplied timing is ignored unless `ALLOW_CLIENT_START_TIME=true` (SEC-05).
- Subtasks are returned with the task payload instead of one request per expanded task (PF-06).
- Sessions carry a token version and are invalidated on password change (SEC-06).
- Rich text is sanitised on write and on render, with a plain-text extractor for
  empty-content suppression (SEC-08, UX-02).
- Post-login redirects are validated against open-redirect tricks, and the proxy now
  preserves the requested path in `?next=` (UX-05, BG-04).
- Prisma provider inference fails fast on a `DB_PROVIDER` / `DATABASE_URL` mismatch (ST-03).
- bcrypt cost aligned to 12 across `scripts/hash-password.ts` and runtime hashing (SEC-10).
- README rewritten to describe the implementation rather than aspirational claims:
  real env vars (`SESSION_SECRET`, not `NEXTAUTH_SECRET`), the actual
  `GET /api/export` contract, real npm scripts, honest dark-mode / responsive /
  security posture, and a Known limitations section (BF-01, PM-03, BF-04).
- Nine unused `@tiptap/*` extension packages removed; `@tiptap/extension-link`,
  which the editor imports, is now declared explicitly.
- Reports read one clock: `src/lib/business-time.ts` (`startOfLocalDay`,
  `endOfLocalDay`, `localDayKey`, `parseLocalDayStart`, `localDayWindow`) is the only
  place a day boundary is computed, so the export window, the attendance day bounds and
  the day-group key are the same value. The old UTC `T00:00:00Z`/`T23:59:59.999Z`
  round-trip that shifted a non-UTC day by hours is gone, and
  `tests/unit/export-timezone.test.ts` proves the equivalence under UTC, Asia/Jakarta
  and America/Los_Angeles (FL-07).
- `/api/export` is now bounded and streamed: `MAX_EXPORT_ROWS = 5_000` (queried as
  `take: MAX+1`, answered with a clear 400 telling the caller to narrow the window) and
  the HTML fallback is emitted as a `ReadableStream` through `reportHtmlChunks` /
  `htmlStreamFromChunks`, byte-identical to the previous single string (PF-02).
- Export row types are derived from the Prisma selects with `satisfies`
  (`EXPORT_TASK_FIELDS`, `EXPORT_PROJECT_FIELDS`, `EXPORT_JOB_FIELDS`,
  `EXPORT_SUBTASK_FIELDS`, `FieldProvenance`), so a renamed column breaks the
  typecheck instead of silently blanking a report column (AR-05).
- `src/lib/prisma.ts` refuses to guess: the provider is resolved from
  `PRISMA_SCHEMA_PATH` -> `DB_PROVIDER` -> `DATABASE_URL` scheme and any contradiction
  throws before an adapter is constructed, with a message that quotes `file:` URLs but
  never a password, user or host (ST-03).
- Nested agent scratch directories are excluded from git, ESLint and typecheck
  (`.gitignore /.qoder/`, `eslint.config.mjs` globalIgnores), so a stale worktree copy
  can no longer be linted, built or committed by accident.
- `vitest.config.ts` gives the bcrypt suites real headroom (`testTimeout: 15_000`,
  `hookTimeout: 60_000`) instead of cheapening the hashing: `bcryptjs` is pure JS at
  cost 12 and a rate-limit test performs up to six of those comparisons while every
  test file runs in a parallel worker.

- `.env.example` is now tracked (`!.env.example` in `.gitignore`) and completed: it
  documents `DB_PROVIDER`, `DATABASE_URL_SQLITE` / `DATABASE_URL_POSTGRES`,
  `PRISMA_SCHEMA_PATH`, `DB_QUERY_TIMEOUT_MS` and the backup CLI paths, and its
  `APP_PASSWORD` is empty instead of a demo password - a template that ships a usable
  credential is the same forgeable default the audit removed from `docker-compose.yml`
  (PM-01, AI-01: a fresh clone can now `cp .env.example .env`).

### Fixed
- The CI advisory step measured the same tree twice. The quality job exports
  `NODE_ENV=production`, and `npm audit` hides dev dependencies in that mode, so
  the line labelled "full tree (dev tooling included)" printed the runtime count
  again — a reporting bug in the step whose whole purpose is honest measurement
  (found while regenerating the verification log, SEC-01). It now asks for
  `npm audit --include=dev`, which reports 44 advisories against the runtime
  tree's 32.
- Board/queue rendering, dialog focus handling, form validation, empty/error states
  and duplicate element ids across the task board, job pages and settings (BG-01,
  BG-02, UI-01, UI-02, UI-05, UI-07, UI-09, UX-01, UX-04, UX-07, UX-08).
- `on_hold` was missing from the stats buckets, so the dashboard disagreed with the
  board (UX-08).
- PDF export inside the container. The AGENTS.md docker gate found that Alpine
  Chromium has no usable GPU/EGL in the image and only 64 MB of `/dev/shm`, so
  `page.setContent` died with `ProtocolError: Network.enable timed out` and every
  containerised export silently degraded to the HTML fallback.
  `buildPuppeteerLaunchOptions` now always passes `--disable-gpu` and
  `--disable-dev-shm-usage` next to the sandbox flags, pinned by
  `tests/unit/export-pdf-render.test.ts` and `tests/integration/export.test.ts` (AR-06).
- Duplicate break records: `POST /api/breaks/log` derives a deterministic
  idempotency key and answers a replay with `Break-Deduplicated: true` instead of
  inserting a second row (FL-01).
- `docker-compose.yml` was unparseable YAML. Removing the forgeable demo secrets
  put `${VAR:?message with ": " inside}` into an unquoted scalar, which is a
  mapping-error, so `docker compose config`/`up` failed on the dev file - and it
  had failed for the whole campaign because nothing parsed it. The values are now
  quoted and CI runs `docker compose config -q` against both files plus asserts
  the required-secret guard still refuses an empty environment (AR-08).
- The CI pipeline could not have passed, and only failed once it actually ran.
  The quality job sets `NODE_ENV: production`, so `npm ci` skipped every
  devDependency - `tsx`, `vitest`, `eslint`, `typescript`, `@playwright/test`,
  `tailwindcss` - and `npm run docs:openapi:check` died with `sh: 1: tsx: not found`
  (MF-01). Install is now `npm ci --include=dev`, so a production `NODE_ENV` cannot
  hollow out the toolchain again.
- `src/lib/prisma.ts` rebuilt the database client on every property access in
  production. The lazy `Proxy` memoised only on `globalThis`, and `globalThis` is
  deliberately populated outside production, so with `NODE_ENV=production`
  `resolveClient()` found no cache each time: every `prisma.*` call constructed a new
  `PrismaClient` plus a new driver adapter and connection pool, none of them ever
  disconnected. The client is now also memoised in module scope, and
  `tests/unit/prisma-provider-mismatch.test.ts` counts adapter constructions under
  production to keep it that way (ST-03 / PF-01; found by running the suite under
  CI's environment rather than a developer's).
- Two tests encoded host-environment assumptions instead of behaviour: one pinned the
  literal `"0.1.0"` from `package.json` (it broke on the 0.2.0 bump) and one read
  `globalThis.prisma`, which production does not set. Both now assert against the
  source of truth, and nothing in the suite may hardcode a version string.
- `docs/security.md` section 7 listed four gaps that had already been closed —
  idempotency was in fact wired into seven route files, `/api/tokens` and
  `/api/admin/events` are in the generated contract (21 paths), and the
  Bearer-forwarding note no longer matched the routes. A stale "known gap" is
  worse than a gap, because it tells the next reader not to look. The section now
  lists only what is still open, with the one deliberate cookie-only route
  (`/api/auth/logout`) explained rather than apologised for, and each closed item
  is stated as closed and gated. (PM-02, found by re-reading the docs against the
  tree during the 2026-10-09 re-audit.)
- `README.md` contradicted `package.json` in two directions at once: the Scripts
  section said `db:backup` / `db:restore` were "not present" (they exist, added by
  the MF-06 tooling) while its table omitted them, and the Configuration table —
  which claims to list every variable the tree reads, verified by a
  `process.env.` grep — was missing `DB_QUERY_TIMEOUT_MS`, `GID_BACKUP_DIR`,
  `PG_DUMP_PATH` and `PSQL_PATH`. The backup variables are invisible to that grep
  because the scripts read an injected `env` object; the table now says so
  explicitly. `PG_RESTORE_PATH` was *not* added: nothing calls `pg_restore`, so
  the name was dropped from `.env.example` rather than documented as a knob that
  does nothing (PM-03, README claims must be re-verifiable by `grep` at review
  time).
