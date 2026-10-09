export const COLORS = ["#f28eaa", "#82d9ad", "#85bdf3", "#f1d46f", "#c6a0ee", "#f5ad7c"];

export function boardDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export type Stroke = {
  strokeId: string;
  day: string;
  room: number;
  color: string;
  size: number;
  points: [number, number][];
};

export function validStroke(value: unknown): value is Stroke {
  if (!value || typeof value !== "object") return false;
  const stroke = value as Stroke;
  return typeof stroke.strokeId === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(stroke.strokeId)
    && typeof stroke.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stroke.day)
    && [1, 2, 3].includes(stroke.room) && COLORS.includes(stroke.color)
    && Number.isFinite(stroke.size) && stroke.size >= 0.0001 && stroke.size <= 0.04
    && Array.isArray(stroke.points) && stroke.points.length >= 1 && stroke.points.length <= 96
    && stroke.points.every((point) => Array.isArray(point) && point.length === 2
      && point.every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1));
}
