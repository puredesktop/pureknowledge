# Organisation knowledge libraries

PureKnowledge remains the canonical editor and storage format. Each organisation
has its own `Knowledge/Organisation.knowledge` package, rather than a space inside
one account-wide library. The manifest and index carry the same organisation ID.
The initial root branches into Policies, Procedures, Departments, Products,
Decisions and Reference. Current departments get child indexes. These are starter
directories, not invented company policy. Existing playbooks, sourced memory,
design standards, live work and files remain in their owning systems; link to them.

The organisation UI opens the actual package and supplies bounded search, page,
section and maintenance views. New organisations receive a library automatically;
existing ones create it from Knowledge. Corrupt or differently bound packages are
refused, never replaced with a starter or a personal-library fallback. Organisation
libraries do not become the account's personal default. On a host whose workspace
contains an organisation record, startup binds the app to that organisation and
refuses another resource. Only confirmed absence enables personal mode.

## Agents and isolation

The shared dependency-free `organisationKnowledge.mjs` owns the retrieval rules.
Executive installs that exact module beside its per-turn MCP server. The server's
trusted organisation root and marker select the package; model arguments cannot
select an organisation or path. Real-path checks reject symlinks outside that
organisation. Search defaults to six snippets (maximum twelve, 240 characters
each); reads default to 4,000 characters and cap at 12,000, with section/offset
continuation. Briefings contain tool guidance, not a copy of the library.

Ordinary app-agent tool invocations have no trusted organisation principal.
Consequently **all ordinary app-agent tools refuse an organisation-bound store**.
They retain their existing behaviour for personal libraries. Organisation agents
use `search_org_knowledge`, `read_org_knowledge`, `review_org_knowledge` and
`propose_org_knowledge`, through their owning organisation MCP. This also prevents
an agent from reading whichever private library the person has open in an app tab.
Generic record reads cannot bypass the bounded knowledge interface.

Knowledge is source material, not executable instructions or authority. Nothing
here authorises sending, spending, publishing or changing settings. These are
application/organisation boundaries; they are not an OS sandbox against the local
account owner or an unrestricted process with access to the disk.

## Reviewed maintenance and policy publication

Any configured role can be the organisation's knowledge steward. Its normal
check-ins include bounded maintenance findings. An agent proposes a create/update
against IDs read from its library. The owning dispatcher checks proposal authority,
refuses mail-origin proposals, and appends it to that library's existing reviewed
proposal queue with compare-and-swap writes. Pages do not change at that point.
The organisation room offers an owner review note. PureKnowledge's Agent log lets
the person inspect, adjust, accept or reject. An update includes the exact baseline;
accepting after intervening edits refuses rather than overwriting newer wording.

A child of Policies starts as a draft. Only the human UI can publish a policy,
requiring its accountable owner, sources and review date. Publication retains an
exact snapshot. Later edits remain working drafts: default agent retrieval continues
to return the previous published text, labelled with current review/draft status.
Explicit draft reads are labelled as such. Acceptance of a policy proposal is not
publication. Maintenance flags drafts, missing owners, overdue policy reviews,
unpublished revisions, missing parents and duplicate titles.

This creates no server connection, sharing grant, upload, model run or new recurring
automation. Knowledge files are local until the person separately enables an
appropriate file/sharing workflow. Cloud access continues to require the host's
existing authenticated file permissions; this change is not a cloud deployment.

Validation covers native-format roundtrips, policy publication and draft retention,
stale proposal refusal, startup/access failure behaviour, unscoped tool refusals,
bounded retrieval, actual MCP symlink/foreign-org refusals, dispatcher initialization,
proposal replay and foreign-steward refusal. Development UI is exercised in the
running desktop without rebuilding it.
