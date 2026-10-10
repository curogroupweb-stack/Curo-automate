// Cálculo de la próxima ejecución en hora de Madrid.
// config: { frequency: 'hourly'|'daily'|'weekly'|'monthly', time: 'HH:MM', weekday: 1-7 (1=lunes), monthday: 1-28 }
const TZ = 'Europe/Madrid';

function madridParts(date) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, wd };
}

// Convierte una fecha/hora "de reloj" de Madrid a instante UTC.
function madridToUtc(y, m, d, h, min) {
  let guess = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 2; i++) {
    const p = madridParts(new Date(guess));
    const diff = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - guess;
    guess = Date.UTC(y, m - 1, d, h, min) - diff;
  }
  return new Date(guess);
}

function nextRun(config = {}, from = new Date()) {
  const freq = config.frequency || 'daily';
  const [hh, mm] = String(config.time || '09:00').split(':').map(n => parseInt(n, 10) || 0);
  if (freq === 'hourly') {
    const t = new Date(from.getTime());
    t.setUTCMinutes(Number.isFinite(mm) ? mm : 0, 0, 0);
    if (t <= from) t.setUTCHours(t.getUTCHours() + 1);
    return t;
  }
  const now = madridParts(from);
  for (let add = 0; add < 400; add++) {
    const base = new Date(Date.UTC(now.y, now.m - 1, now.d + add, 12));
    const y = base.getUTCFullYear(), m = base.getUTCMonth() + 1, d = base.getUTCDate();
    const wd = ((base.getUTCDay() + 6) % 7) + 1;
    if (freq === 'weekly' && wd !== (Number(config.weekday) || 1)) continue;
    if (freq === 'monthly' && d !== Math.min(Number(config.monthday) || 1, 28)) continue;
    const candidate = madridToUtc(y, m, d, hh, mm);
    if (candidate > from) return candidate;
  }
  return new Date(from.getTime() + 86400000);
}

const DAYS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
function describe(config = {}) {
  const t = config.time || '09:00';
  switch (config.frequency) {
    case 'hourly': return 'Cada hora';
    case 'weekly': return `Cada ${DAYS[Number(config.weekday) || 1]} a las ${t}`;
    case 'monthly': return `El día ${Math.min(Number(config.monthday) || 1, 28)} de cada mes a las ${t}`;
    default: return `Cada día a las ${t}`;
  }
}

module.exports = { nextRun, describe };
