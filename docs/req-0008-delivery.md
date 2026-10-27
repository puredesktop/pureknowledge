# req-0008 delivery evidence

Implemented optional manual Draft / Current / Retired guidance, explicit check
records, replacement identity/navigation, matching search/agent metadata and
status filters. Existing page files, store mutations, activity, agent log,
operations ledger and navigation remain the underlying paths. No migrations
assign status or reviews to legacy pages.

## Checked source

Base commit (full SHA): `9cf46e3eacdb1175f0857e016ce60cd43be6394e`.
This is the pre-change base, **not** a delivered feature commit. The task
explicitly prohibits this agent from committing, pushing or opening a PR.
PureDev owns the final commit and CTO delivery. Final committed-head verification
and its full SHA remain a required PureDev delivery step; they are not claimed
as completed here.

All 50 source/test/config/entry files in the temporary check layout were
byte-compared with this worktree after the final checks. Aggregate SHA-256
(path + NUL + bytes + NUL, sorted by path):
`1145a888bf0c18bd63913f497440e87d2e942c02411580437b674ff3d3949793`.

## Exact commands and results

The standalone worktree has no installed dependencies or suite-relative parent
configuration. Checks ran from
`/private/tmp/pureknowledge-req0008-check/apps/pureknowledge`, using an exact
copy of this app's source/tests/configuration and symlinks to the configured
suite's existing packages, scripts, base TypeScript configuration and installed
dependencies under `/Users/adamhyde/.puredev/purescience/suite`. App Vite and its
plugin came from that suite's installed PureKnowledge dependencies. No real user
knowledge store or app window was used.

| Command | Result |
| --- | --- |
| `npm run typecheck` | Exit 0; TypeScript clean. |
| `npm run test` | Exit 0; 17 files, 156 tests passed. |
| `npm run build` | Exit 0; Vite 6.4.4, 7701 modules transformed, built in 10.83s. |
| `git diff --check` (original worktree) | Exit 0. |

Non-failing output: existing KaTeX quirks-mode notices, a disabled remote iframe
in the video fixture, an intentionally missing image fixture, and Vite's large
chunk advisory. No browser, desktop, app window or screenshots were used.

## Acceptance coverage

- `src/lib/knowledgeGuidance.test.ts`: serialized page/reload fixtures, legacy
  fields and identity, unchanged checks through independent mutations, invalid
  statuses/dates and missing/self/disallowed targets, search IDs/labels/filter
  groups and nonmatching Current exclusion.
- `src/hooks/useKnowledgeWorkspace.test.tsx`: actual workspace save/reopen through
  the existing mocked file bridge retains guidance, checks, a selected existing
  replacement ID, body and original page identity.
- `src/App.test.tsx`: real custom-menu controls, explicit review date/attribution,
  invalid date rejection, content Done/save preservation, status clearing,
  actual sidebar search/filter results and retired-page selection, stale
  replacement rejection without a success ledger entry, duplicate-title
  replacement disambiguation by ID, existing rendered identity-link navigation
  to retired content, replacement
  navigation and unavailable target with an unrelated same-title page.
- `src/hooks/useKnowledgeAgentTools.test.tsx`: registered context/page/search
  handlers match rendered metadata and each reachable status filter, under the
  same space scope, without writes from reads/searches.
- `src/agents/handlers.test.ts`: content and metadata actions preserve a human
  check until an explicit agent check; agent attribution, invalid action input
  atomicity and existing before/after audit log.

## Defaults used

Human checks use the app's existing human actor convention, “You”; agent checks
record an agent actor and name. Human date selection is stored at UTC midnight
and displayed in UTC. Replacement targets may use any existing space in the
bound notebook, matching its existing access/navigation model. Targets outside
that notebook, missing space memberships and self-references are rejected.

For committed-head CTO review, PureDev must run the three npm checks and
`git diff --check` on its final commit, confirm the source/tests are clean and
match that head, and append `git rev-parse HEAD` plus exact results to its normal
delivery record. No merge was performed.

## Working-tree review follow-up

Reviewed the full tracked diff and all new files. Fixed narrow-sidebar layout
for the filter, distinguished duplicate replacement titles by stable ID, and
revalidated guidance actions against current state before recording success in
the ledger. A vanished target now produces a local error and leaves saved data
and the success ledger untouched. Added actual sidebar integration coverage,
explicit second-review coverage and a real selected-replacement save/reopen
fixture. Re-ran all commands above on the byte-matched revised source. The
final committed-head step remains owned by PureDev; this review made no commit.

## Executable final-head verification

After PureDev creates the delivery commit, run from this repository:

```sh
npm run verify:delivery -- --suite /Users/adamhyde/.puredev/purescience/suite
```

In a correctly mounted suite app, `npm run verify:delivery` also works without
`--suite`. The command refuses uncommitted or untracked files before creating
any success evidence. It captures the full HEAD and tree SHAs, runs typecheck,
the complete test suite, build and the diff check, then checks that the original
HEAD and clean worktree still match before and after each command. With
`--suite`, it builds a temporary dependency layout from `git archive` of that
exact commit. It writes a JSON delivery record and full per-command logs outside
the repository, so recording evidence does not dirty the verified commit.
PureDev should attach the emitted delivery record and logs to CTO review.
Failures are recorded as `verified: false`, never as a passing delivery.

This command was also run against the current dirty worktree: exit 1 with
“Commit all delivery source and tests through PureDev before verifying HEAD.”
This is the intended refusal; no delivered-head success record exists yet.

Verifier regression tests cover clean-head acceptance, dirty/staged/untracked
rejection, full-SHA identity checks, immutable archive selection, successful
command/log/record generation, failed-build recording and a head change during
checks. These tests use subprocess fixtures; they do not create any commit.
The complete 156-test suite, typecheck, production build, script syntax check
(`node --check scripts/verify-delivery.mjs`) and diff check pass on the final
working-tree snapshot. This is not a substitute for executing the new verifier
after PureDev's commit.
