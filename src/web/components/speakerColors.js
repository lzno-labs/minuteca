const PALETTE = [
  { dot: "bg-indigo-500", text: "text-indigo-700", soft: "bg-indigo-50", ring: "ring-indigo-200" },
  { dot: "bg-emerald-500", text: "text-emerald-700", soft: "bg-emerald-50", ring: "ring-emerald-200" },
  { dot: "bg-amber-500", text: "text-amber-700", soft: "bg-amber-50", ring: "ring-amber-200" },
  { dot: "bg-rose-500", text: "text-rose-700", soft: "bg-rose-50", ring: "ring-rose-200" },
  { dot: "bg-sky-500", text: "text-sky-700", soft: "bg-sky-50", ring: "ring-sky-200" },
  { dot: "bg-violet-500", text: "text-violet-700", soft: "bg-violet-50", ring: "ring-violet-200" },
  { dot: "bg-teal-500", text: "text-teal-700", soft: "bg-teal-50", ring: "ring-teal-200" },
  { dot: "bg-orange-500", text: "text-orange-700", soft: "bg-orange-50", ring: "ring-orange-200" },
];

export function speakerColor(speaker) {
  return PALETTE[Math.abs(speaker) % PALETTE.length];
}
