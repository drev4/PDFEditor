# Archive

Superseded documents, kept because they record what was believed at the time. **Nothing here is current.** Do not cite these as the state of the system, and do not update them — fix the [Source of Truth](../sot/README.md) instead.

| Document | Superseded by | Why it was retired |
|---|---|---|
| `TECHNICAL_SPECS.md` (2024-12-27) | [02-architecture](../sot/02-architecture.md), [03-domain-model](../sot/03-domain-model.md) | Specified Supabase as the backend. That was abandoned — the real backend is Express + Prisma with its own JWT auth |
| `API_DOCUMENTATION.md` | [06-api-reference](../sot/06-api-reference.md) | Documented three field endpoints that never existed in any version of the backend (`GET .../fields`, `PUT .../fields/bulk`, `DELETE .../fields/bulk`) |
| `database-schema.md` | [03-domain-model](../sot/03-domain-model.md) | Duplicated the schema without the cascade semantics or the invariants, and drifted |
| `pdf-upload-guide.md` | [02-architecture](../sot/02-architecture.md), [06-api-reference](../sot/06-api-reference.md) | Internal description of the upload path, now covered with the security caveats included |

The `API_DOCUMENTATION.md` case is the reason the `api-contract-guard` skill exists: it was written once from intent rather than from code, and nothing ever checked it again.
