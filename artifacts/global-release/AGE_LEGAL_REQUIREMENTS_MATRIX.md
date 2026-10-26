# Age and legal requirements matrix

Reviewed 25 October 2026. This is an engineering release matrix, not legal advice or an approval. A regional threshold only addresses one possible consent basis; it does not by itself establish contract capacity, provider permission, age assurance, payment permission, or compliance with child-safety rules. Every market remains disabled in `eligibility_region_policy` until the listed questions are resolved and evidence is recorded.

| Market | Source-backed minimum used by the code | Release treatment | Unresolved qualification work |
|---|---:|---|---|
| United States | 13 | 13+ declaration may pass the age screen; AI and purchases remain closed | Confirm general-audience treatment and state teen rules; validate neutral age screen, deletion/parent rights, and provider terms. COPPA applies to under-13 collection by child-directed services and operators with actual knowledge; Nearr has no verifiable parental-consent path. |
| United Kingdom | 13 | 13+ declaration may pass; market closed | Complete an Age Appropriate Design Code assessment for a service likely to be accessed by children, document lawful bases, profiling/geolocation defaults, DPIA and international transfers. |
| Spain | 14 | 14+ declaration may pass; market closed | Confirm the selected lawful bases and that consent-dependent processing follows Spain's 14 threshold; separately review contracts and purchases. |
| Italy | 14 | 14+ declaration may pass; market closed | Confirm child-readable notices, consent basis and contract/payment treatment. |
| France | 15 | 15+ declaration may pass; market closed | Below 15, French law requires joint child/parent authorization for consent-based information-society processing. Contract capacity remains separate. |
| Germany | 16 | 16+ declaration may pass; market closed | GDPR Article 8 default of 16 is used conservatively; confirm lawful basis, youth contract law and purchases. |
| South Korea | 14 | 14+ declaration may pass; market closed | Confirm PIPA legal-representative consent below 14, cross-border transfer notices, age verification and separate civil-contract rules. |
| Brazil | 18 pending review | Adults only at the declaration layer; market closed | LGPD Article 14 requires the child's/adolescent's best interests and specific, highlighted parental consent for children, with limited exceptions. A simple 13+ declaration is insufficient for launch qualification. |
| Japan | 18 pending review | Adults only; market closed | Confirm APPI notice/consent and cross-border transfer duties plus civil-contract treatment for minors. No universal self-consent threshold is asserted. |
| Mexico | 18 pending review | Adults only; market closed | Obtain local review of child consent, privacy notice, ARCO rights, transfers and minor contracts before enabling. |
| Other countries | unavailable | Blocked | Add a cited policy row and complete the same legal/provider/store review before launch. |

Primary sources: the [FTC COPPA compliance guidance](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions), [FTC 2025 COPPA Rule update](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data), [California Attorney General CCPA minors guidance](https://oag.ca.gov/privacy/ccpa), [GDPR Article 8](https://eur-lex.europa.eu/eli/reg/2016/679/oj), [UK ICO Children's Code](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/), [Spain AEPD](https://www.aepd.es/preguntas-frecuentes/10-menores-y-educacion/FAQ-1001-cual-es-la-edad-para-que-los-menores-puedan-prestar-consentimiento-para-tratar-sus-datos-personales), [France CNIL](https://www.cnil.fr/les-bases-legales/consentement), [Italy Garante](https://garanteprivacy.it/web/guest/temi/minori), [Brazil LGPD English text](https://www.gov.br/anpd/pt-br/documentos-e-publicacoes/lei_geral_de_protecao_de_dados_ingles.pdf), and [Apple's age-appropriate design guidance](https://developer.apple.com/kids/).

## Implemented boundary

Nearr collects an age band and country, not a birth date or identity document. Under 13 is always denied. There is no guardian workflow, no age-estimation vendor, and no claim of verified age. Terms, privacy presentation, AI sharing, optional analytics and Store purchases are separate decisions. The database requires adult band for AI and purchase access in this release because no minor-provider or guardian route is qualified. Existing users keep saved-place and account/deletion access while restricted.

The app must not be marketed as a Kids Category app. Apple requires accurate age ratings, an accessible privacy policy, explicit permission before sharing personal data with third-party AI, and truthful purchase disclosures. Ask to Buy and StoreKit restrictions are platform controls, not proof that Nearr has permission to process a minor's data.

## Gate decision

Under-13 support is infeasible for this candidate because verifiable parental consent, parent rights/revocation, age assurance, provider authorization, child-safe analytics and payment treatment are absent. The product policy remains 13+ with higher regional floors, while live recognition and sales remain adult-only and disabled. Legal counsel must approve the final policy text, lawful bases, market list and provider/data-transfer arrangement before any `legal_approved`, `market_qualified`, `minor_ai_qualified`, recognition or purchase switch is changed.
