
export interface PassPerformanceMetrics {
  time: number;
  memory: number;
  additional?: Record<string, object>;
}

export class PerformanceMetrics {
  private metrics: Map<string, PassPerformanceMetrics> = new Map();

  add(name: string, time: number, memory: number, additional?: Record<string, object>) {
    this.metrics.set(name, { time, memory, additional });
  }

  get totalTime(): number {
    return Array.from(this.metrics.values())
      .reduce((acc, curr) => acc + curr.time, 0);
  }

  get totalMemory(): number {
    return Array.from(this.metrics.values())
      .reduce((acc, curr) => acc + curr.memory, 0);
  }
}
