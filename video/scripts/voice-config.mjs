/* Настройки озвучки ролика: общий video/voice.config.json и, поверх него, необязательный
 * video/films/<id>/voice.config.json — свой голос, манера, скорость, громкость музыки.
 * Объекты (voice, instructions, music, sfx, verify) сливаются по ключам: в файле ролика
 * достаточно указать только то, что отличается, например
 *   { "voice": { "ru": "Kore" }, "speed": 1.1, "music": { "gain": -1 } } */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));

export function voiceConfig(id) {
  const base = read(join(ROOT, 'voice.config.json'));
  if (!id) return base;
  const file = join(ROOT, 'films', id, 'voice.config.json');
  if (!existsSync(file)) return base;
  const own = read(file);
  const out = { ...base };
  for (const [k, v] of Object.entries(own)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? { ...base[k], ...v } : v;
  }
  return out;
}
