# Creative Lab exchange and composable metadata

**VISUAL GRAMMAR STILL UNFROZEN — WAITING ON C#2 PROTOTYPE VALIDATION.**

Audited repository: `daniel-st3/brainos`, branch `codex/automated-newsroom`, starting HEAD `c960dc076df043d1b05f88283475b17696909ba7`. No aesthetic, model, font, palette, layout or capability taxonomy has been adopted.

## Audit against the actual implementation

| Requirement                                             | Existing support at starting HEAD                                                                                                                   | Small additive change                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Arbitrary layers / z-order; background/foreground type  | `VisualSpec.layering` prose, per-scene composition and JSON extensions; no typed relationships                                                      | Optional per-scene `compositing` with arbitrary layer IDs, integer z-order, intent and relationships            |
| Masks, subject cutouts                                  | `masks_crops` prose; external asset handoff                                                                                                         | Mask asset reference, alpha/luminance interpretation; generic operation descriptors, no segmentation executor   |
| Story-specific typography / palette                     | Explicit roles/family/direction/weight and optional palette, separately per visual spec and scene; no default public accent                         | Preserved; layers may reference an existing scene typography role                                               |
| Crops / focal points                                    | Prose only                                                                                                                                          | Normalized source crop and focal point; normalized canvas frame can bleed beyond the canvas                     |
| Photography, UI and screenshots                         | Official/owned/manual/screenshot providers, source URLs, dimensions, MIME, rights and receipt provenance; photo/product_ui/screenshot/custom scenes | Preserved; any asset can be a composition input                                                                 |
| Evidence-linked charts                                  | Chart/data scenes and retained source/evidence references; no chart renderer                                                                        | Preserved; operations can also reference retained evidence, validated by existing story binding                 |
| Intermediate creative assets                            | Ordinary candidates can hold a file, but explicit derivation lineage missing                                                                        | Optional `derivation`: exact brief/content/draft revisions, tool/version, operation ID, input IDs and checksums |
| Human feedback and approve/reject individual prototypes | Package approval and candidate accept/reject exist; no prototype exchange/normalized observations                                                   | Separate version-1 Creative Lab exchange below; does not replace package approval                               |
| Radically different carousel compositions               | Independent composition/copy/type/palette/motion per scene; scene type is editorial purpose, not layout                                             | Preserved; each scene may have an unrelated layer/operation graph                                               |

## Composition contract

`src/creative/composition.ts` is descriptive metadata, not executable code. Operation names are open strings. BrainOS does not interpret a name as a shell command, tool invocation, network request, installed plugin or approved DVNI capability. Parameter values are JSON data. Unsupported operations must remain blocked by a future renderer's capability negotiation rather than silently choosing a template.

`CarouselScene.compositing` is optional and contains `schema_version: 1`, `layers`, `relationships`, `operations`. Higher `z_index` means intended foreground; array order breaks equal-z ties for a future renderer. Layer frames use normalized canvas coordinates and permit intentional negative positions/oversized frames. Crops/focal points use normalized source coordinates; crops must fit the source image. A layer can reference exact scene copy, an explicitly supplied typography role, multiple assets, a mask, and ordered transformation descriptors. Relationships preserve freeform intent, not a permanent design taxonomy. No defaults for fonts, accent, composition or style are introduced.

Operation IDs are unique across scenes; dependency references are local to the scene and acyclic. Input/output and mask references must resolve to declared scene assets. Derivations must match the operation's inputs/output, exact brief/content/draft revision and current input checksums, and cannot form cycles. Derivation metadata describes how bytes were obtained; it is not proof that a tool was executed. Actual file receipts remain required.

Every referenced asset, including a mask/intermediate/ancestor input, must be selected and pass the existing authoritative rights, exact-draft and private media-receipt checks before rendering. Selected operation outputs also need derivation metadata. Transformed pixels do not launder source rights. Changes affect the existing canonical specification checksum, invalidate previous creative approval and change job identity. Optional fields are absent by default, preserving old package fingerprints. No database migration is required.

## C#2 → BrainOS exchange

`src/creative/lab.ts` defines `creativeLabHandoffSchema` and `validateLabHandoff`. See `docs/examples/creative-lab-handoff.json` for a validated, explicitly synthetic example. It contains no actual Daniel opinion or creative output.

| Field                                        | Meaning                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `schema_version`, `format`, `grammar_status` | Version 1, creative_lab_handoff, pending C#2 validation                                                                   |
| `prototype`                                  | Lab ID, positive revision, exact specification SHA-256                                                                    |
| `story_id`                                   | Optional story UUID; unbound design experiments are allowed                                                               |
| `binding` + `brief`                          | Optional together; exact editorial binding and brief ID/revision when testing an existing package                         |
| `visual_thesis`                              | Lab-supplied intent, no inferred Daniel opinion                                                                           |
| `source_assets`                              | IDs, provider, canonical URL, creator, usage basis, reported rights, checksum/private reference                           |
| `scenes`                                     | IDs, composition notes, source asset associations; no fixed scene recipe                                                  |
| `tools_used`                                 | Tool names, versions/notes where known                                                                                    |
| `final_artifact`                             | Design URL and/or file checksum; not automatically downloaded                                                             |
| `daniel_feedback`                            | Verbatim reported feedback, timestamp and optional scene                                                                  |
| `observations`                               | Freeform normalized statement, disposition, normalizer/time, originating feedback IDs and optional scene                  |
| `review`                                     | Exact prototype revision/hash, reported reviewer/time, decision and original feedback IDs; scope is prototype_visual_only |
| `rule_candidates`                            | Freeform possible learning with observation IDs, scope notes and literal unvalidated status                               |
| `unresolved_questions`                       | Open issues rather than silently promoted rules                                                                           |
| `publishable`, `publication_authorized`      | Both must remain false, including for visually approved prototypes                                                        |

All feedback belongs to this exact prototype iteration. Preserve each exchange as a separate immutable snapshot; changing a prototype does not carry approval forward. Duplicate IDs, missing associations, detached observations, stale reviews, active rule candidates and publication flags are rejected. A future importer must supply a trusted prototype receipt; `validateLabHandoff` compares its ID/revision/checksum and, when bound, current editorial/brief/scene references. Caller-reported reviewer names, rights and feedback are evidence to review, not authentication. A real importer must authenticate Daniel, verify private upload receipts, retain snapshots through the existing history mechanism and recheck current editorial/rights rules.

Original `daniel_feedback.verbatim` preserves spaces, tabs and line breaks exactly; validation rejects whitespace-only or oversized input without trimming meaningful feedback. Normalized observations remain separate.

This iteration creates the exchange contract **for future ingestion**, not a new live ingest endpoint, UI, feedback database, scoring system or learning engine. Do not place private exchanges on public routes or log their full payloads. Do not treat artifact URLs as permission to fetch arbitrary resources.

## Unchanged control plane

Existing editor auth, same-origin/epoch checks, creative save/approve/import commands, DB guard, private Canva export, job idempotency, human approval, rights and exact revision checks remain authoritative. No social provider, outbox, scheduler, worker, discovery, ranking or pilot code changes. Legacy SVG/Sharp/PNG/JPEG/carousel rendering remains intact. No new renderer, model, dependency or external job is activated.

See `creative-tooling.md` for current official tooling and Canva boundary research.
