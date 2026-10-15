/**
 * Read-only System Monitor in the persistent right rail.
 * This reuses the trusted System Insight IPC sampler rather than starting a
 * second polling loop or exposing OS process-control operations to the rail.
 */
import type { HubActivityItem } from '@/common/types/agent/hubActivity';
import { useSystemMetrics } from '@/renderer/pages/settings/ResourceSettings/system/useSystemMetrics';
import Sparkline from '@/renderer/pages/settings/ResourceSettings/system/Sparkline';
import {
  Activity,
  Battery,
  Cpu,
  ExternalLink,
  HardDrive,
  MemoryStick,
  Monitor,
  Search,
  Server,
  Wifi,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  monitorActiveTasks,
  monitorMemory,
  monitorRate,
  monitorPercent,
  monitorProcesses,
  type MonitorProcessSort,
} from './systemMonitorModel';

type Props = {
  activities: readonly HubActivityItem[];
  onOpenActivity?: (item: HubActivityItem) => void;
};

const cap = (value: number): string => monitorPercent(value).toFixed(0);

const Usage: React.FC<{
  label: string;
  percent: number;
  subtitle: string;
  series: number[];
  icon: React.ReactNode;
}> = ({ label, percent, subtitle, series, icon }) => (
  <div className='hub-system-usage'>
    <div className='hub-system-usage-head'>
      <span className='hub-system-usage-label'>
        {icon}
        {label}
      </span>
      <strong>{cap(percent)}%</strong>
    </div>
    <div
      className='hub-system-progress'
      role='progressbar'
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={monitorPercent(percent)}
    >
      <span style={{ width: `${monitorPercent(percent)}%` }} />
    </div>
    <div className='hub-system-usage-footer'>
      <small>{subtitle}</small>
      <div className='hub-system-sparkline' aria-hidden='true'>
        <Sparkline values={series} height={25} width={98} colorClass='hub-system-sparkline-color' />
      </div>
    </div>
  </div>
);

