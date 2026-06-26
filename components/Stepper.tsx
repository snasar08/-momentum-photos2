import { Phase } from "@/lib/types";

const STEPS: { phase: Phase; label: string }[] = [
  { phase: "upload", label: "Upload" },
  { phase: "review", label: "Review Duplicates" },
  { phase: "enhance", label: "Enhance" },
  { phase: "faces", label: "Tag Faces" },
  { phase: "configure", label: "Configure Crop" },
  { phase: "process", label: "Process & Export" },
];

export default function Stepper({ current }: { current: Phase }) {
  const currentIndex = STEPS.findIndex((s) => s.phase === current);
  return (
    <ol className="stepper">
      {STEPS.map((step, i) => {
        const state = i === currentIndex ? "active" : i < currentIndex ? "done" : "";
        return (
          <li key={step.phase} className={`stepper-item ${state}`}>
            <span className="stepper-dot">{i < currentIndex ? "✓" : i + 1}</span>
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}
