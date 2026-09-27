# Module: reports

**Responsibility** — frozen, permissioned report snapshots: feasibility
summary, monthly cashflow, cost and commitment register, invoice status
register, funding schedule, scenario comparison and investor distribution
(RPT01–RPT04).

**Key rules**
- **One run per report.** A report is built from the same calculation run the
  grid shows, and stores its tables and CSV. Regenerating from an unchanged
  model produces the same `dataHash` (RPT03, AT17).
- **Numbers stay numbers.** Amounts are plain decimals with a currency column;
  typed text starting with `= + - @` gets an apostrophe (RPT02, SEC02).
- **Every file says what it is.** Project, scenario, model revision, engine
  version, actuals cutoff, generation time and tax basis head every CSV and
  print view.
- **Sensitive by request only.** Supplier and buyer names are withheld unless
  someone with sales, finance or payment authority includes them.
- **Investors see themselves (EQ03).** A membership without financial read
  may only generate the investor report, and it contains their participant
  only; other people's reports are not found.
- **Jobs and retries.** queued → running → completed / failed; a retry is a
  new job pointing at the failed one; nothing overwrites a successful report.
- **Downloads expire.** A link is HMAC-signed for one person and 15 minutes,
  and access is rechecked at download time (`REPORT_LINK_SECRET`, otherwise a
  per-process random secret).
- **Comments append (RPT04)** without touching figures; attachment *names* are
  recorded because files are not stored in this build.

**Not in this build** — PDF and XLSX (R2), scheduled email distribution (R3),
a background worker (generation runs in the request).
