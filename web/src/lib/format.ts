const UNITS = ['o', 'Ko', 'Mo', 'Go', 'To', 'Po'];

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toLocaleString('fr-FR', {maximumFractionDigits: unit ? 1 : 0})} ${UNITS[unit]}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return value.toLocaleString('fr-FR');
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) {
    return '—';
  }
  return ms < 1000
    ? `${ms.toLocaleString('fr-FR')} ms`
    : `${(ms / 1000).toFixed(2)} s`;
}

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) {
    return '—';
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days) {
    return `${days} j ${hours} h`;
  }
  if (hours) {
    return `${hours} h ${minutes} min`;
  }
  return `${minutes} min`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('fr-FR', {dateStyle: 'short', timeStyle: 'medium'});
}
