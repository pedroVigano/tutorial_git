// Limitador simples (token bucket): o Notion aceita ~3 req/s em média por integração.
// Leituras e gravações dividem o mesmo limitador.
export function createLimiter({ ratePerSec = 3, burst = 3, concurrency = 3 } = {}) {
  let tokens = burst;
  let last = Date.now();
  let running = 0;
  const queue = [];
  let timer = null;

  const refill = () => {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * ratePerSec);
    last = now;
  };

  const pump = () => {
    timer = null;
    refill();
    while (queue.length && tokens >= 1 && running < concurrency) {
      tokens -= 1;
      running += 1;
      const { fn, resolve, reject } = queue.shift();
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => { running -= 1; schedule(); });
    }
    if (queue.length) schedule();
  };

  const schedule = () => {
    if (timer || !queue.length) return;
    const wait = tokens >= 1 ? 0 : Math.ceil(((1 - tokens) / ratePerSec) * 1000);
    timer = setTimeout(pump, wait);
  };

  return {
    run(fn) {
      return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        schedule();
      });
    },
    get pending() { return queue.length + running; },
  };
}

// Sem limite (testes e modo fixture).
export const noLimiter = { run: (fn) => Promise.resolve().then(fn), pending: 0 };
