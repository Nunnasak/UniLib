export const BUSINESS_TIME_ZONE = "Asia/Bangkok";

const DAY_IN_MILLISECONDS = 86_400_000;

const businessDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Returns the Bangkok calendar date as a UTC-midnight Date for Prisma @db.Date fields. */
export const getBusinessDate = (instant: Date = new Date()): Date => {
  const parts = businessDateFormatter.formatToParts(instant);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

  return new Date(
    Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)),
  );
};

export const addCalendarDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * DAY_IN_MILLISECONDS);

export const calendarDaysBetween = (later: Date, earlier: Date): number =>
  Math.max(
    0,
    Math.floor(
      (getBusinessDate(later).getTime() - getBusinessDate(earlier).getTime()) /
        DAY_IN_MILLISECONDS,
    ),
  );

export const calculateLateFine = (dueOn: Date, asOf: Date = new Date()): number =>
  Math.min(calendarDaysBetween(asOf, dueOn) * 10, 1_000);

export const toDateOnly = (date: Date): string => date.toISOString().slice(0, 10);
