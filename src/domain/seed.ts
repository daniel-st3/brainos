import type { Story, StoryStatus } from "./types";
const at = "2026-09-28T13:00:00.000Z";
export const demoId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function createDemoStories(): Story[] {
  const cases: [string, string, string, StoryStatus, string, string][] = [
    [
      "An AI release is only useful if it changes the workflow",
      "AI news",
      "AI in practice",
      "detected",
      "Separate the announcement from what is actually available.",
      "A fictional launch scenario for practicing primary-source verification. No current product release is asserted.",
    ],
    [
      "Can a meeting assistant earn its place in the stack?",
      "Tool test",
      "Tools, tested",
      "review",
      "A better test starts with the meetings you already have.",
      "A proposed comparison of manual meeting notes and an assistant. No test results or time savings are claimed.",
    ],
    [
      "The 20-minute invoice workflow worth questioning",
      "Business automation",
      "AI for business",
      "recording_needed",
      "Start with one repeated task, not an entire business.",
      "A fictional Colombian services company wants to test invoice triage. The 20-minute baseline is illustrative, not measured.",
    ],
    [
      "Build a research inbox that keeps its receipts",
      "Build-with-me",
      "Build in public",
      "render_ready",
      "Every summary should lead back to something you can inspect.",
      "A demonstration build using source links, supporting excerpts and explicit human decisions.",
    ],
    [
      "What a small team should measure before buying AI",
      "Business automation",
      "AI for business",
      "approved",
      "Measure the work before evaluating the tool.",
      "An editorial checklist for a hypothetical team. It proposes metrics; it does not assert realized business outcomes.",
    ],
    [
      "Spanish support is a test plan, not a checkbox",
      "Tool test",
      "Tools, tested",
      "researched",
      "Test names, accents and terminology in the actual workflow.",
      "A proposed Spanish-language evaluation in Colombia. Product availability and quality remain to be checked.",
    ],
    [
      "A practical guide to keeping a human in the loop",
      "Build-with-me",
      "Build in public",
      "scheduled",
      "Define the decision that still belongs to a person.",
      "A fictional tutorial package with an internal scheduling example. It has not been posted to any platform.",
    ],
  ];
  return cases.map(
    ([title, story_type, pillar, status, why_matters, summary], i) => {
      const n = (i + 1) * 100;
      const id = demoId(n);
      const sourceId = demoId(n + 1),
        claimId = demoId(n + 2),
        angleId = demoId(n + 3),
        assetId = demoId(n + 4),
        draftId = demoId(n + 6);
      const needsDraft = [
        "review",
        "recording_needed",
        "render_ready",
        "approved",
        "scheduled",
      ].includes(status);
      const approved = ["approved", "scheduled"].includes(status);
      const platform =
        i === 2 ? "short_video" : i === 4 ? "newsletter" : "instagram";
      const s: Story = {
        id,
        title,
        summary,
        status,
        pillar,
        story_type,
        primary_language: "es",
        discovered_at: at,
        published_at: null,
        urgency: i === 0 ? "high" : "medium",
        confidence: i === 0 ? "unknown" : "medium",
        audience_relevance: "high",
        latam_relevance: i === 2 || i === 5 ? "high" : "medium",
        commercial_relevance: i === 2 ? "high" : "medium",
        why_matters,
        latam_reason:
          i === 5
            ? "Proposed evaluation of Colombian Spanish; no regional quality claim has been verified."
            : "Potential application to small LATAM teams; a hypothesis, not established regional availability.",
        research_notes: `DEMO RESEARCH\n\n${summary}\n\nWhat to check\n• Compare the original source with every factual statement.\n• Separate proposed experiments from measured outcomes.\n• Review Spanish copy and usage rights before approval.`,
        research_confirmed: i !== 0,
        priority: i < 3,
        archived: false,
        is_demo: true,
        active_draft_id: needsDraft ? draftId : null,
        production_completed: approved,
        production_checklist: approved ? ["script", "sound", "visuals"] : [],
        created_at: at,
        updated_at: at,
        version: 0,
        sources: [],
        claims: [],
        evidence: [],
        angles: [],
        drafts: [],
        assets: [],
        events: [],
        publications: [],
      };
      const excerpt =
        "This is a fictional editorial exercise. The proposed experiment has not been conducted, and no measured results are available.";
      s.sources = [
        {
          id: sourceId,
          story_id: id,
          url: "https://example.com/content-os-demo/editorial-fixture",
          canonical_url:
            "https://example.com/content-os-demo/editorial-fixture",
          tier: "primary",
          publisher: "Content OS · demo fixture",
          author: "Fictional training material",
          published_at: null,
          retrieved_at: at,
          type: "Demo editorial note",
          title: "Original demo scenario · not external reporting",
          excerpt,
          is_primary: true,
          reliability:
            "Primary to this fictional scenario only. Not independently verified news.",
        },
        {
          id: demoId(n + 9),
          story_id: id,
          url: "https://www.nist.gov/itl/ai-risk-management-framework",
          canonical_url:
            "https://www.nist.gov/itl/ai-risk-management-framework",
          tier: "primary",
          publisher: "NIST",
          author: "NIST",
          published_at: null,
          retrieved_at: at,
          type: "Background reference",
          title: "AI Risk Management Framework",
          excerpt:
            "Background link only; page contents were not fetched or used as evidence for these fictional claims.",
          is_primary: true,
          reliability:
            "Real reference URL. Not retrieved or verified by this demo.",
        },
      ];
      s.claims = [
        {
          id: claimId,
          story_id: id,
          text: "The proposed experiment has not been conducted; there are no measured results.",
          confidence: "high",
          verification_status: i === 0 ? "unverified" : "supported",
          notes:
            "Demo fixture supports the absence of test results; not a claim about a live product.",
        },
      ];
      s.evidence = [
        {
          id: demoId(n + 8),
          story_id: id,
          claim_id: claimId,
          source_id: sourceId,
          excerpt,
          locator: "Demo fixture · paragraph 1",
        },
      ];
      s.angles = [
        {
          id: angleId,
          story_id: id,
          text: why_matters,
          rationale: "Keep the story practical and avoid invented outcomes.",
          kind: "practical",
          created_by: "human",
          approval_state: i === 0 ? "suggested" : "approved",
          approved_by: i === 0 ? null : "Daniel · demo approval",
          approved_at: i === 0 ? null : at,
          created_at: at,
          provenance: "demo-seed/v1",
        },
        {
          id: demoId(n + 7),
          story_id: id,
          text: "The real advantage may be a better process, not a newer model.",
          rationale: "A possible opinion, not Daniel’s confirmed belief.",
          kind: "opinion",
          created_by: "ai",
          approval_state: "suggested",
          approved_by: null,
          approved_at: null,
          created_at: at,
          provenance: "deterministic-demo/v1",
        },
      ];
      s.assets = [
        {
          id: assetId,
          story_id: id,
          draft_id: null,
          type: "Screen capture",
          title: "Original workflow diagram · demo",
          source_url: "https://example.com/content-os-demo/diagram",
          storage_url: null,
          publisher: "Daniel · fictional demo asset",
          retrieved_at: at,
          usage_basis:
            "Demo clearance only: fictional creator-owned diagram for this practice package.",
          attribution: "Daniel Rodriguez · demonstration",
          rights_status: "cleared",
          publishable: true,
          notes:
            "Metadata fixture only. No real file is licensed by this record.",
          cleared_by: "Daniel · demo clearance",
          cleared_at: at,
        },
        {
          id: demoId(n + 10),
          story_id: id,
          draft_id: null,
          type: "Product screenshot",
          title: "Third-party product screenshot",
          source_url: "https://example.com/content-os-demo/uncleared",
          storage_url: null,
          publisher: "Example vendor · fictional",
          retrieved_at: at,
          usage_basis: "Permission not established.",
          attribution: "To be confirmed",
          rights_status: "unknown",
          publishable: false,
          notes: "Research reference only. Not selected for the active draft.",
          cleared_by: null,
          cleared_at: null,
        },
        {
          id: demoId(n + 11),
          story_id: id,
          draft_id: null,
          type: "Photo",
          title: "Restricted stock photo",
          source_url: "https://example.com/content-os-demo/restricted",
          storage_url: null,
          publisher: "Example photo library · fictional",
          retrieved_at: at,
          usage_basis: "Demo restriction: no redistribution.",
          attribution: "Not cleared for use",
          rights_status: "blocked",
          publishable: false,
          notes: "Must not be selected for production.",
          cleared_by: null,
          cleared_at: null,
        },
      ];
      if (needsDraft) {
        const body = `[DEMO · Borrador de práctica]\n\n${summary}\n\nAntes de elegir una herramienta, definamos una tarea y una forma de evaluarla.\n\n1. Registrar el proceso actual.\n2. Diseñar una prueba pequeña y reproducible.\n3. Revisar los resultados con una persona.\n\nTodavía no hay resultados medidos. Esta es una propuesta, no una experiencia que ya haya realizado.`;
        s.drafts = [
          {
            id: demoId(n + 5),
            story_id: id,
            platform,
            format:
              platform === "short_video"
                ? "Face-led outline"
                : "Editorial note",
            language: "es",
            hook: "Primero el proceso. Después, la herramienta.",
            body: body.replace("pequeña y reproducible", "pequeña"),
            cta: "¿Qué proceso revisarías?",
            target_duration: platform === "short_video" ? 60 : null,
            revision: 1,
            status: "superseded",
            angle_id: angleId,
            claim_ids: [claimId],
            asset_ids: [],
            approved_by: null,
            approved_at: null,
            created_at: at,
            provenance: "demo-seed/v1",
            shot_notes: "Face to camera, then a real screen recording.",
          },
          {
            id: draftId,
            story_id: id,
            platform,
            format:
              platform === "short_video"
                ? "Face-led outline"
                : "Editorial note",
            language: "es",
            hook: "Antes de automatizar, decide qué vas a medir.",
            body,
            cta: "¿Qué tarea probarías primero?",
            target_duration: platform === "short_video" ? 60 : null,
            revision: 2,
            status: approved ? "approved" : "draft",
            angle_id: angleId,
            claim_ids: [claimId],
            asset_ids: [assetId],
            approved_by: approved ? "Daniel · demo approval" : null,
            approved_at: approved ? at : null,
            created_at: at,
            provenance: "demo-human-edit/v1",
            shot_notes:
              "Hook: face to camera. B-roll: original workflow diagram. Avoid exposing customer data.",
          },
        ];
      }
      s.events = [
        {
          id: demoId(n + 12),
          story_id: id,
          type: "demo_seed",
          actor: "Demo fixture",
          from_status: null,
          to_status: status,
          draft_id: s.active_draft_id,
          detail:
            "Fictional training package seeded at this workflow stage. Not current verified news.",
          created_at: at,
        },
      ];
      if (approved) {
        s.events.push({
          id: demoId(n + 13),
          story_id: id,
          type: "approval",
          actor: "Daniel · demo approval",
          from_status: "review",
          to_status: "approved",
          draft_id: draftId,
          detail: "Seeded demo approval of exact revision 2.",
          created_at: at,
        });
        s.publications = [
          {
            id: demoId(n + 14),
            story_id: id,
            draft_id: draftId,
            platform,
            destination: i === 6 ? "Daniel · Instagram (demo)" : "Not selected",
            scheduled_at: i === 6 ? "2026-10-05T15:00:00.000Z" : null,
            status: i === 6 ? "scheduled_internal" : "ready_to_schedule",
            published_url: null,
            created_at: at,
          },
        ];
      }
      return s;
    },
  );
}
