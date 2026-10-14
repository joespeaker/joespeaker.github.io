// Lookahead scheduler (the "two clocks" pattern): a JS timer wakes every 25ms and
// schedules any 16th-note steps that fall in the next 100ms on the audio clock.
// Timing comes from the audio clock, so loops stay tight and never drift.

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.1;

export class Scheduler {
  constructor(ctx, { onStep, getTempo, getTotalSteps }) {
    this.ctx = ctx;
    this.onStep = onStep;           // (stepIndex, audioTime, stepDuration) => void
    this.getTempo = getTempo;
    this.getTotalSteps = getTotalSteps;
    this.timer = null;
    this.running = false;
    this.visualQueue = [];          // [{ step, time }] for the playhead
  }

  stepDuration() {
    return 60 / this.getTempo() / 4; // 16th note
  }

  start(startStep = 0) {
    if (this.running) return;
    this.running = true;
    this.step = startStep;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.visualQueue = [];
    this.tick();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
    this.visualQueue = [];
  }

  tick() {
    if (!this.running) return;
    const horizon = this.ctx.currentTime + SCHEDULE_AHEAD;
    while (this.nextTime < horizon) {
      const dur = this.stepDuration();
      this.onStep(this.step, this.nextTime, dur);
      this.visualQueue.push({ step: this.step, time: this.nextTime });
      this.nextTime += dur;
      this.step = (this.step + 1) % this.getTotalSteps();
    }
    this.timer = setTimeout(() => this.tick(), LOOKAHEAD_MS);
  }

  // The step currently sounding, for drawing the playhead. Returns null before the first.
  currentStep() {
    const now = this.ctx.currentTime;
    let current = null;
    while (this.visualQueue.length && this.visualQueue[0].time <= now) {
      current = this.visualQueue.shift();
    }
    if (current) this.lastVisual = current;
    return this.lastVisual ? this.lastVisual.step : null;
  }
}
