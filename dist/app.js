const $ = (id) => document.getElementById(id);
const slider = $('distance');
let frame = null;
let noticeTimer;
function render() {
  const h = Number(slider.value), x = 220 + 120 * h, y = 340 - 36 * (1 + h) ** 2;
  $('point-b').setAttribute('cx', x); $('point-b').setAttribute('cy', y);
  $('b-label').setAttribute('x', x + 14); $('b-label').setAttribute('y', y - 7);
  $('triangle').setAttribute('d', `M220 304H${x}V${y}`);
  $('h-label').setAttribute('x', 220 + 60 * h);
  const slope = 2 + h;
  $('secant').setAttribute('y1', 304 - .3 * slope * (135 - 220));
  $('secant').setAttribute('y2', 304 - .3 * slope * (420 - 220));
  $('slope').textContent = slope.toFixed(2); $('h-value').textContent = h.toFixed(2);
  slider.setAttribute('aria-valuetext', `h equals ${h.toFixed(2)}, slope equals ${slope.toFixed(2)}`);
}
function stop() { if (frame !== null) cancelAnimationFrame(frame); frame = null; $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Play sample animation'); }
slider.addEventListener('input', () => { stop(); render(); });
$('reset').addEventListener('click', () => { stop(); slider.value = '1'; render(); });
$('play').addEventListener('click', () => {
  if (frame !== null) { stop(); return; }
  const start = performance.now(), initial = Number(slider.value) <= .03 ? 1 : Number(slider.value);
  $('play').textContent = 'Ⅱ'; $('play').setAttribute('aria-label', 'Pause sample animation');
  function tick(now) { const p = Math.min((now - start) / 5000, 1); slider.value = initial + (.02 - initial) * p; render(); if (p < 1) frame = requestAnimationFrame(tick); else stop(); }
  frame = requestAnimationFrame(tick);
});
const explanations = ['Pick two points on our curve. The line between them gives us the average rate of change.', 'From A to B, divide the change in height by the change in x. With h = 1, our slope is 3.', 'Move B toward A. As h gets smaller, the secant line gets closer to the tangent at A.', 'As h approaches zero, the slope approaches 2. For f(x) = x², the derivative at x = 1 is exactly 2.'];
document.querySelectorAll('.lesson').forEach(button => button.addEventListener('click', () => {
  stop(); document.querySelectorAll('.lesson').forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
  button.classList.add('active'); button.setAttribute('aria-current', 'step');
  const step = Number(button.dataset.step);
  $('chapter-label').textContent = `${String(step + 1).padStart(2, '0')} — ${button.children[1].firstChild.textContent}`;
  document.querySelector('.section-label span').textContent = `${String(step + 1).padStart(2, '0')} / 04`;
  $('explanation').textContent = explanations[step];
  $('narration').textContent = ['“Now, what happens if we bring these two points closer together?”', '“The rise divided by the run. Two points tell us the average change.”', '“Keep your eye on the line as the distance between our points shrinks.”', '“That’s a derivative: the rate of change at one particular moment.”'][step];
  slider.value = [1, 1, .4, .02][step]; render();
}));
$('ask').addEventListener('click', () => { clearTimeout(noticeTimer); $('notice').textContent = 'Voice tutoring is coming next. Explore the sample lesson and graph for now.'; noticeTimer = setTimeout(() => { $('notice').textContent = ''; }, 5000); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
render();
