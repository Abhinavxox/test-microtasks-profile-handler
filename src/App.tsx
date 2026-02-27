import React, { useCallback, useRef, useState } from "react";
import ReactQuill from "react-quill";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type NeuroMetrics = {
  ef_capacity: "high" | "moderate" | "low";
  processing_style: "standard" | "high_friction" | "literal";
  coach_tone: "challenger" | "reassuring" | "objective";
  metacognition_style: "planner" | "adjuster" | "anti_planner";
};

type QAContextItem = { question: string; answer: string };

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

const rawApiBase = (import.meta as any).env?.AI_BASE_URL as string | undefined;

const API_BASE = rawApiBase
  ? rawApiBase.replace(/\/+$/, "")
  : "http://127.0.0.1:8000";

function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${p}`;
}

type MCQOption = {
  key: string;
  label: string;
};

type ParsedQuestion = {
  question: string;
  options: MCQOption[];
};

type MicrotaskDetail = {
  title: string;
  description: string;
};

type MicrotaskItem = {
  sequence_id: number;
  title: string;
  description: string;
  work_phase: string;
  estimated_minutes: number;
  weight_percentage: number;
  concepts?: string[];
  source_pointer?: string;
  rationale?: string;
  scaffold_tip?: string;
  hierarchy?: {
    type?: string;
    requires?: number[];
  };
  decomposed_details?: MicrotaskDetail[];
};

type MicrotasksOutput = {
  uac_metadata?: {
    total_estimated_minutes?: number;
    pedagogical_reasoning?: string;
  };
  microtasks?: MicrotaskItem[];
};

type MicrotasksApiResponse = {
  status?: string;
  request_id?: string;
  partner_id?: string | null;
  course_id?: string;
  assignment_id?: string;
  llm_model?: string;
  llm_cost?: number;
  generated_at?: string;
  microtasks_output?: MicrotasksOutput;
};

const DEFAULT_SUPPORT_LEVEL = "HIGH" as const;

function authHeader(): Record<string, string> {
  const token = (import.meta as any).env?.AI_SERVER_API_KEY_AUTH as
    | string
    | undefined;
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

function parseQuestionAndOptions(raw: string): ParsedQuestion {
  const options: MCQOption[] = [];

  // Try to split question from options by locating the first "A." / "A)" marker
  const firstOptMatch = raw.match(/\bA[.)]\s/);
  let questionText = raw.trim();
  let optionsText = "";

  if (firstOptMatch && typeof firstOptMatch.index === "number") {
    const idx = firstOptMatch.index;
    questionText = raw.slice(0, idx).trim();
    optionsText = raw.slice(idx).trim();
  }

  // Fallback: if we did not clearly separate, still try to parse options over the full text
  if (!optionsText) {
    optionsText = raw.trim();
  }

  // Match "A. <label> B. <label> C. <label>" even when inline.
  const optionRegex = /([A-C])[.)]\s*([\s\S]*?)(?=(?:\s+[A-C][.)]\s)|$)/g;

  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = optionRegex.exec(optionsText)) !== null) {
    const key = match[1] as "A" | "B" | "C";
    let label = match[2].trim();
    // Strip bullets and basic markdown emphasis
    label = label.replace(/^[-*]\s*/, "");
    label = label.replace(/^\*\*|\*\*$/g, "").replace(/^[_*]+|[_*]+$/g, "");
    options.push({ key, label });
  }

  return { question: questionText, options };
}

async function streamProfileQuestion(
  inputText: string,
  context: QAContextItem[],
  onWord: (word: string) => Promise<void>,
  onMetrics: (metrics: NeuroMetrics) => void,
): Promise<boolean> {
  const res = await fetch(apiUrl("/profile-questionnaire"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
    },
    body: JSON.stringify({
      input_text: inputText,
      context,
    }),
  });

  if (!res.body) {
    throw new Error("No response body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let finalized = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let sepIndex: number;
    while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex).trim();
      buffer = buffer.slice(sepIndex + 2);

      if (!rawEvent.startsWith("data:")) continue;
      const jsonStr = rawEvent.replace(/^data:\s*/, "");

      try {
        const payload = JSON.parse(jsonStr);
        const { type } = payload;

        if (type === "text" && payload.content && !finalized) {
          // Let caller animate word-by-word (or chunk-by-chunk)
          // and yield the event loop so React can paint.
          // eslint-disable-next-line no-await-in-loop
          await onWord(payload.content as string);
        } else if (type === "neuro_metrics_finalized") {
          finalized = true;
          onMetrics(payload.result as NeuroMetrics);
          // Once metrics arrive, we can stop processing further events for this turn.
          return true;
        } else if (type === "error") {
          console.error("Profile questionnaire error", payload);
        } else if (type === "end") {
          return finalized;
        }
      } catch (e) {
        console.warn("Failed to parse SSE chunk", e, rawEvent);
      }
    }
  }
  return finalized;
}

function App() {
  const [activeTab, setActiveTab] = useState<
    "calibration" | "microtasks" | "preview"
  >("calibration");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [metrics, setMetrics] = useState<NeuroMetrics | null>(null);
  const [context, setContext] = useState<QAContextItem[]>([]);
  const [options, setOptions] = useState<MCQOption[]>([]);
  const [isFinished, setIsFinished] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  // Microtasks sandbox state
  const [mtAssignmentName, setMtAssignmentName] = useState("Demo Assignment");
  const [mtCourseName, setMtCourseName] = useState("Demo Course");
  const [mtCourseCode, setMtCourseCode] = useState("DEMO 101");
  const [mtDescription, setMtDescription] = useState("");
  const [mtEfCapacity, setMtEfCapacity] =
    useState<NeuroMetrics["ef_capacity"]>("moderate");
  const [mtProcessingStyle, setMtProcessingStyle] =
    useState<NeuroMetrics["processing_style"]>("standard");
  const [mtCoachTone, setMtCoachTone] =
    useState<NeuroMetrics["coach_tone"]>("reassuring");
  const [mtResult, setMtResult] = useState<MicrotasksOutput | null>(null);
  const [mtRawResponse, setMtRawResponse] =
    useState<MicrotasksApiResponse | null>(null);
  const [mtLoading, setMtLoading] = useState(false);
  const [mtError, setMtError] = useState<string | null>(null);
  const [mtFileName, setMtFileName] = useState<string | null>(null);
  const [mtFileBase64, setMtFileBase64] = useState<string | null>(null);
  const [mtFileMime, setMtFileMime] = useState<string>("application/octet-stream");
  const [mtFileLoading, setMtFileLoading] = useState(false);
  const [mtToast, setMtToast] = useState<string | null>(null);

  const hasMicrotasks =
    !!mtResult &&
    Array.isArray(mtResult.microtasks) &&
    mtResult.microtasks.length > 0;
  const [expandedTasks, setExpandedTasks] = useState<Record<number, boolean>>(
    {},
  );

  const lastAssistantQuestionRef = useRef<string>("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  }, []);

  const sendMessage = useCallback(
    async (
      userText: string,
      opts?: { showUser?: boolean; updateContext?: boolean },
    ) => {
      if (!userText.trim() || isStreaming || isFinished) return;

      const showUser = opts?.showUser ?? true;
      const shouldUpdateContext = opts?.updateContext ?? true;

      setOptions([]);

      // Add user message (optional – skipped for initial "start" trigger)
      if (showUser) {
        setMessages((prev) => [
          ...prev,
          {
            id: `user-${Date.now()}`,
            role: "user",
            content: userText,
          },
        ]);
      }

      // Update context with last assistant question + this answer (if any)
      if (lastAssistantQuestionRef.current && shouldUpdateContext) {
        setContext((prev) => [
          ...prev,
          {
            question: lastAssistantQuestionRef.current,
            answer: userText,
          },
        ]);
      }

      setIsStreaming(true);
      scrollToBottom();

      // Streaming next assistant question
      let accumulated = "";
      const assistantId = `assistant-${Date.now()}`;

      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
        },
      ]);

      try {
        const finalized = await streamProfileQuestion(
          userText,
          lastAssistantQuestionRef.current
            ? [
                ...context,
                {
                  question: lastAssistantQuestionRef.current,
                  answer: userText,
                },
              ]
            : context,
          async (word) => {
            accumulated = accumulated ? `${accumulated} ${word}` : word;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: accumulated } : m,
              ),
            );
            lastAssistantQuestionRef.current = accumulated;
            scrollToBottom();
            // Small delay so the UI visibly streams instead of jumping all at once
            await new Promise((resolve) => {
              // Use requestAnimationFrame for smoother updates without blocking too long
              requestAnimationFrame(() => resolve(undefined));
            });
          },
          (finalMetrics) => {
            setMetrics(finalMetrics);
            setMessages((prev) => [
              ...prev,
              {
                id: `metrics-${Date.now()}`,
                role: "assistant",
                content:
                  `Got it — here’s your calibrated study profile:\n\n` +
                  `EF Capacity: ${finalMetrics.ef_capacity}\n` +
                  `Processing Style: ${finalMetrics.processing_style}\n` +
                  `Coach Tone: ${finalMetrics.coach_tone}\n` +
                  `Metacognition: ${finalMetrics.metacognition_style}`,
              },
            ]);
            scrollToBottom();
          },
        );

        if (finalized) {
          setOptions([]);
          setIsFinished(true);
          return;
        }

        // After the stream for this turn completes, parse MCQ options from the full assistant text
        if (lastAssistantQuestionRef.current) {
          const parsed = parseQuestionAndOptions(
            lastAssistantQuestionRef.current,
          );
          if (parsed.options.length > 0) {
            setOptions(parsed.options);
            // Optionally remove the raw options from the assistant bubble for a cleaner look
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: parsed.question || m.content }
                  : m,
              ),
            );
          }
        }
      } catch (err) {
        console.error(err);
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "system",
            content:
              "Something went wrong while talking to the questionnaire API.",
          },
        ]);
      } finally {
        setIsStreaming(false);
        scrollToBottom();
      }
    },
    [context, isStreaming, scrollToBottom],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!currentInput.trim() || isFinished) return;
      const text = currentInput.trim();
      setCurrentInput("");
      void sendMessage(text);
    },
    [currentInput, isFinished, sendMessage],
  );

  const handleOptionClick = useCallback(
    (option: MCQOption) => {
      if (isStreaming || isFinished) return;
      void sendMessage(option.label);
    },
    [isStreaming, isFinished, sendMessage],
  );

  const handleStart = useCallback(() => {
    if (hasStarted || isStreaming || isFinished) return;
    setActiveTab("calibration");
    setHasStarted(true);
    // Kick off the first question without creating a user bubble or updating context
    void sendMessage("Start neuro profile calibration", {
      showUser: false,
      updateContext: false,
    });
  }, [hasStarted, isStreaming, isFinished, sendMessage]);

  const goToMicrotasksWithMetrics = useCallback(() => {
    setActiveTab("microtasks");
    if (metrics) {
      setMtEfCapacity(metrics.ef_capacity);
      setMtProcessingStyle(metrics.processing_style);
      setMtCoachTone(metrics.coach_tone);
      setMtToast("Metrics have been pre-fed. Add description or file!");
      window.setTimeout(() => setMtToast(null), 4500);
    } else {
      setMtToast("Add description or file!");
      window.setTimeout(() => setMtToast(null), 3000);
    }
  }, [metrics]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) {
        setMtFileName(null);
        setMtFileBase64(null);
        setMtFileLoading(false);
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        setMtError("File too large. Please upload a file under 20 MB.");
        setMtFileName(null);
        setMtFileBase64(null);
        setMtFileLoading(false);
        return;
      }
      setMtError(null);
      setMtFileName(file.name);
      setMtFileMime(file.type || "application/octet-stream");
      setMtFileLoading(true);
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64 = result.includes(",")
          ? (result.split(",")[1] ?? "")
          : result;
        setMtFileBase64(base64 || null);
        setMtFileLoading(false);
      };
      reader.readAsDataURL(file);
    },
    [],
  );

  const handleGenerateMicrotasks = useCallback(async () => {
    if (mtFileLoading) {
      setMtError("Attachment is still loading. Please wait a moment and try again.");
      return;
    }
    // Require EITHER a description OR an attached file (already loaded)
    if (!mtDescription.trim() && !mtFileName) {
      setMtError("Please add a description or attach a file.");
      return;
    }
    setActiveTab("microtasks");
    setMtLoading(true);
    setMtError(null);
    setMtResult(null);
    try {
      const body = {
        course_id: "demo-course",
        course_name: mtCourseName || "Demo Course",
        course_code: mtCourseCode || "DEMO 101",
        assignment_id: "demo-assignment",
        assignment_name: mtAssignmentName || "Demo Assignment",
        description: mtDescription,
        due_at: null,
        points: null,
        estimated_time_hint: null,
        concepts: [] as string[],
        rubric_text: null,
        files:
          mtFileBase64 && mtFileName
            ? [
                {
                  assignment_id: "demo-assignment",
                  mime_type: mtFileMime,
                  data: mtFileBase64,
                  uri: null,
                  filename: mtFileName,
                },
              ]
            : null,
        support_level: DEFAULT_SUPPORT_LEVEL,
        academic_level: "high_school",
        ef_capacity: mtEfCapacity,
        processing_style: mtProcessingStyle,
        coach_tone: mtCoachTone,
      };

      const res = await fetch(apiUrl("/course-plan/single-assignment"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader(),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const msg =
          (errJson && (errJson.detail || errJson.message)) ||
          `Request failed with status ${res.status}`;
        setMtError(typeof msg === "string" ? msg : JSON.stringify(msg));
        setMtLoading(false);
        return;
      }

      const data = (await res.json()) as MicrotasksApiResponse;
      setMtRawResponse(data);
      const result = data.microtasks_output ?? null;
      setMtResult(result);
      if (
        result &&
        Array.isArray(result.microtasks) &&
        result.microtasks.length > 0
      ) {
        setExpandedTasks({});
        setActiveTab("preview");
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setMtError("Something went wrong while generating microtasks.");
    } finally {
      setMtLoading(false);
    }
  }, [
    mtAssignmentName,
    mtCoachTone,
    mtCourseCode,
    mtCourseName,
    mtDescription,
    mtEfCapacity,
    mtFileBase64,
    mtFileLoading,
    mtFileMime,
    mtFileName,
    mtProcessingStyle,
  ]);

  const buildExportBundle = useCallback(() => {
    const now = new Date();
    return {
      exported_at: now.toISOString(),
      app: {
        name: "margati-microtasks-engine",
        view: "microtasks-sandbox",
      },
      request_context: {
        api_base_url: API_BASE,
        course: {
          id: "demo-course",
          name: mtCourseName,
          code: mtCourseCode,
        },
        assignment: {
          id: "demo-assignment",
          name: mtAssignmentName,
          description_html: mtDescription,
          attachment: mtFileName
            ? {
                filename: mtFileName,
                mime_type: mtFileMime,
                base64_present: !!mtFileBase64,
                base64_size_chars: mtFileBase64 ? mtFileBase64.length : 0,
              }
            : null,
        },
        dials: {
          academic_level: "high_school",
          support_level: DEFAULT_SUPPORT_LEVEL,
          ef_capacity: mtEfCapacity,
          processing_style: mtProcessingStyle,
          coach_tone: mtCoachTone,
        },
      },
      response_context: mtRawResponse,
      microtasks_output: mtResult,
    };
  }, [
    mtAssignmentName,
    mtCoachTone,
    mtCourseCode,
    mtCourseName,
    mtDescription,
    mtEfCapacity,
    mtFileBase64,
    mtFileMime,
    mtFileName,
    mtProcessingStyle,
    mtRawResponse,
    mtResult,
  ]);

  const exportJson = useCallback(() => {
    const bundle = buildExportBundle();
    const json = JSON.stringify(bundle, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (mtAssignmentName || "microtasks")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    a.href = url;
    a.download = `${safeName || "microtasks"}-bundle.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [buildExportBundle, mtAssignmentName]);

  const exportPdf = useCallback(() => {
    const bundle = buildExportBundle();
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 40;
    const marginTop = 48;

    const title = "Margati Microtasks Export";
    doc.setFontSize(16);
    doc.text(title, marginX, marginTop);

    doc.setFontSize(10);
    doc.setTextColor(80);
    doc.text(`Exported: ${bundle.exported_at}`, marginX, marginTop + 18);
    doc.text(
      `Course: ${bundle.request_context.course.name} (${bundle.request_context.course.code})`,
      marginX,
      marginTop + 34,
    );
    doc.text(
      `Assignment: ${bundle.request_context.assignment.name}`,
      marginX,
      marginTop + 50,
    );

    const dials = bundle.request_context.dials;
    doc.text(
      `Dials: academic_level=${dials.academic_level} · support_level=${dials.support_level} · ef=${dials.ef_capacity} · processing=${dials.processing_style} · tone=${dials.coach_tone}`,
      marginX,
      marginTop + 66,
      { maxWidth: pageWidth - marginX * 2 },
    );

    const tasks = (bundle.microtasks_output?.microtasks ?? []).map((t) => [
      String(t.sequence_id),
      t.work_phase,
      t.title,
      `${t.estimated_minutes}m`,
      `${Number.isFinite(t.weight_percentage) ? t.weight_percentage.toFixed(1) : t.weight_percentage}%`,
    ]);

    autoTable(doc, {
      head: [["#", "Phase", "Title", "Time", "Weight"]],
      body: tasks,
      startY: marginTop + 86,
      styles: { fontSize: 9, cellPadding: 6, overflow: "linebreak" },
      headStyles: { fillColor: [238, 242, 255], textColor: [17, 24, 39] },
      columnStyles: {
        0: { cellWidth: 28 },
        1: { cellWidth: 86 },
        3: { cellWidth: 48 },
        4: { cellWidth: 56 },
      },
    });

    let currentY = (doc as any).lastAutoTable?.finalY ?? marginTop + 86;
    const reasoning =
      bundle.microtasks_output?.uac_metadata?.pedagogical_reasoning;
    if (reasoning && typeof reasoning === "string" && reasoning.trim()) {
      doc.setFontSize(11);
      doc.setTextColor(17);
      currentY += 26;
      doc.text("Pedagogical reasoning", marginX, currentY);
      doc.setFontSize(9);
      doc.setTextColor(80);
      currentY += 16;
      doc.text(reasoning.trim(), marginX, currentY, {
        maxWidth: pageWidth - marginX * 2,
      });
      // Move task details to a fresh page so headings never collide with wrapped text.
      doc.addPage();
      currentY = marginTop;
    }

    const addWrapped = (
      text: string,
      x: number,
      y: number,
      maxWidth: number,
      lineHeight: number,
    ): number => {
      if (!text || !text.trim()) return y;
      const lines = doc.splitTextToSize(text.trim(), maxWidth) as string[];
      let cursorY = y;
      lines.forEach((line) => {
        if (cursorY + lineHeight > pageHeight - marginTop) {
          doc.addPage();
          cursorY = marginTop;
        }
        doc.text(line, x, cursorY);
        cursorY += lineHeight;
      });
      return cursorY;
    };

    const tasksDetailed = bundle.microtasks_output?.microtasks ?? [];
    if (tasksDetailed.length > 0) {
      const lineStep = 14;
      const smallStep = 12;
      const betweenTasks = 22;

      doc.setFontSize(12);
      doc.setTextColor(17);
      if (currentY + 30 > pageHeight - marginTop) {
        doc.addPage();
        currentY = marginTop;
      }
      doc.text("Task details", marginX, currentY);
      currentY += lineStep;

      tasksDetailed.forEach((t) => {
        if (currentY + 100 > pageHeight - marginTop) {
          doc.addPage();
          currentY = marginTop;
        }
        doc.setFontSize(11);
        doc.setTextColor(17);
        doc.text(`Task ${t.sequence_id} — ${t.title}`, marginX, currentY);
        currentY += lineStep;

        doc.setFontSize(9);
        doc.setTextColor(60);
        currentY = addWrapped(
          `Phase: ${t.work_phase}`,
          marginX,
          currentY,
          pageWidth - marginX * 2,
          smallStep,
        );
        const weightStr = Number.isFinite(t.weight_percentage)
          ? (t.weight_percentage as number).toFixed(1)
          : String(t.weight_percentage);
        currentY = addWrapped(
          `Time: ${t.estimated_minutes} min · Weight: ${weightStr}%`,
          marginX,
          currentY,
          pageWidth - marginX * 2,
          smallStep,
        );

        if (t.source_pointer) {
          currentY = addWrapped(
            `Source: ${t.source_pointer}`,
            marginX,
            currentY,
            pageWidth - marginX * 2,
            smallStep,
          );
        }

        if (t.concepts && t.concepts.length > 0) {
          currentY = addWrapped(
            `Concepts: ${t.concepts.join(", ")}`,
            marginX,
            currentY,
            pageWidth - marginX * 2,
            smallStep,
          );
        }

        if (t.scaffold_tip) {
          currentY = addWrapped(
            `Scaffold tip: ${t.scaffold_tip}`,
            marginX,
            currentY,
            pageWidth - marginX * 2,
            smallStep,
          );
        }

        if (t.decomposed_details && t.decomposed_details.length > 0) {
          doc.text("Breakdown:", marginX, currentY);
          currentY += smallStep;
          t.decomposed_details.forEach((d) => {
            if (currentY + lineStep > pageHeight - marginTop) {
              doc.addPage();
              currentY = marginTop;
            }
            currentY = addWrapped(
              `• ${d.title}: ${d.description}`,
              marginX + 12,
              currentY,
              pageWidth - marginX * 2 - 12,
              smallStep,
            );
          });
        }

        currentY += betweenTasks;
      });
    }

    const safeName = (mtAssignmentName || "microtasks")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    doc.save(`${safeName || "microtasks"}-microtasks.pdf`);
  }, [buildExportBundle, mtAssignmentName]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex justify-center px-4 py-8">
      <div className="w-full max-w-5xl bg-white border border-slate-200 rounded-2xl shadow-lg flex flex-col overflow-hidden">
        <header className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">
              Neuro Inclusive Calibration Engine
            </h1>
          </div>
          <div className="inline-flex items-center rounded-full bg-slate-100 p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab("calibration")}
              className={`px-3 py-1.5 rounded-full ${
                activeTab === "calibration"
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                  : "text-slate-500"
              }`}
            >
              Calibration Q&A
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("microtasks")}
              className={`px-3 py-1.5 rounded-full ${
                activeTab === "microtasks"
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                  : "text-slate-500"
              }`}
            >
              Microtasks Sandbox
            </button>
            <button
              type="button"
              onClick={() => hasMicrotasks && setActiveTab("preview")}
              className={`px-3 py-1.5 rounded-full ${
                activeTab === "preview"
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                  : hasMicrotasks
                    ? "text-slate-500"
                    : "text-slate-300 cursor-not-allowed opacity-50"
              }`}
              disabled={!hasMicrotasks}
            >
              Microtasks Preview
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-4">
          {activeTab === "calibration" && !hasStarted && !isFinished && (
            <div className="flex h-full items-center justify-center py-8">
              <div className="text-center space-y-4 max-w-md">
                <h2 className="text-base font-semibold text-slate-900">
                  Calibrate your study brain in 5 questions.
                </h2>
                <p className="text-sm text-slate-500">
                  We&apos;ll ask a few quick questions about how you start,
                  focus, process instructions, and plan. Your answers tune the
                  microtask engine to your neuro profile.
                </p>
                <button
                  type="button"
                  onClick={handleStart}
                  className="inline-flex items-center justify-center rounded-full bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 transition-colors"
                >
                  Start calibration
                </button>
              </div>
            </div>
          )}

          {activeTab === "calibration" && (
            <>
              <div className="space-y-3">
                {messages.map((m) => {
                  const isUser = m.role === "user";
                  const isAssistant = m.role === "assistant";
                  const isSystem = m.role === "system";

                  return (
                    <div
                      key={m.id}
                      className={`flex ${
                        isUser
                          ? "justify-end"
                          : isAssistant
                            ? "justify-start"
                            : "justify-center"
                      }`}
                    >
                      <div
                        className={`max-w-[80%] text-sm whitespace-pre-line ${
                          isUser
                            ? "bg-indigo-600 text-white rounded-2xl rounded-br-md px-3 py-2 shadow-sm"
                            : isAssistant
                              ? "bg-slate-100 text-slate-900 rounded-2xl rounded-bl-md px-3 py-2 shadow-sm border border-slate-200"
                              : "bg-slate-100 text-slate-600 rounded-xl px-3 py-2 border border-slate-200"
                        }`}
                      >
                        {m.content}
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>

              {options.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {options.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => handleOptionClick(opt)}
                      disabled={isStreaming}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs md:text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    >
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[0.65rem]">
                        {opt.key}
                      </span>
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === "microtasks" && (
            <div className="max-w-2xl space-y-3">
              {mtToast && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-800 flex items-start justify-between gap-2">
                  <div className="leading-relaxed">{mtToast}</div>
                  <button
                    type="button"
                    onClick={() => setMtToast(null)}
                    className="text-indigo-700 hover:text-indigo-900"
                  >
                    Dismiss
                  </button>
                </div>
              )}
              <h2 className="text-sm font-semibold text-slate-900">
                Assignment + Dials
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="text-slate-500">Course name</span>
                  <input
                    type="text"
                    value={mtCourseName}
                    onChange={(e) => setMtCourseName(e.target.value)}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-slate-500">Course code</span>
                  <input
                    type="text"
                    value={mtCourseCode}
                    onChange={(e) => setMtCourseCode(e.target.value)}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-slate-500">Assignment name</span>
                  <input
                    type="text"
                    value={mtAssignmentName}
                    onChange={(e) => setMtAssignmentName(e.target.value)}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-slate-500">Support level</span>
                  <select
                    value={DEFAULT_SUPPORT_LEVEL}
                    disabled
                    className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                  >
                    <option value="HIGH">HIGH – more scaffolding (default)</option>
                  </select>
                </label>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-xs">
                    Assignment description
                  </span>
                  <span className="text-[0.7rem] text-slate-400">
                    Rich text (HTML is sent to backend)
                  </span>
                </div>

                <div className="rounded-md border border-slate-300 bg-white overflow-hidden">
                  <ReactQuill
                    theme="snow"
                    value={mtDescription}
                    onChange={setMtDescription}
                    placeholder="Paste the assignment prompt or instructions here…"
                    modules={{
                      toolbar: [
                        ["bold", "italic", "underline"],
                        [{ list: "ordered" }, { list: "bullet" }],
                        ["link"],
                        ["clean"],
                      ],
                    }}
                    className="microtasks-quill"
                  />
                </div>

                {/* no preview – we send HTML directly to backend */}
              </div>

              <div className="flex items-center justify-between gap-2 text-[0.7rem] pt-1">
                <label className="flex items-center gap-2">
                  <span className="text-slate-500 whitespace-nowrap">
                    Attachment
                  </span>
                  <input
                    type="file"
                    accept="*/*"
                    onChange={handleFileChange}
                    className="block w-full text-[0.7rem] text-slate-600 file:mr-2 file:rounded-md file:border file:border-slate-300 file:bg-slate-50 file:px-2 file:py-1 file:text-[0.7rem] file:font-medium file:text-slate-700 hover:file:bg-slate-100"
                  />
                </label>
              </div>
              {mtFileName && (
                <div className="flex items-center justify-between gap-2 text-[0.7rem] text-slate-500">
                  <span className="truncate">
                    Attached:{" "}
                    <span className="font-medium text-slate-700">
                      {mtFileName}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setMtFileName(null);
                      setMtFileBase64(null);
                    }}
                    className="text-rose-500 hover:text-rose-600"
                  >
                    Remove
                  </button>
                </div>
              )}

              <h3 className="text-xs font-semibold text-slate-900 mt-2">
                Neuro dials (override from calibration)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="text-slate-500">EF capacity</span>
                  <select
                    value={mtEfCapacity}
                    onChange={(e) =>
                      setMtEfCapacity(
                        (e.target.value as NeuroMetrics["ef_capacity"]) ||
                          "moderate",
                      )
                    }
                    className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                  >
                    <option value="high">high</option>
                    <option value="moderate">moderate</option>
                    <option value="low">low</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-slate-500">Processing style</span>
                  <select
                    value={mtProcessingStyle}
                    onChange={(e) =>
                      setMtProcessingStyle(
                        (e.target.value as NeuroMetrics["processing_style"]) ||
                          "standard",
                      )
                    }
                    className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                  >
                    <option value="standard">standard</option>
                    <option value="high_friction">high_friction</option>
                    <option value="literal">literal</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-slate-500">Coach tone</span>
                  <select
                    value={mtCoachTone}
                    onChange={(e) =>
                      setMtCoachTone(
                        (e.target.value as NeuroMetrics["coach_tone"]) ||
                          "reassuring",
                      )
                    }
                    className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                  >
                    <option value="challenger">challenger</option>
                    <option value="reassuring">reassuring</option>
                    <option value="objective">objective</option>
                  </select>
                </label>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                    onClick={handleGenerateMicrotasks}
                    disabled={mtLoading || mtFileLoading}
                  className="inline-flex items-center justify-center rounded-full bg-indigo-600 px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {mtLoading ? "Generating…" : "Generate microtasks"}
                </button>
              </div>

              {mtError && (
                <p className="pt-1 text-xs text-rose-600 whitespace-pre-line">
                  {mtError}
                </p>
              )}
            </div>
          )}

          {activeTab === "preview" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  Microtasks preview
                </h2>
                {hasMicrotasks && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={exportJson}
                      className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                    >
                      Export JSON
                    </button>
                    <button
                      type="button"
                      onClick={exportPdf}
                      className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                    >
                      Export PDF
                    </button>
                  </div>
                )}
              </div>
              {!mtResult && !mtLoading && (
                <p className="text-xs text-slate-400">
                  Generate microtasks in the sandbox tab to see them here.
                </p>
              )}
              {mtLoading && (
                <p className="text-xs text-slate-500">
                  Talking to the microtask engine…
                </p>
              )}
              {mtResult &&
                Array.isArray(mtResult.microtasks) &&
                mtResult.microtasks.length > 0 && (
                  <div className="space-y-4 text-xs pr-1">
                    {mtResult.uac_metadata?.total_estimated_minutes != null && (
                      <p className="text-slate-500">
                        Total estimated time:{" "}
                        <span className="font-medium text-slate-900">
                          {mtResult.uac_metadata.total_estimated_minutes} mins
                        </span>
                      </p>
                    )}

                    {mtResult.microtasks.map((mt) => {
                      const expanded = !!expandedTasks[mt.sequence_id];
                      const requiresCount = mt.hierarchy?.requires
                        ? mt.hierarchy.requires.length
                        : 0;
                      return (
                        <div
                          key={mt.sequence_id}
                          className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-0.5">
                              <div className="text-[0.65rem] uppercase tracking-wide text-slate-400">
                                Task {mt.sequence_id}
                              </div>
                              <div className="text-[0.8rem] font-semibold text-slate-900">
                                {mt.title}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1 text-[0.7rem]">
                              <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[0.65rem] font-medium text-indigo-700 border border-indigo-100">
                                {mt.work_phase}
                              </span>
                              <span className="text-slate-500">
                                {mt.estimated_minutes} min ·{" "}
                                {mt.weight_percentage.toFixed(1)}%
                              </span>
                            </div>
                          </div>

                          <p className="mt-2 text-xs text-slate-700 leading-relaxed">
                            {mt.description}
                          </p>

                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.7rem] text-slate-500">
                            {mt.source_pointer && (
                              <span>
                                <span className="font-medium text-slate-700">
                                  Source:
                                </span>{" "}
                                {mt.source_pointer}
                              </span>
                            )}
                            {mt.hierarchy?.type && (
                              <span>
                                <span className="font-medium text-slate-700">
                                  Hierarchy:
                                </span>{" "}
                                {mt.hierarchy.type}
                                {requiresCount > 0
                                  ? ` (requires ${requiresCount})`
                                  : ""}
                              </span>
                            )}
                          </div>

                          {mt.concepts && mt.concepts.length > 0 && (
                            <p className="mt-2 text-[0.7rem] text-slate-500">
                              <span className="font-medium text-slate-700">
                                Concepts:
                              </span>{" "}
                              {mt.concepts.join(", ")}
                            </p>
                          )}

                          {mt.scaffold_tip && (
                            <p className="mt-1 text-[0.7rem] text-slate-500">
                              <span className="font-medium text-slate-700">
                                Scaffold tip:
                              </span>{" "}
                              {mt.scaffold_tip}
                            </p>
                          )}

                          {mt.decomposed_details &&
                            mt.decomposed_details.length > 0 && (
                              <div className="mt-2 space-y-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedTasks((prev) => ({
                                      ...prev,
                                      [mt.sequence_id]: !expanded,
                                    }))
                                  }
                                  className="text-[0.7rem] font-medium text-indigo-700 hover:text-indigo-800"
                                >
                                  {expanded
                                    ? "Hide breakdown"
                                    : `Show breakdown (${mt.decomposed_details.length})`}
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
                                          <span className="font-medium">
                                            {d.title}.
                                          </span>{" "}
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
                    })}
                  </div>
                )}
            </div>
          )}
        </main>

        <footer className="px-4 py-3 border-t border-slate-200 bg-slate-50">
          {activeTab === "calibration" ? (
            <div className="space-y-2">
              <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                  type="text"
                  placeholder={
                    isFinished
                      ? "Profile completed – refresh to start again"
                      : "Type your answer or add your own twist…"
                  }
                  value={currentInput}
                  onChange={(e) => setCurrentInput(e.target.value)}
                  disabled={isStreaming || isFinished}
                  className="flex-1 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!currentInput.trim() || isStreaming || isFinished}
                  className="inline-flex items-center justify-center rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {isStreaming ? "Streaming…" : "Send"}
                </button>
              </form>

              {isFinished && metrics && (
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={goToMicrotasksWithMetrics}
                    className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 transition-colors"
                  >
                    Generate microtasks
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[0.7rem] text-slate-400">
              Powered by the Margati microtasks engine · This sandbox uses a
              demo course/assignment id and does not write to Canvas.
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

export default App;
