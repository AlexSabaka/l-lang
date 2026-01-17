
import chalk from "chalk";

export interface PassPerformanceMetrics {
  time: number;
  memory: number;
  nodeCount?: number;
  visitCount?: number;
  additional?: Record<string, any>;
}

export interface PerformanceTimer {
  start: number;
  startMemory: number;
}

export class PerformanceMetrics {
  private metrics: Map<string, PassPerformanceMetrics> = new Map();
  private timers: Map<string, PerformanceTimer> = new Map();
  private enabled: boolean = false;
  private globalVisitCount: number = 0;

  constructor(enabled: boolean = false) {
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private getMemoryUsage(): number {
    const memUsage = process.memoryUsage();
    return memUsage.heapUsed;
  }

  startTimer(passName: string): void {
    if (!this.enabled) return;
    
    this.timers.set(passName, {
      start: performance.now(),
      startMemory: this.getMemoryUsage()
    });
  }

  endTimer(passName: string, nodeCount?: number, visitCount?: number, additional?: Record<string, any>): void {
    if (!this.enabled) return;

    const timer = this.timers.get(passName);
    if (!timer) {
      console.warn(`Performance timer not started for pass: ${passName}`);
      return;
    }

    const endTime = performance.now();
    const endMemory = this.getMemoryUsage();
    
    const time = endTime - timer.start;
    const memory = endMemory - timer.startMemory;

    this.metrics.set(passName, {
      time,
      memory,
      nodeCount,
      visitCount,
      additional
    });

    this.timers.delete(passName);
  }

  recordVisit(): void {
    if (!this.enabled) return;
    this.globalVisitCount++;
  }

  addPassMetrics(name: string, time: number, memory: number, nodeCount?: number, visitCount?: number, additional?: Record<string, any>): void {
    if (!this.enabled) return;
    
    this.metrics.set(name, { 
      time, 
      memory, 
      nodeCount, 
      visitCount, 
      additional 
    });
  }

  getPassMetrics(passName: string): PassPerformanceMetrics | undefined {
    return this.metrics.get(passName);
  }

  getAllMetrics(): Map<string, PassPerformanceMetrics> {
    return new Map(this.metrics);
  }

  get totalTime(): number {
    return Array.from(this.metrics.values())
      .reduce((acc, curr) => acc + curr.time, 0);
  }

  get totalMemory(): number {
    return Array.from(this.metrics.values())
      .reduce((acc, curr) => acc + curr.memory, 0);
  }

  get totalNodeCount(): number {
    return Array.from(this.metrics.values())
      .reduce((acc, curr) => acc + (curr.nodeCount || 0), 0);
  }

  get totalVisitCount(): number {
    const passVisits = Array.from(this.metrics.values())
      .reduce((acc, curr) => acc + (curr.visitCount || 0), 0);
    return Math.max(passVisits, this.globalVisitCount);
  }

  private formatTime(ms: number): string {
    if (ms < 1) return `${(ms * 1000).toFixed(1)}μs`;
    if (ms < 1000) return `${ms.toFixed(2)}ms`;
    return `${(ms / 1000).toFixed(3)}s`;
  }

  private formatMemory(bytes: number): string {
    const abs = Math.abs(bytes);
    if (abs < 1024) return `${bytes}B`;
    if (abs < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }

  private formatPercentage(value: number, total: number): string {
    if (total === 0) return "0%";
    return `${((value / total) * 100).toFixed(1)}%`;
  }

  generateReport(): string {
    if (!this.enabled || this.metrics.size === 0) {
      return chalk.yellow("Performance metrics not enabled or no data collected");
    }

    const lines: string[] = [];
    const totalTime = this.totalTime;
    const totalMemory = this.totalMemory;
    const totalNodes = this.totalNodeCount;
    const totalVisits = this.totalVisitCount;

    lines.push(chalk.bold.cyan("🔍 L-Lang Compiler Performance Report"));
    lines.push(chalk.gray("=" .repeat(60)));
    
    // Summary
    lines.push(chalk.bold("\n📊 Overall Summary"));
    lines.push(`Total compilation time: ${chalk.green(this.formatTime(totalTime))}`);
    lines.push(`Total memory delta: ${totalMemory >= 0 ? chalk.red('+' + this.formatMemory(totalMemory)) : chalk.green(this.formatMemory(totalMemory))}`);
    lines.push(`Total nodes processed: ${chalk.blue(totalNodes.toLocaleString())}`);
    lines.push(`Total visit operations: ${chalk.blue(totalVisits.toLocaleString())}`);

    if (totalNodes > 0) {
      lines.push(`Average time per node: ${chalk.yellow(this.formatTime(totalTime / totalNodes))}`);
    }
    if (totalVisits > 0) {
      lines.push(`Average time per visit: ${chalk.yellow(this.formatTime(totalTime / totalVisits))}`);
    }

    // Pass-by-pass breakdown
    lines.push(chalk.bold("\n⏱️  Pass-by-Pass Breakdown"));
    lines.push(chalk.gray("-".repeat(60)));

    const sortedPasses = Array.from(this.metrics.entries())
      .sort(([,a], [,b]) => b.time - a.time);

    for (const [passName, metrics] of sortedPasses) {
      const timePercent = this.formatPercentage(metrics.time, totalTime);
      const memoryDelta = metrics.memory >= 0 ? `+${this.formatMemory(metrics.memory)}` : this.formatMemory(metrics.memory);
      
      lines.push(chalk.bold(`\n${passName.toUpperCase()}:`));
      lines.push(`  Time: ${chalk.green(this.formatTime(metrics.time))} ${chalk.gray(`(${timePercent})`)}`);
      lines.push(`  Memory: ${metrics.memory >= 0 ? chalk.red(memoryDelta) : chalk.green(memoryDelta)}`);
      
      if (metrics.nodeCount !== undefined) {
        lines.push(`  Nodes: ${chalk.blue(metrics.nodeCount.toLocaleString())}`);
        if (metrics.nodeCount > 0) {
          lines.push(`  Time/Node: ${chalk.yellow(this.formatTime(metrics.time / metrics.nodeCount))}`);
        }
      }
      
      if (metrics.visitCount !== undefined) {
        lines.push(`  Visits: ${chalk.blue(metrics.visitCount.toLocaleString())}`);
        if (metrics.visitCount > 0) {
          lines.push(`  Time/Visit: ${chalk.yellow(this.formatTime(metrics.time / metrics.visitCount))}`);
        }
      }

      if (metrics.additional) {
        for (const [key, value] of Object.entries(metrics.additional)) {
          lines.push(`  ${key}: ${chalk.magenta(String(value))}`);
        }
      }
    }

    // Performance insights
    lines.push(chalk.bold("\n💡 Performance Insights"));
    lines.push(chalk.gray("-".repeat(60)));

    if (sortedPasses.length > 0) {
      const slowestPass = sortedPasses[0];
      const slowestPercent = this.formatPercentage(slowestPass[1].time, totalTime);
      lines.push(`• Slowest pass: ${chalk.red(slowestPass[0])} ${chalk.gray(`(${slowestPercent} of total time)`)}`);
      
      if (parseFloat(slowestPercent) > 50) {
        lines.push(`  ${chalk.yellow("⚠️  This pass accounts for over 50% of compilation time")}`);
      }
    }

    const memoryIntensivePasses = sortedPasses
      .filter(([, metrics]) => metrics.memory > 1024 * 1024) // > 1MB
      .slice(0, 3);
    
    if (memoryIntensivePasses.length > 0) {
      lines.push(`• Memory-intensive passes:`);
      memoryIntensivePasses.forEach(([name, metrics]) => {
        lines.push(`  - ${chalk.red(name)}: ${chalk.red('+' + this.formatMemory(metrics.memory))}`);
      });
    }

    if (totalTime > 1000) { // > 1 second
      lines.push(`${chalk.yellow("⚠️  Long compilation time detected")} ${chalk.gray("(>1s)")}`);
    }

    lines.push(chalk.gray("\n" + "=".repeat(60)));
    lines.push(chalk.gray(`Generated at ${new Date().toISOString()}`));

    return lines.join('\n');
  }

  // Export metrics as structured data
  exportMetrics(): {
    summary: {
      totalTime: number;
      totalMemory: number;
      totalNodes: number;
      totalVisits: number;
      averageTimePerNode: number;
      averageTimePerVisit: number;
    };
    passes: Record<string, PassPerformanceMetrics>;
    timestamp: string;
  } {
    const totalTime = this.totalTime;
    const totalNodes = this.totalNodeCount;
    const totalVisits = this.totalVisitCount;

    return {
      summary: {
        totalTime,
        totalMemory: this.totalMemory,
        totalNodes,
        totalVisits,
        averageTimePerNode: totalNodes > 0 ? totalTime / totalNodes : 0,
        averageTimePerVisit: totalVisits > 0 ? totalTime / totalVisits : 0
      },
      passes: Object.fromEntries(this.metrics),
      timestamp: new Date().toISOString()
    };
  }

  clear(): void {
    this.metrics.clear();
    this.timers.clear();
    this.globalVisitCount = 0;
  }

  // Legacy compatibility methods
  add(name: string, time: number, memory: number, additional?: Record<string, any>) {
    this.addPassMetrics(name, time, memory, undefined, undefined, additional);
  }
}
