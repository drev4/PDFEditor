# Product and market

## What the product is

**DocAIFlow** turns a PDF into a fillable online form and collects structured answers from it.

The user uploads a PDF, places interactive fields on the page with a canvas editor (text, textarea, checkbox, radio, dropdown), publishes it behind a public link that needs no login, and collects responses that can be read in a dashboard or exported to CSV.

Two entry paths are already supported in code, and the second one is the differentiator:

- **A blank or flat PDF** — the user draws the fields by hand on the canvas. This is the obvious path and every competitor has it.
- **A PDF that is already an AcroForm** — a native PDF form, such as one exported from Adobe or downloaded from a government or insurance portal. On upload the backend reads its existing field definitions (`pdf-processor.ts::extractFieldsFromPDF`) and loads them into the editor ready to publish. The user does not redraw anything.

That second path is the sharpest wedge the product has. The people with the most painful version of this problem — HR, insurance brokers, clinics, public-sector suppliers, accountants — do not have blank PDFs. They have a mandatory, externally-defined PDF form they are not allowed to redesign, and they are currently emailing it, printing it, or paying someone to retype it. The product's promise to them is: *keep your exact PDF, get a web form and a spreadsheet out of it.*

On save, fields are also written back into the physical PDF as an AcroForm, so the artifact the customer keeps remains a real fillable PDF rather than only a web form. That matters where the PDF itself is the record of truth.

## Who buys it

The product must serve two motions from one codebase. The architecture decisions in [10-saas-roadmap.md](./10-saas-roadmap.md) exist specifically so that serving both does not mean forking the model later.

| | B2C / prosumer | B2B |
|---|---|---|
| Buyer | An individual: freelancer, consultant, small association, single-site clinic | A team: HR, operations, customer support, compliance |
| Account unit | One user is the whole account | An organization with several members and roles |
| Trigger to buy | "I need to stop emailing this PDF back and forth this week" | "Our intake process is manual and we cannot audit it" |
| Price sensitivity | High — needs a free tier and a low entry price | Moderate — pays for seats plus volume |
| What they actually value | Time from upload to a working public link | Permissions, audit trail, own branding, integrations, data residency answers |
| What kills the deal | Any friction before the first published form | No security answers, no SSO story, no way to get data into their system |

The B2B buyer's blocking questions are almost entirely covered by [07-security-and-privacy.md](./07-security-and-privacy.md) and [08-operations.md](./08-operations.md), not by product features. Today the honest answer to most of them is "not yet", which is why those two documents rank ahead of new editor features in the backlog.

## Where it sits against alternatives

Not a competitive analysis, just the honest positioning that should shape what gets built:

- **General form builders** (Typeform, Google Forms, Tally) are better at building a form from nothing and worse at anything PDF-shaped. They cannot take a mandated PDF and give it back to you filled.
- **E-signature platforms** (DocuSign, Dropbox Sign) own the PDF-plus-signature workflow and are priced for it. They are heavy and expensive for "collect 200 intake forms a month with no signature requirement".
- **Enterprise form platforms** (Formstack, Jotform's PDF product) do cover this, at enterprise price and enterprise onboarding.

The gap being aimed at is the middle: PDF-native, self-serve, priced for a small team. Consequence for the roadmap: **the AcroForm round-trip is the feature to keep sharpening, and signature workflows are the feature to keep resisting** until a paying customer forces the question.

## Monetization hypothesis

Not yet decided, and nothing in the code implements any of it. Recorded here so the technical design in [10-saas-roadmap.md](./10-saas-roadmap.md) has a target to aim at.

The metering axis should be **responses collected and active published forms**, not seats. Two reasons: it tracks the actual cost driver (storage, database rows, export work), and it aligns price with the value the customer receives, which is answers. Seat-based pricing on a tool where most of an organization never logs in punishes the buyer for rolling it out.

Starting hypothesis for tiers:

| Tier | Shape | Purpose |
|---|---|---|
| Free | One published form, capped responses per month, "Made with DocAIFlow" on the public form | Acquisition, and the branding is the distribution channel |
| Pro | Unlimited forms, no branding, higher response cap, CSV export | The B2C conversion target |
| Team | Pro plus multiple members, roles, higher volume, API and webhooks | The B2B conversion target |

Removing the branding is a **plan entitlement, not a user setting** — that is what makes the free tier a distribution channel rather than free hosting.

## What not to build

Constraints on scope, deliberately recorded so they do not get quietly relitigated in a feature discussion:

- **Do not couple plan limits into domain code.** Limits are checked by a separate entitlements service, never inline in `routes/forms.ts`. When pricing changes — and it will, twice, before it settles — no domain route should need to be touched.
- **Do not treat "user" and "the thing that pays" as the same entity.** A B2C account should be an organization with exactly one member, created automatically at signup. Introducing this split now, with a handful of users, costs a migration; introducing it after a hundred paying accounts costs a rewrite.
- **Do not build granular per-resource RBAC** before a real customer asks. `owner / admin / member` covers every B2B conversation until someone is paying enough to have an opinion.
- **Do not add e-signature.** It is a different product, a different compliance surface, and a different price point.
- **Do not build custom public domains** (`forms.customer.com`) before validating demand. Per-tenant TLS and domain verification is weeks of work that generates no revenue on its own.
