import { InputError } from './payment';
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
export function businessDateRange(start?: unknown, end?: unknown): { gte?: Date; lt?: Date; lte?: Date } {
  const range: { gte?: Date; lt?: Date; lte?: Date } = {};
  const parse = (value: unknown) => {
    if (typeof value !== 'string') throw new InputError('Invalid date filter.');
    const date = new Date(dateOnly.test(value) ? `${value}T00:00:00+05:30` : value);
    if (!Number.isFinite(date.getTime())) throw new InputError('Invalid date filter.');
    return date;
  };
  if (start) range.gte = parse(start);
  if (end) {
    const date = parse(end);
    if (typeof end === 'string' && dateOnly.test(end)) range.lt = new Date(date.getTime() + 86400000);
    else range.lte = date;
  }
  return range;
}
export const businessDay = (value: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(value);
