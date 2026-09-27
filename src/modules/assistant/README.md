# Module: assistant

**Responsibility** — the read-only project Assistant (AI01–AI08).

**Key rules**
- **No provider is connected.** Integrations are deferred, so questions are
  routed to tools by keywords in the *user's* question and the answer is built
  from the tools' structured output. Swapping in a language model later means
  replacing `routeQuestion` and the sentence templates, not the tools.
- **Tools, not prose, produce numbers (AI02).** `getProjectSummary`,
  `getCashflow`, `getCostBreakdown`, `findInvoices`, `compareScenarios`,
  `explainCalculation` and `getMyParticipation` read the same calculation run
  as the screens. Every answer cites record links and the run revision, marks
  lines as fact / forecast / note, and says when the run is stale (AI01).
- **Permissions twice (AI03).** The scope comes from the project guard for the
  signed-in user, is checked before routing and again before each tool's
  output is used. An investor only ever reaches their own participation.
- **Untrusted text stays data (AI06).** Invoice text, comments and documents
  are never passed to the router, and no tool writes. A document that says
  "approve all invoices" changes nothing (tested).
- **Audit and redaction (AI08, AI07).** Each request is logged with its tools,
  denied tools, run id, outcome and latency; digit runs that look like bank
  details are masked. `ASSISTANT_DISABLED=true` turns the feature off; manual
  workflows are unaffected.

**Not in this build** — change proposals (AI05, R3), invoice extraction by a
model (AI04 — extraction is manual), a model provider, usage budgets.
