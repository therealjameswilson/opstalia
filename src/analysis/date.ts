export interface NormalizedDate {
  iso?: string;
  precision: "day" | "month" | "year" | "range" | "unknown";
  display: string;
}

const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12"
};

export function normalizeDate(input?: string | null): NormalizedDate {
  const display = (input ?? "").trim();
  if (!display) return { display: "", precision: "unknown" };
  const isoDay = display.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoDay) return { display, iso: `${isoDay[1]}-${isoDay[2]}-${isoDay[3]}`, precision: "day" };
  const isoMonth = display.match(/\b(\d{4})-(\d{2})\b/);
  if (isoMonth) return { display, iso: `${isoMonth[1]}-${isoMonth[2]}`, precision: "month" };
  const wordDay = display.match(
    /\b(?:(\d{1,2})\s+([A-Za-z]+)|([A-Za-z]+)\s+(\d{1,2}),?)\s+(\d{4})\b/
  );
  if (wordDay) {
    const day = (wordDay[1] ?? wordDay[4]).padStart(2, "0");
    const month = MONTHS[(wordDay[2] ?? wordDay[3]).toLocaleLowerCase()];
    if (month) return { display, iso: `${wordDay[5]}-${month}-${day}`, precision: "day" };
  }
  const wordMonth = display.match(/\b([A-Za-z]+)\s+(\d{4})\b/);
  if (wordMonth && MONTHS[wordMonth[1].toLocaleLowerCase()]) {
    return { display, iso: `${wordMonth[2]}-${MONTHS[wordMonth[1].toLocaleLowerCase()]}`, precision: "month" };
  }
  const years = [...display.matchAll(/\b(18|19|20)\d{2}\b/g)].map((match) => match[0]);
  if (years.length > 1) return { display, iso: `${years[0]}/${years.at(-1)}`, precision: "range" };
  if (years.length === 1) return { display, iso: years[0], precision: "year" };
  return { display, precision: "unknown" };
}
