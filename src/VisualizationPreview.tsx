import React, { useState } from "react";

export type UIVisualProfile = {
  requires_tunnel_vision: boolean;
  requires_dyslexia_font: boolean;
  requires_sensory_reduction: boolean;
};

/** Same shape as Microtasks Preview (MicrotaskItem). */
type PreviewMicrotask = {
  sequence_id: number;
  title: string;
  description: string;
  work_phase: string;
  estimated_minutes: number;
  weight_percentage: number;
  source_pointer?: string;
  hierarchy?: { type?: string; requires?: number[] };
  concepts?: string[];
  scaffold_tip?: string;
  decomposed_details?: { title: string; description: string }[];
};

/** Renders text with **bold** markdown as <strong>. Export for use in Microtasks Preview. */
export function renderTextWithBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part
  );
}

/** Single microtask card — same layout as Microtasks Preview in App. */
function MicrotaskCard({
  mt,
  profile,
  previewTypographyStyle,
  renderTextWithBold,
  expanded,
  onToggleExpand,
}: {
  mt: PreviewMicrotask;
  profile: UIVisualProfile;
  previewTypographyStyle: React.CSSProperties;
  renderTextWithBold: (t: string) => React.ReactNode;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const requiresCount = mt.hierarchy?.requires?.length ?? 0;
  const cardClass = profile.requires_sensory_reduction
    ? "rounded-xl border border-slate-300 bg-slate-50/50 px-3 py-3 shadow-sm"
    : "rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 shadow-sm";
  const badgeClass = profile.requires_sensory_reduction
    ? "inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[0.65rem] font-medium text-slate-700 border border-slate-200"
    : "inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[0.65rem] font-medium text-indigo-700 border border-indigo-100";

  return (
    <div className={cardClass} style={previewTypographyStyle}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <div className="text-[0.65rem] uppercase tracking-wide text-slate-400">
            Task {mt.sequence_id}
          </div>
          <div className="text-[0.8rem] font-semibold text-slate-900">
            {renderTextWithBold(mt.title)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-[0.7rem]">
          <span className={badgeClass}>{mt.work_phase}</span>
          <span className="text-slate-500">
            {mt.estimated_minutes} min · {mt.weight_percentage.toFixed(1)}%
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-700 leading-relaxed">
        {renderTextWithBold(mt.description)}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.7rem] text-slate-500">
        {mt.source_pointer && (
          <span>
            <span className="font-medium text-slate-700">Source:</span>{" "}
            {mt.source_pointer}
          </span>
        )}
        {mt.hierarchy?.type && (
          <span>
            <span className="font-medium text-slate-700">Hierarchy:</span>{" "}
            {mt.hierarchy.type}
            {requiresCount > 0 ? ` (requires ${requiresCount})` : ""}
          </span>
        )}
      </div>
      {mt.concepts && mt.concepts.length > 0 && (
        <p className="mt-2 text-[0.7rem] text-slate-500">
          <span className="font-medium text-slate-700">Concepts:</span>{" "}
          {mt.concepts.join(", ")}
        </p>
      )}
      {mt.scaffold_tip && (
        <p className="mt-1 text-[0.7rem] text-slate-500">
          <span className="font-medium text-slate-700">Scaffold tip:</span>{" "}
          {mt.scaffold_tip}
        </p>
      )}
      {mt.decomposed_details && mt.decomposed_details.length > 0 && (
        <div className="mt-2 space-y-1.5">
          <button
            type="button"
            onClick={onToggleExpand}
            className={
              profile.requires_sensory_reduction
                ? "text-[0.7rem] font-medium text-slate-700 hover:text-slate-800"
                : "text-[0.7rem] font-medium text-indigo-700 hover:text-indigo-800"
            }
          >
            {expanded ? "Hide breakdown" : `Show breakdown (${mt.decomposed_details.length})`}
          </button>
          {expanded && (
            <ul className="space-y-1.5">
              {mt.decomposed_details.map((d, idx) => (
                <li
                  key={`${mt.sequence_id}-${idx}`}
                  className="flex items-start gap-1.5 text-[0.75rem] text-slate-700 leading-relaxed"
                >
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-400" />
                  <span>
                    <span className="font-medium">{d.title}.</span>{" "}
                    {d.description}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Dummy microtasks in same shape as API. Variants per processing_style so high_friction shows bold verbs. */
function getDummyMicrotasks(
  textStyle: keyof typeof CALIBRATION_TEXT_EXAMPLES
): PreviewMicrotask[] {
  const isBold = textStyle === "high_friction";
  const b = (s: string) => (isBold ? `**${s}**` : s);
  return [
    {
      sequence_id: 1,
      title: `${b("Create")} folder and ${b("open")} IDE`,
      description: `${b("Create")} a folder named 'Lab1' on your desktop. ${b("Open")} your code editor and ${b("set")} the working directory to this folder.`,
      work_phase: "Inertia Breaker",
      estimated_minutes: 3,
      weight_percentage: 5,
      source_pointer: "Setup",
      hierarchy: { type: "independent", requires: [] },
      decomposed_details: [
        { title: "Create folder", description: "Name it Lab1." },
        { title: "Open editor", description: "Set working directory." },
      ],
    },
    {
      sequence_id: 2,
      title: `${b("Recall")}: inverse operations`,
      description: `Before coding, ${b("recall")}: what is the inverse of addition? ${b("Write")} one sentence.`,
      work_phase: "Recall",
      estimated_minutes: 5,
      weight_percentage: 10,
      concepts: ["inverse operations"],
      decomposed_details: [
        { title: "Recall", description: "Inverse of addition." },
        { title: "Write", description: "One sentence." },
      ],
    },
    {
      sequence_id: 3,
      title: `${b("Outline")} your steps`,
      description: `${b("List")} the steps you will take. Do not write code yet.`,
      work_phase: "Metacognition",
      estimated_minutes: 8,
      weight_percentage: 15,
      scaffold_tip: "It's okay to take a minute to plan.",
      decomposed_details: [
        { title: "List steps", description: "On paper or in notes." },
      ],
    },
    {
      sequence_id: 4,
      title: `${b("Write")} the function body`,
      description: `${b("Implement")} the function body for calculate_total. ${b("Use")} the steps you outlined.`,
      work_phase: "Execution",
      estimated_minutes: 20,
      weight_percentage: 50,
      source_pointer: "Problem 2a",
      hierarchy: { type: "sequential", requires: [0, 1, 2] },
      concepts: ["loops", "arrays"],
      decomposed_details: [
        { title: "Implement", description: "Function body." },
        { title: "Use", description: "Your outline." },
      ],
    },
    {
      sequence_id: 5,
      title: `${b("Explain")} your result`,
      description: `In one plain-English sentence, ${b("explain")} why your answer is correct.`,
      work_phase: "Synthesis",
      estimated_minutes: 5,
      weight_percentage: 20,
      decomposed_details: [
        { title: "Explain", description: "One sentence." },
      ],
    },
  ];
}

const DUMMY_PARAGRAPH =
  "Your assignment is to implement a function that sums an array of numbers. First, create a project folder. Then recall how loops work. Next, outline your steps on paper. After that, write the code. Finally, test with a small example and explain your result in one sentence.";

/** Example text snippets showing how calibration_dials affect LLM output (for prompt builder). */
const CALIBRATION_TEXT_EXAMPLES = {
  literal:
    "Begin Step 1. Create a folder. Stop when the folder exists. Do not proceed until this is done.",
  standard:
    "Create a folder for this lab and open your IDE. Once you're in the right directory, we'll move on.",
  high_friction:
    "**Create** a folder. **Open** your IDE. **Set** the directory. Short steps.",
  reassuring:
    "Let's start with something small. Create a folder — it's okay if this takes a minute. You're on the right track.",
  objective:
    "Create folder 'Lab1'. Open your code editor. Set working directory to that folder.",
};

export function VisualizationPreview() {
  const [profile, setProfile] = useState<UIVisualProfile>({
    requires_tunnel_vision: false,
    requires_dyslexia_font: false,
    requires_sensory_reduction: false,
  });
  const [activeTaskIndex, setActiveTaskIndex] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState<Record<number, boolean>>({});
  const [textExample, setTextExample] = useState<keyof typeof CALIBRATION_TEXT_EXAMPLES>("standard");

  const dummyTasks = getDummyMicrotasks(textExample);
  const activeTask = dummyTasks[activeTaskIndex];
  const progress = (activeTaskIndex + 1) / dummyTasks.length;

  const toggle = (key: keyof UIVisualProfile) =>
    setProfile((p) => ({ ...p, [key]: !p[key] }));

  const handleNext = () => {
    if (activeTaskIndex < dummyTasks.length - 1) {
      setActiveTaskIndex((i) => i + 1);
    } else {
      setCompleted(true);
    }
  };

  const previewContainerClass = [
    "rounded-xl border p-4 transition-colors",
    profile.requires_dyslexia_font
      ? "bg-[#FDFBF7] text-[#2D2D2D] max-w-[65ch] mx-auto leading-[1.75] tracking-wide"
      : "bg-white border-slate-200",
    profile.requires_sensory_reduction
      ? "border-slate-300 text-slate-700"
      : "border-slate-200",
  ].join(" ");

  const previewTypographyStyle: React.CSSProperties = profile.requires_dyslexia_font
    ? {
        fontFamily: "'Lexend', 'Comic Sans MS', sans-serif",
        lineHeight: 1.8,
        letterSpacing: "0.02em",
      }
    : {};

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 mb-1">
          Visualization Preview
        </h2>
        <p className="text-xs text-slate-500">
          Toggle <strong>ui_visual_profile</strong> flags to see how the same
          content is rendered. These flags are stored in the user profile and
          applied by the frontend (they do not change the LLM output).
        </p>
      </div>

      {/* UI Visual Profile toggles */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-700">
          ui_visual_profile (frontend rendering)
        </h3>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={profile.requires_tunnel_vision}
              onChange={() => toggle("requires_tunnel_vision")}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
            />
            <span className="text-xs text-slate-700">
              Tunnel vision (single task only, progress bar)
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={profile.requires_dyslexia_font}
              onChange={() => toggle("requires_dyslexia_font")}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
            />
            <span className="text-xs text-slate-700">
              Dyslexia-friendly (font, spacing, contrast, max-width)
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={profile.requires_sensory_reduction}
              onChange={() => toggle("requires_sensory_reduction")}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
            />
            <span className="text-xs text-slate-700">
              Sensory reduction (no animation, muted colors)
            </span>
          </label>
        </div>
      </div>

      {/* Calibration dials text example (prompt builder effect) */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-700">
          calibration_dials → LLM text style (prompt builder only)
        </h3>
        <p className="text-xs text-slate-500">
          These control language, chunking, and formatting of the LLM output, not
          the UI layout. Example phrasing for the same step:
        </p>
        <select
          value={textExample}
          onChange={(e) =>
            setTextExample(e.target.value as keyof typeof CALIBRATION_TEXT_EXAMPLES)
          }
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
        >
          <option value="literal">literal (no metaphors, strict DoD)</option>
          <option value="standard">standard</option>
          <option value="high_friction">high_friction (short, bold verb)</option>
          <option value="reassuring">reassuring (normalize stuck)</option>
          <option value="objective">objective (pure facts)</option>
        </select>
        <div
          className={`rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 ${profile.requires_dyslexia_font ? "max-w-[65ch]" : ""}`}
          style={previewTypographyStyle}
        >
          &ldquo;{renderTextWithBold(CALIBRATION_TEXT_EXAMPLES[textExample])}&rdquo;
        </div>
      </div>

      {/* Live preview: task list or single task + progress */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-700">Live preview</h3>
        <div
          className={previewContainerClass}
          style={{
            ...previewTypographyStyle,
            ...(profile.requires_sensory_reduction
              ? { animation: "none", transition: "none" }
              : {}),
          }}
        >
          {profile.requires_tunnel_vision ? (
            <>
              <MicrotaskCard
                mt={activeTask}
                profile={profile}
                previewTypographyStyle={previewTypographyStyle}
                renderTextWithBold={renderTextWithBold}
                expanded={!!expandedTasks[activeTask.sequence_id]}
                onToggleExpand={() =>
                  setExpandedTasks((prev) => ({
                    ...prev,
                    [activeTask.sequence_id]: !prev[activeTask.sequence_id],
                  }))
                }
              />
              <div className="mt-4 flex items-center gap-3">
                <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      profile.requires_sensory_reduction
                        ? "bg-slate-500"
                        : "bg-indigo-500"
                    }`}
                    style={{
                      width: `${progress * 100}%`,
                      transition: profile.requires_sensory_reduction
                        ? "none"
                        : "width 0.25s ease-out",
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleNext}
                  className="rounded-full px-3 py-1.5 text-xs font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                >
                  {activeTaskIndex < dummyTasks.length - 1
                    ? "Next task"
                    : completed
                      ? "Done"
                      : "Complete"}
                </button>
              </div>
              {completed && (
                <div className="mt-3 flex items-center gap-2 text-slate-600">
                  <span className="text-sm">✓ All set.</span>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4 text-xs pr-1">
              {dummyTasks.map((mt) => (
                <MicrotaskCard
                  key={mt.sequence_id}
                  mt={mt}
                  profile={profile}
                  previewTypographyStyle={previewTypographyStyle}
                  renderTextWithBold={renderTextWithBold}
                  expanded={!!expandedTasks[mt.sequence_id]}
                  onToggleExpand={() =>
                    setExpandedTasks((prev) => ({
                      ...prev,
                      [mt.sequence_id]: !prev[mt.sequence_id],
                    }))
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Short paragraph in same container to show typography/width */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-700">
          Sample paragraph (typography & width)
        </h3>
        <div
          className={previewContainerClass}
          style={previewTypographyStyle}
        >
          <p className="text-sm">{DUMMY_PARAGRAPH}</p>
        </div>
      </div>
    </div>
  );
}
