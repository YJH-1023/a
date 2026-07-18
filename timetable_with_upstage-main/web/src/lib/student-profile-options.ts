export interface YearOption {
  value: number;
  label: string;
}

export const ADMISSION_YEAR_OPTIONS = createDescendingYearOptions(2026, 2018);
export const COURSE_YEAR_OPTIONS = createDescendingYearOptions(2026, 2020);

export function parseDirectYear(value: string): number | null {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits ? Number(digits) : null;
}

function createDescendingYearOptions(maxYear: number, minYear: number): YearOption[] {
  return Array.from({ length: maxYear - minYear + 1 }, (_, index) => {
    const year = maxYear - index;
    return { value: year, label: `${year}년` };
  });
}
