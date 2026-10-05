import type { Stroke } from '../../shared/protocol.js';

const SAFE_COLORS = new Set(['#111827', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7']);

export function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 18;
}

export function validCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z2-9]{4,6}$/.test(value);
}

export function validGuess(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 40;
}

export function validStroke(value: unknown): value is Stroke {
  if (!value || typeof value !== 'object') return false;
  const stroke = value as Stroke;
  if (!Array.isArray(stroke.points) || stroke.points.length < 1 || stroke.points.length > 80) return false;
  if (!SAFE_COLORS.has(stroke.color) || typeof stroke.width !== 'number' || stroke.width < 1 || stroke.width > 20) return false;
  return stroke.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
}
