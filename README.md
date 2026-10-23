# Independence Wizard

A four-step page that answers one question for an audit firm: **if we take this non-audit engagement for this client, does the firm's audit independence rule restrict it?**

It reads a client's corporate family from the Intapp host, finds where the firm already audits companies in that family, applies the independence rule that governs each of those audit relationships, and gives a single decision for the engagement, with the reason.

It is a single self-contained HTML page. The Intapp host supplies the data; the page does the thinking and the display.

---

## The four steps

### 1. Enter New Engagement
Pick the client (a party search) and the service line of the engagement, for example **Tax - Corporate Planning (TAX-110)**. Service lines read in full, section first, with the value after them. The service line matters because some rules exempt some service lines.

### 2. Find Entity & Tree
Shows what was found, on one screen, without scrolling on a typical laptop:

- **The party**: name, Intapp party ID, Moody's BvD ID, and three firmographics: Country, Listings, Industry.
- **The tree**: who ultimately owns the client, how many entities are in the tree, how many levels sit below the ultimate owner, and how many subsidiaries the client has.
- **Audit relationships in the tree** and **Non-audit relationships in the tree**: every company in the family the firm has engagements with, each with its relationship to the client (Indirect Parent, Cousin, This entity, and so on).
- **Notes** along the bottom: where the entity rule comes from, and anything the page could not determine.

If no engagements are found (or the engagement group does not exist), the page says so and lets you continue. Audit relationships and rules can be picked by hand on the next step.

