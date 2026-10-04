/* Камеры для кадров симулятора: позы { pos, target, fov } как функции пути тележки s.
 * Всё считается из env.sim.cart(s, code) — без состояния, поэтому кадр зависит только от времени.
 * Координаты симулятора: 1 = 1 м, y вверх, центр комнаты 8 × 6 м — (0, 0, 0). */
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

/** Рядом с тележкой, низко, как первый шот режима «кино»: side — с какой стороны (1 — слева по ходу) */
export function beside(sim, code, s, { side = -1, dist = 0.32, back = 0.12, y = 0.055, ahead = 0.45, fov = 50 } = {}) {
  const c = sim.cart(s, code);
  const pos = add(add(c.pos, c.side, side * dist), c.fwd, -back);
  pos[1] = y;
  const target = add(c.pos, c.fwd, ahead);
  target[1] = 0.05;
  return { pos, target, fov };
}

/** На борту: камера на тележке смотрит вдоль бокового луча (side 1 — левый прожектор) */
export function onboard(sim, code, s, { side = 1, y = 0.085, lookAhead = 0.25, fov = 58 } = {}) {
  const c = sim.cart(s, code);
  const pos = add(add(c.pos, c.fwd, -0.03), c.side, side * 0.012);
  pos[1] = y;
  const target = add(add(c.pos, c.side, side * 1.2), c.fwd, lookAhead);
  target[1] = 0.04;
  return { pos, target, fov };
}

/** Погоня: сзади-сверху */
export function chase(sim, code, s, { back = 0.6, side = 0.15, y = 0.32, fov = 50 } = {}) {
  const c = sim.cart(s, code);
  const pos = add(add(c.pos, c.fwd, -back), c.side, side);
  pos[1] = y;
  const target = add(c.pos, c.fwd, 0.35);
  target[1] = 0.03;
  return { pos, target, fov };
}

/** Общий план: облёт комнаты по эллипсу, a — угол, рад */
export function overview(a, { rx = 4.1, rz = 3.0, y = 2.3, fov = 50, target = [0, 0, 0] } = {}) {
  return { pos: [Math.cos(a) * rx, y, Math.sin(a) * rz], target, fov };
}

/** Плавный переход между двумя позами (k 0…1 уже сглажен снаружи) */
export function blend(a, b, k) {
  return { pos: mix(a.pos, b.pos, k), target: mix(a.target, b.target, k), fov: a.fov + (b.fov - a.fov) * k };
}
