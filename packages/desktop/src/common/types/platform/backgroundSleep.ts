/** Approximate aggregate Electron process readings, not unique physical RAM. */
export type SleepResourceReading = Readonly<{
  sampledAt: number;
  workingSetMB: number;
  cpuPercent: number;
  processCount: number;
}>;

export type BackgroundSleepMetrics = Readonly<{
  mode: 'awake' | 'sleeping';
  before: SleepResourceReading | null;
  after: SleepResourceReading | null;
  current: SleepResourceReading;
  savedWorkingSetMB: number | null;
  savedWorkingSetPercent: number | null;
  sampling: boolean;
}>;