/** System-wide OS telemetry is optional and never persisted to the Agent snapshot. */
export const HubSystemMonitor: React.FC<Props> = ({ activities, onOpenActivity }) => {
  const { t } = useTranslation();
  const { status, staticInfo, live, history, refreshStatic } = useSystemMetrics();
  const [sort, setSort] = useState<MonitorProcessSort>('cpu');
  const [query, setQuery] = useState('');
  const [processScope, setProcessScope] = useState<'os' | 'tomni'>('os');
  const [refreshing, setRefreshing] = useState(false);

  const label = (key: string, fallback: string): string =>
    t(`guid.hubHome.systemMonitor.${key}`, { defaultValue: fallback });
  const activeTasks = useMemo(() => monitorActiveTasks(activities), [activities]);
  const host = live?.hostTelemetry ?? null;
  const allProcesses = host?.processes ?? null;
  const filteredProcesses = useMemo(
    () =>
      processScope === 'os'
        ? monitorProcesses(allProcesses ?? [], query, sort)
        : monitorProcesses(live?.processes ?? [], query, sort),
    [allProcesses, live?.processes, processScope, query, sort]
  );
  const processCount = processScope === 'os' ? (allProcesses?.length ?? null) : (live?.processes.length ?? 0);
  const telemetryStale = host !== null && Date.now() - host.sampledAt > 30000;
  const cpuSeries = useMemo(() => history.map((point) => point.cpu), [history]);
  const memorySeries = useMemo(() => history.map((point) => point.mem), [history]);
  const stale = live !== null && Date.now() - live.sampledAt > 15000;
  const disk = staticInfo?.disks.find((volume) => volume.totalMB > 0);
  const diskUsed = disk ? Math.max(0, disk.totalMB - disk.freeMB) : 0;

  const refresh = (): void => {
    if (refreshing) return;
    setRefreshing(true);
    void refreshStatic()
      .catch((): undefined => undefined)
      .finally(() => setRefreshing(false));
  };

  return (
    <section className='hub-system-monitor' data-testid='hub-system-monitor'>
      <header className='hub-system-header'>
        <div>
          <strong>{label('title', 'System Monitor')}</strong>
          <small>{label('subtitle', 'Tài nguyên máy & hoạt động Tomni')}</small>
        </div>
        <span
          className={`hub-system-refresh-state ${stale || status === 'error' ? 'hub-system-refresh-state--stale' : ''}`}
          role='status'
        >
          {status === 'loading'
            ? label('loading', 'Đang lấy số liệu…')
            : status === 'error'
              ? label('error', 'Không kết nối được')
              : !live || stale
                ? label('stale', 'Chờ dữ liệu mới')
                : label('live', 'Trực tiếp')}
        </span>
      </header>
      {live ? (
        <>
          <div className='hub-system-usage-grid'>
            <Usage
              label={label('cpu', 'CPU')}
              percent={live.cpu.overallPercent}
              subtitle={staticInfo?.cpu.model ?? label('totalCpu', 'Toàn máy')}
              series={cpuSeries}
              icon={<Cpu size={14} />}
            />
            <Usage
              label={label('memory', 'RAM')}
              percent={live.memory.usedPercent}
              subtitle={`${monitorMemory(live.memory.usedMB)} / ${monitorMemory(live.memory.totalMB)}`}
              series={memorySeries}
              icon={<MemoryStick size={14} />}
            />
          </div>
          <div className='hub-system-io-grid' data-testid='hub-system-throughput'>
            <div className='hub-system-io-item'>
              <span>
                <Monitor size={13} />
                {label('gpuEngine', 'Đỉnh GPU engine')}
              </span>
              <strong>
                {host && !telemetryStale && host.gpuEnginePeakPercent !== null
                  ? `${cap(host.gpuEnginePeakPercent)}%`
                  : label('notAvailable', 'Không khả dụng')}
              </strong>
              <small>{label('gpuScope', 'Đỉnh GPU engine quan sát được; không phải mức GPU tổng.')}</small>
            </div>
            <div className='hub-system-io-item'>
              <span>
                <HardDrive size={13} />
                {label('diskTraffic', 'I/O ổ đĩa')}
              </span>
              <strong>↓ {monitorRate(host && !telemetryStale ? (host.disk?.readBytesPerSec ?? null) : null)}</strong>
              <strong>↑ {monitorRate(host && !telemetryStale ? (host.disk?.writeBytesPerSec ?? null) : null)}</strong>
            </div>
            <div className='hub-system-io-item'>
              <span>
                <Wifi size={13} />
                {label('networkTraffic', 'Lưu lượng mạng')}
              </span>
              <strong>
                ↓ {monitorRate(host && !telemetryStale ? (host.network?.receiveBytesPerSec ?? null) : null)}
              </strong>
              <strong>↑ {monitorRate(host && !telemetryStale ? (host.network?.sendBytesPerSec ?? null) : null)}</strong>
            </div>
          </div>
          <div className='hub-system-smallfacts'>
            <span>
              <Server size={13} />
              {label('uptime', 'Uptime')}: {Math.floor(live.uptimeSec / 3600)}h{' '}
              {Math.floor((live.uptimeSec % 3600) / 60)}m
            </span>
            <span>
              <Battery size={13} />
              {live.power.onBattery ? label('battery', 'Đang dùng pin') : label('ac', 'Nguồn điện')}
            </span>
          </div>
          {live.cpu.perCorePercent.length > 0 && (
            <div className='hub-system-section'>
              <div className='hub-system-section-heading'>
                <strong>{label('cores', 'Tải từng lõi CPU')}</strong>
                <small>
                  {live.cpu.perCorePercent.length} {label('logicalCores', 'luồng')}
                </small>
              </div>
              <div className='hub-system-core-grid'>
                {live.cpu.perCorePercent.slice(0, 16).map((value, index) => (
                  <div className='hub-system-core' key={index} title={`CPU ${index + 1}: ${cap(value)}%`}>
                    <span>{index + 1}</span>
                    <div className='hub-system-progress'>
                      <span style={{ width: `${monitorPercent(value)}%` }} />
                    </div>
                    <small>{cap(value)}%</small>
                  </div>
                ))}
              </div>
              {live.cpu.perCorePercent.length > 16 && <small>{label('coresMore', 'Hiển thị 16 luồng đầu')}</small>}
            </div>
          )}
        </>
      ) : (
        <p className='hub-system-note' role='status'>
          {status === 'error'
            ? label('unavailable', 'Không tải được số liệu hệ thống.')
            : label('loading', 'Đang lấy số liệu…')}
        </p>
      )}

      <div className='hub-system-section'>
        <div className='hub-system-section-heading'>
          <strong>{label('hardware', 'Phần cứng')}</strong>
          <button
            type='button'
            onClick={refresh}
            disabled={refreshing}
            title={label('refresh', 'Làm mới thông tin phần cứng')}
          >
            {refreshing ? label('refreshing', 'Đang cập nhật…') : label('refresh', 'Làm mới')}
          </button>
        </div>
        {staticInfo ? (
          <div className='hub-system-hardware'>
            <span>
              <Monitor size={14} />
              <span>{label('os', 'Hệ điều hành')}</span>
              <strong title={staticInfo.os.version}>
                {staticInfo.os.type} · {staticInfo.os.arch}
              </strong>
            </span>
            <span>
              <Cpu size={14} />
              <span>{label('processor', 'Bộ xử lý')}</span>
              <strong title={staticInfo.cpu.model}>
                {staticInfo.cpu.logicalCores} {label('logicalCores', 'luồng')}
              </strong>
            </span>
            <span>
              <Monitor size={14} />
              <span>{label('gpu', 'GPU')}</span>
              <strong title={staticInfo.gpus.map((gpu) => gpu.model).join(', ') || undefined}>
                {staticInfo.gpus[0]?.model || label('unknown', 'Chưa có dữ liệu')}
              </strong>
            </span>
            <span>
              <HardDrive size={14} />
              <span>{label('disk', 'Ổ đĩa')}</span>
              <strong title={disk?.mount}>
                {disk
                  ? `${monitorMemory(diskUsed)} / ${monitorMemory(disk.totalMB)}`
                  : label('unknown', 'Chưa có dữ liệu')}
              </strong>
            </span>
            <span>
              <Wifi size={14} />
              <span>{label('network', 'Bộ điều hợp mạng')}</span>
              <strong>{staticInfo.network.length}</strong>
            </span>
          </div>
        ) : (
          <p className='hub-system-note'>{label('hardwareWaiting', 'Đang đọc thông tin phần cứng…')}</p>
        )}
        <small className='hub-system-note'>
          {label(
            'hardwareScope',
            'Thông số GPU engine, ổ đĩa và mạng chỉ khả dụng khi Windows cung cấp bộ đếm hiệu năng. Dung lượng ổ đĩa được đo riêng.'
          )}
        </small>
      </div>

      <div className='hub-system-section' data-testid='hub-system-active-tasks'>
        <div className='hub-system-section-heading'>
          <strong>
            <Activity size={14} />
            {label('activeTasks', 'Tác vụ đang hoạt động')}
          </strong>
          <small>{activeTasks.length}</small>
        </div>
        <small className='hub-system-note'>
          {label('tasksScope', 'Agent, nhóm, lịch chạy và ứng dụng do Tomni ghi nhận.')}
        </small>
        {activeTasks.length ? (
          <div className='hub-system-task-list'>
            {activeTasks.slice(0, 16).map((item) => (
              <div key={item.id} className='hub-system-task'>
                <div className='hub-system-task-title'>
                  <strong title={item.title}>{item.title}</strong>
                  {item.route && onOpenActivity && (
                    <button
                      type='button'
                      title={label('openTask', 'Mở tác vụ')}
                      aria-label={`${label('openTask', 'Mở tác vụ')}: ${item.title}`}
                      onClick={() => onOpenActivity(item)}
                    >
                      <ExternalLink size={13} />
                    </button>
                  )}
                </div>
                <span>
                  {t(`guid.hubHome.live.kind.${item.kind}`, { defaultValue: item.kind })}
                  {' · '}
                  {item.status === 'needs_input' ? label('attention', 'Cần xử lý') : label('running', 'Đang chạy')}
                </span>
              </div>
            ))}
            {activeTasks.length > 16 && <small className='hub-system-note'>+{activeTasks.length - 16}</small>}
          </div>
        ) : (
          <p className='hub-system-note'>{label('noTasks', 'Không có tác vụ đang hoạt động.')}</p>
        )}
      </div>

      <div className='hub-system-section' data-testid='hub-system-processes'>
        <div className='hub-system-section-heading'>
          <strong>
            {processScope === 'os'
              ? label('osProcesses', 'Tiến trình Windows')
              : label('processes', 'Tiến trình Tomni')}
          </strong>
          <small>{processCount === null ? '—' : processCount}</small>
        </div>
        <p className='hub-system-note'>
          {processScope === 'os'
            ? label('osProcessScope', 'Danh sách tiến trình toàn Windows từ CIM (chỉ xem, cập nhật chậm hơn CPU/RAM).')
            : label('processScope', 'Chỉ tiến trình Electron/Tomni có số liệu CPU/RAM.')}
        </p>
        <div className='hub-system-process-controls'>
          <select
            value={processScope}
            onChange={(event) => setProcessScope(event.currentTarget.value as 'os' | 'tomni')}
            aria-label={label('processSource', 'Nguồn tiến trình')}
          >
            <option value='os'>{label('osSource', 'Windows')}</option>
            <option value='tomni'>{label('tomniSource', 'Tomni')}</option>
          </select>
          <label className='hub-system-search'>
            <Search size={13} />
            <input
              type='search'
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={label('search', 'Tên hoặc PID')}
              aria-label={label('search', 'Tên hoặc PID')}
            />
          </label>
          <select
            value={sort}
            onChange={(event) => setSort(event.currentTarget.value as MonitorProcessSort)}
            aria-label={label('sort', 'Sắp xếp tiến trình')}
          >
            <option value='cpu'>{label('byCpu', 'CPU cao nhất')}</option>
            <option value='memory'>{label('byMemory', 'RAM cao nhất')}</option>
            <option value='name'>{label('byName', 'Tên A–Z')}</option>
          </select>
        </div>
        <div className='hub-system-process-head'>
          <span>{label('process', 'Tiến trình')}</span>
          <span>CPU</span>
          <span>RAM</span>
        </div>
        <div className='hub-system-process-list'>
          {processScope === 'os' && (allProcesses === null || telemetryStale) ? (
            <p className='hub-system-note'>
              {label(
                'osUnavailable',
                'Đang lấy dữ liệu Windows hoặc bộ đếm không khả dụng. Bạn có thể chọn Tomni để xem các tiến trình ứng dụng.'
              )}
            </p>
          ) : filteredProcesses.length ? (
            filteredProcesses.map((process) => (
              <div className='hub-system-process-row' key={process.pid}>
                <div className='hub-system-process-name' title={`${process.name} · PID ${process.pid}`}>
                  <strong>{process.name}</strong>
                  <small>
                    {'type' in process ? `${process.type} · ` : ''}PID {process.pid}
                  </small>
                </div>
                <span title={label('cpuProcessNote', 'Phần trăm trên một lõi CPU')}>
                  {process.cpuPercent === null || !Number.isFinite(process.cpuPercent)
                    ? '—'
                    : `${process.cpuPercent.toFixed(1)}%`}
                </span>
                <span>{process.memoryMB === null ? '—' : monitorMemory(process.memoryMB)}</span>
              </div>
            ))
          ) : (
            <p className='hub-system-note'>{label('noProcesses', 'Không có tiến trình phù hợp.')}</p>
          )}
        </div>
        {processCount !== null && processCount > 24 && (
          <small className='hub-system-note'>
            {label('topProcesses', 'Hiển thị tối đa 24 tiến trình theo bộ lọc.')}
          </small>
        )}
        {processScope === 'os' && host?.processLimitReached && (
          <small className='hub-system-note'>
            {label('processLimit', 'Danh sách đã giới hạn tối đa 1024 tiến trình.')}
          </small>
        )}
      </div>
      {live && (
        <footer className='hub-system-sample-time'>
          {label('sampledAt', 'Lấy mẫu')}: {new Date(live.sampledAt).toLocaleTimeString()}
        </footer>
      )}
    </section>
  );
};