### 3. Rule Inheritance
The working screen. See [The rule inheritance screen](#the-rule-inheritance-screen).

### 4. Independence Assessment
The decision. A banner gives the single strictest result and why, and an animation underneath shows the rule travelling down the corporate structure to the client. See [The assessment](#the-assessment).

---

## Where the data comes from

| What | From |
|---|---|
| The client, its corporate tree and its close affiliates | The party record's corporate family |
| Which companies the firm audits or advises | The engagement group named for the tree's ultimate owner: its party, client and matter records |
| Country, listing, industry | A JSON note on each party, copied from Moody's Orbis, found by the party's **Intapp party ID** (never the tree or provider ID) |
| The rules | The embedded rule configuration, kept in `independence-config.json` |

If any of these is missing the page says what and why, in plain words, rather than failing quietly. For example: "Firmographics unavailable for Target LLC: the party has no notes."

---

## The business logic

### Relationships

Every company is described by how it relates to another company.

- **Tree relationships** come from the corporate tree: Ultimate Parent, Immediate Parent, Indirect Parent, Immediate Subsidiary, Indirect Subsidiary, Sibling, Cousin.
- **Significant influence ("SigInf") relationships** come from the close-affiliate hierarchy (holdings of roughly 20-50%): SigInf - Ultimate Parent, SigInf - Immediate Subsidiary, SigInf - Sibling, and so on, the same seven kinds. In the data these are the close affiliates (CA); on screen they are called SigInf.
- An entity is **SI-only** when its only relationships to the client are SigInf ones. These are the companies the Significant Influence grid exists for.

Relationships are measured from a chosen company: the client's relationships to everyone, and, for the rules, everyone's relationship to each audit relationship.

When a company is both, for example Sibling and SigInf - Sibling, the screen lists only the tree one. A company that is SigInf - Immediate Parent and also a Sibling shows both. The underlying data always keeps every classification.

### Audit and non-audit relationships

These come from matter names in the engagement group.

- A matter is **audit** if its name has the word "audit" once "non-audit" is set aside. Anything else is **non-audit**.
- An audit matter can name its framework in a suffix, for example `[Audit - SEC]`. That suffix is the stated basis.
- A company with audit matters is an **audit relationship**; one with non-audit matters is a **non-audit relationship**; it can be both. Companies with no matters are neither.

### Which independence rule governs an audit relationship

The rule that applies is the **strictest** of two things:

1. The framework named in its matters (`[Audit - X]`).
2. The **entity rule**, worked out from the company's Orbis data:
   - Listed on a US exchange: **SEC/PCAOB**.
   - Listed on an EU, EEA or UK exchange: **EU**.
   - Listed elsewhere, or listed with no exchange: **IESBA (PIE)**.
   - Industry codes that mark a credit institution or insurer: **IESBA (PIE)**.
   - Otherwise by country: US is **AICPA**, UK is **UK**, EU member states are **EU**, everywhere else is **IESBA**.
   - If several apply, the strictest.

Strictness runs: SEC/PCAOB, then EU, then UK, then IESBA (PIE), then IESBA, then AICPA. A non-audit relationship carries no audit rule.

### The rules

Six jurisdiction rules are configured. Each says, for a relationship measured from an audit relationship, what treatment it gets. (Relationships not listed are out of scope for that rule.)

| Rule | Restricted | Materiality check |
|---|---|---|
| **SEC** | Immediate subsidiary; indirect subsidiary (exempt for TAX service lines) | Immediate parent; SigInf immediate subsidiary; sibling (exempt for TAX service lines) |
| **AICPA** | Immediate subsidiary (exempt for TAX-110 and ADV-202) | Indirect subsidiary (exempt for TAX-110 and ADV-202) |
| **IESBA (PIE)** | Immediate and indirect subsidiary; SigInf immediate and indirect subsidiary | Sibling; SigInf sibling |
| **IESBA** | Immediate subsidiary | Indirect subsidiary; SigInf immediate subsidiary |
| **EU** | Immediate subsidiary | Indirect subsidiary |
| **UK** | Immediate subsidiary | None configured |

Several entries are marked "not confirmed" in the configuration (for example AICPA parent treatment and IESBA significant influence); those are working assumptions, noted in each rule's source line.

### Treatments

- **Restricted**: the engagement cannot be accepted.
- **Materiality check**: no automatic restriction, but a materiality check is needed before accepting.
- **Exempt Service Line**: not a third treatment but a flag. The relationship still gets its treatment (say, Restricted), but the engagement's service line is exempt under that rule, so it has no effect. Only the client has a service line; every other entity is never exempt.

### Picking the one result that matters

The client can be touched by several audit relationships at once. The page always reduces this to **one strictest result**:

1. Results that are not exempt beat results that are exempt.
2. Among those, Restricted beats Materiality check.
3. If two results are equally strict, the audit relationship **highest up the corporate tree** is chosen. One outside the tree ranks last.

The chosen result is the one shown everywhere. The others are kept and available behind a grey **Other (n)** pill.

### Audit relationships on the rule inheritance step

On step 3 an **audit relationship is a row you switch on** in Apply Audit Rules. The rows start from the engagements found in step 2, one per audit relationship with its rule. You can then change them:

- **Uncheck** a row: that company stops being an audit relationship in this view. Its shield disappears and it drops out of the filtered tree (it stays if it is a parent of something shown).
- **Add** a row and choose a company: it becomes an audit relationship straight away, even if no engagement was found for it. Choosing a rule for it makes that rule apply.
- **Change the rule** on a row: the new rule applies to that company.
- **Remove** a row: the same as unchecking.

Picking a company by hand means "treat this as an audit relationship in this jurisdiction".

---

## The rule inheritance screen

### Apply Audit Rules (top)
One row per audit relationship: a checkbox, the company, and a choice of the six rules. A summary on the right counts how many entities are restricted or need a materiality check.

### Display Options (collapsed by default)
One choice, three views:

| View | What it shows |
|---|---|
| **Target only / Strictest rule** (the default) | The filtered tree: only the client, the audit and non-audit relationships, and their parents. The client shows its one strictest result, and the audit relationship it comes from is marked **Inherited from**. |
| **Target only / All rules** | The same filtered tree. The client shows its strictest result plus a grey **Other (n)** pill for its other results. Every other audit relationship those results come from gets a grey **Inherited from** pill (click it to see that result). The strictest source keeps its coloured pill. |
| **All entities / All rules** | The full tree. Every entity shows its own strictest result, with an **Other (n)** pill where it has more. |

When the tree is filtered, what was left out is shown as a quiet tag under its parent: **Filtered: 44 subsidiaries**.

### The grids
There are two, one above the other, and the page scrolls as a whole.

- **Corporate Tree (50%)**: the corporate tree, with the client's pin next to its name. Rows connect to their parents with connector lines.
- **Significant Influence (20-50%)**: the close-affiliate hierarchy cut down to the client and the SI-only companies, each under its full chain of parents (up through the corporate tree where the two overlap). Anything that is just a repeat of the corporate tree is left out. It is shown only when there are SI companies.

Columns:
- **Left**: a shield with the rule for an audit relationship, a handshake ring for a non-audit relationship.
- **Name**: connector lines, an open/close arrow, the pin if it is the client, the name and the ID. A row whose only child is a "Filtered" tag starts closed.
- **Audit Rule Treatment**: the pills below.

### Pills
- **SEC - Restricted** (red) or **SEC - Materiality check** (orange): the strictest result on that entity, with the audit rule that gave it. Click it to see which relationship it came from.
- **Exempt Service Line** (green), beside it when the client's service line is exempt under that rule. The treatment stays visible.
- **Inherited from**: coloured, it marks the audit relationship the client's strictest result comes from. Grey, it marks another audit relationship the client inherits from (the *Target only / All rules* view).
- **Other (n)** (grey): the other results behind the strictest one.
- Rows are shaded red or orange by their treatment, even when the service line is exempt.

---

## The assessment

A banner shows **the one strictest result**: the treatment, the audit rule, and a sentence saying how the client relates to which audit relationship and what the rule does with it. For an exempt service line it also says the service line is exempt.

- **Restricted**: red banner.
- **Materiality check needed**: orange banner.
- **Exempt Service Line**: the banner stays **green**, but it still names the treatment ("Restricted" then "Exempt Service Line" by SEC), so the reader can see what would have applied.
- **No restriction identified**: green.
- **No audit rules to apply / applied**: when no audit relationship has a usable rule, or every one is switched off.

Under the banner an animation shows the audit relationship's rule travelling down the tree and arriving at the client, with a Replay button. Notes list anything unusual: the client being an audit relationship itself, rows switched off, relationships with no rule, and how each rule read each relationship, including the service line.

The assessment applies the audit rules to **corporate relationships only**. It does not consider the specific services requested.

A downloadable JSON record of the check exists in the page (who, what engagement, the decision, the tree, how the rules were applied). Its button is currently off the page.

---

## Wording used on screen

| We say | Meaning |
|---|---|
| Audit relationship / Non-audit relationship | A company the firm audits / advises (was "client") |
| SigInf | A significant influence relationship (close affiliate in the data) |
| Filtered: N subsidiaries | Subsidiaries left out of the filtered tree |
| Audit Rule Treatment | The result an audit rule gives an entity |
| Inherited from | The audit relationship the client's result comes from |
| Exempt Service Line | The client's service line is exempt from that treatment |
| Corporate Tree (50%) / Significant Influence (20-50%) | The two grids |

---

## What the page does when something is missing

| Situation | What happens |
|---|---|
| No engagement group, or no engagements in it | Says "No engagements were found for this corporate tree" and continues; pick audit relationships by hand on the next step |
| A party lookup fails | The firmographics show "Not available", with the reason underneath |
| The party has no Orbis note, or the note is under a different key | Same, with that reason |
| An audit relationship has no Orbis note | Its entity rule is "unknown"; a note says so |
| The client has no close affiliates | There is no Significant Influence grid |
| No audit relationship has a rule | The assessment says no audit rules apply |

---

## Files

| File | What it is |
|---|---|
| `independence-wizard.html` | The page. **This is the file to edit.** |
| `independence-wizard.min.html` | The same page, minified, **generated** from the file above. Never edit it by hand. It carries a short build stamp in the header so a published copy can be told apart. |
| `independence-config.json` | The rules, relationships, treatments and service lines. The page embeds a copy of it. |
| `corporate-tree.html`, `engagement-tree.html` | Earlier single-purpose pages (the corporate tree, and the audit rule engagement tree) that the wizard was built from. |
| `wizard-progress-preview.html` | A preview of the step progress bar. |
| `code-block-1 (2).html` | An early corporate-tree viewer. |
| `build.mjs` | Builds the min file; `--check` fails if the min file is stale. |
| `tests/` | Browser tests against a fake host. |

### Changing the page

1. Edit `independence-wizard.html` (and `independence-config.json` if a rule changes; keep the two in step).
2. `npm run build` to regenerate the min file.
3. `npm test` to run the tests against both files. It also fails if the min file is out of date.

First time only: `npm install`, then `npx playwright install chromium` (or point `CHROMIUM_PATH` at an installed Chromium).

### What the tests cover
Built against a fake host with made-up companies, run once for the source and once for the min file:
the three display views, the strictest result and the Other pill, tie-breaking, the exempt service line, audit rows changing the filter, the Significant Influence grid (five different shapes of affiliate data), the SigInf de-duplication, firmographics from notes (including non-breaking spaces), the party-ID-only lookup, every "why it is missing" message, the no-engagements path, the Find step fitting a laptop screen, and the wording.
