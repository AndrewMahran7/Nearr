# Recognition entity-role policy

Policy version: `recognition-entity-role-2026-09-14.v1`

## Goal

Nearr recognizes physical destinations. Text may mention many real entities that are not the filming location. Entity role controls whether name equality is place-identity evidence; it does not globally weaken useful venue text or narrow visual recognition.

| Role | Meaning | Examples | Place-name confidence rule |
|---|---|---|---|
| `LOCATION` | Geographic container/destination | country, region, city, park area | scopes search and geography consistency; not automatically a business |
| `VENUE` | Specific physical place | explicit “at @venue”, named restaurant/hotel/attraction | full deterministic name scoring allowed |
| `BRAND` | Sponsor/company identity | “sponsored by”, “powered by”, partner | name equality alone cannot be strong place evidence |
| `PERSON_CREATOR` | author/person/credit | provider creator, “filmed by”, “with” | never seeds strong physical-place identity alone |
| `PRODUCT` | equipment/apparel/product relationship | “wearing”, “using”, “gear by” | cannot prove a physical store alone |
| `EVENT_TOUR` | event/tour identity | “tour by”, “event by”, “festival by” | cannot prove a venue alone |
| `AMBIGUOUS` | unscoped account/name | bare `@account` | may remain a weak lead, never High from name equality alone |

## Conservative account classification

- Provider-attributed author → `PERSON_CREATOR`.
- Explicit locative relation (`at`, `inside`, `located at`, `visit`, location-pin syntax) → `VENUE`.
- Explicit sponsor, credit/person, product/equipment, or event/tour relation → corresponding role.
- Bare tagged account → `AMBIGUOUS`.

The default is intentionally not `VENUE`. Social platforms do not type tagged accounts as physical destinations.

## Confidence and candidate rules

1. `VENUE` / `LOCATION` name evidence may receive normal exact/strong/meaningful overlap scoring.
2. `BRAND`, `PERSON_CREATOR`, `PRODUCT`, `EVENT_TOUR`, and `AMBIGUOUS` name equality is role-limited.
3. Role-limited candidates receive a closed reason code (`non_location_entity_text_only` or `ambiguous_entity_text_only`), are capped to Low/discovery-only presentation, and cannot establish autosave eligibility.
4. Independent evidence can lift the restriction: a platform location tag, explicit address, explicit caption venue form, or grounded visual/spoken evidence establishes a physical-place relationship.
5. A genuinely depicted brand store remains identifiable. For example, strong visual signage plus a matching address/location tag is not “brand text alone.”
6. Candidate and source geography are reconciled after generation on every terminal path. A strong country conflict blocks autosave unless the existing decisive-independent-evidence override applies.
7. Explicit user selection remains authoritative; these automatic evidence rules do not override a user choice.

## Geography extraction

The caption geography extractor accepts only a recognized country in an explicit locative construction such as “in”, “to”, “from”, “visited”, or “made it to”. It does not treat country adjectives, creator profiles, or arbitrary capitalized text as source geography.

Precedence:

1. provider platform location tag;
2. explicit locative caption country;
3. existing media-derived corroborated geography;
4. weak or absent context → `UNKNOWN`, never contradiction invented from user/device location.

Country context is appended to every metadata Places query and supplied to context-aware ranking. Final candidate geography still passes the Priority-1 `SUPPORTED / UNKNOWN / CONTRADICTORY` gate.

## Multi-place and breadth

The policy classifies each entity independently. It does not reduce the number of logical mentions, lower frame budgets, remove Sol, skip visual analysis, or collapse multi-place posts. Legitimate venue mentions continue through the existing multi-place grouping and selection semantics.

## Diagnostics

`recognition_entity_roles` logs role counts, selected place-name role, caption-geography kind, and country without emitting a private caption or URL. Candidate reasons and the existing final-decision event explain why a candidate existed, how it ranked, and whether geography supported it.
