import { Button, InputNumber, Select, Slider, Switch } from '@arco-design/web-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FilmAsset, FilmTimeline, TimelineClip, VideoProject } from '../makeVideoClient';

type VideoEditorProps = {
  project: VideoProject;
  onSave: (timeline: FilmTimeline) => Promise<void>;
};

type HistoryState = {
  past: FilmTimeline[];
  present: FilmTimeline;
  future: FilmTimeline[];
};

type PointerMode = 'move' | 'resize-start' | 'resize-end';

type PointerSession = {
  clipId: string;
  mode: PointerMode;
  clientX: number;
  original: TimelineClip;
  timeline: FilmTimeline;
};

const TRACKS: TimelineClip['track'][] = ['video', 'voice', 'music', 'sfx', 'subtitle'];
const TRANSITIONS: NonNullable<TimelineClip['transitionIn']>[] = ['cut', 'fade', 'dissolve'];
const MIN_DURATION = 0.25;
const HISTORY_LIMIT = 50;

const cloneTimeline = (timeline: FilmTimeline): FilmTimeline => ({
  ...timeline,
  clips: timeline.clips.map((clip) => ({ ...clip })),
});

const defaultTimeline = (project: VideoProject): FilmTimeline => {
  let cursor = 0;
  const clips: TimelineClip[] = [];
  project.scenes.forEach((scene) => {
    const durationSec = 5;
    if (scene.videoClipPath || scene.imagePath) {
      clips.push({
        id: `video-${scene.id}`,
        sceneId: scene.id,
        track: 'video',
        startSec: cursor,
        durationSec,
        trimStartSec: 0,
        trimEndSec: 0,
        volume: 1,
        transitionIn: 'cut',
        transitionOut: 'cut',
      });
    }
    if (scene.audioPath) {
      clips.push({
        id: `voice-${scene.id}`,
        sceneId: scene.id,
        track: 'voice',
        startSec: cursor,
        durationSec,
        trimStartSec: 0,
        trimEndSec: 0,
        volume: 1,
      });
    }
    cursor += durationSec;
  });
  return { fps: 30, width: 1920, height: 1080, clips };
};

const formatTime = (seconds: number, fps: number): string => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const frames = Math.floor((safe % 1) * fps);
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames
    .toString()
    .padStart(2, '0')}`;
};

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

const snapTime = (value: number, timeline: FilmTimeline, excludedClipId: string, enabled: boolean): number => {
  if (!enabled) return Math.max(0, value);
  const threshold = 0.12;
  const frame = 1 / timeline.fps;
  const points = [0];
  timeline.clips.forEach((clip) => {
    if (clip.id === excludedClipId) return;
    points.push(clip.startSec, clip.startSec + clip.durationSec);
  });
  const frameSnapped = Math.round(value / frame) * frame;
  let result = frameSnapped;
  let distance = Math.abs(frameSnapped - value);
  points.forEach((point) => {
    const candidateDistance = Math.abs(point - value);
    if (candidateDistance < threshold && candidateDistance < distance) {
      result = point;
      distance = candidateDistance;
    }
  });
  return Math.max(0, result);
};

const findScene = (project: VideoProject, clip: TimelineClip | undefined) =>
  clip?.sceneId ? project.scenes.find((scene) => scene.id === clip.sceneId) : undefined;

const findAsset = (project: VideoProject, clip: TimelineClip | undefined): FilmAsset | undefined =>
  clip?.assetId ? project.assets?.find((asset) => asset.id === clip.assetId) : undefined;

const resolveClipSource = (project: VideoProject, clip: TimelineClip | undefined): string | null => {
  if (!clip) return null;
  const asset = findAsset(project, clip);
  if (asset?.path) return asset.path;
  const scene = findScene(project, clip);
  if (!scene) return null;
  if (clip.track === 'video') return scene.videoClipPath ?? scene.imagePath ?? null;
  if (clip.track === 'voice') return scene.audioPath ?? null;
  return null;
};

const isImageSource = (source: string | null): boolean =>
  Boolean(source && /\.(png|jpe?g|webp|gif|bmp|avif)(\?|$)/i.test(source));

const VideoEditor: React.FC<VideoEditorProps> = ({ project, onSave }) => {
  const { t } = useTranslation();
  const initial = useMemo(() => project.timeline ?? defaultTimeline(project), [project]);
  const [history, setHistory] = useState<HistoryState>({ past: [], present: cloneTimeline(initial), future: [] });
  const [selectedClipId, setSelectedClipId] = useState<string | null>(initial.clips[0]?.id ?? null);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(56);
  const [saving, setSaving] = useState(false);
  const [snapping, setSnapping] = useState(true);
  const [ripple, setRipple] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const startedPlayheadRef = useRef(0);
  const pointerRef = useRef<PointerSession | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const next = project.timeline ?? defaultTimeline(project);
    setHistory({ past: [], present: cloneTimeline(next), future: [] });
    setSelectedClipId(next.clips[0]?.id ?? null);
    setPlayheadSec(0);
    setPlaying(false);
  }, [project.id, project.timeline, project.scenes]);

  const timeline = history.present;
  const durationSec = Math.max(
    10,
    ...timeline.clips.map((clip) => clip.startSec + Math.max(MIN_DURATION, clip.durationSec))
  );
  const selectedClip = timeline.clips.find((clip) => clip.id === selectedClipId) ?? null;
  const selectedScene = findScene(project, selectedClip ?? undefined);
  const activeVideoClip = [...timeline.clips]
    .filter(
      (clip) => clip.track === 'video' && playheadSec >= clip.startSec && playheadSec < clip.startSec + clip.durationSec
    )
    .toSorted((a, b) => b.startSec - a.startSec)[0];
  const activeAudioClip = [...timeline.clips]
    .filter(
      (clip) =>
        ['voice', 'music', 'sfx'].includes(clip.track) &&
        playheadSec >= clip.startSec &&
        playheadSec < clip.startSec + clip.durationSec
    )
    .toSorted((a, b) => b.startSec - a.startSec)[0];
  const previewScene = findScene(project, activeVideoClip);
  const previewSource = resolveClipSource(project, activeVideoClip);
  const audioSource = resolveClipSource(project, activeAudioClip);

  const commit = (producer: (current: FilmTimeline) => FilmTimeline): void => {
    setHistory((current) => {
      const next = producer(cloneTimeline(current.present));
      return {
        past: [...current.past.slice(-(HISTORY_LIMIT - 1)), cloneTimeline(current.present)],
        present: next,
        future: [],
      };
    });
  };

  const updateClip = (clipId: string, patch: Partial<TimelineClip>): void => {
    commit((current) => ({
      ...current,
      clips: current.clips.map((clip) =>
        clip.id === clipId
          ? {
              ...clip,
              ...patch,
              startSec: Math.max(0, patch.startSec ?? clip.startSec),
              durationSec: Math.max(MIN_DURATION, patch.durationSec ?? clip.durationSec),
              trimStartSec: Math.max(0, patch.trimStartSec ?? clip.trimStartSec),
              trimEndSec: Math.max(0, patch.trimEndSec ?? clip.trimEndSec),
            }
          : clip
      ),
    }));
  };

  const undo = (): void => {
    setHistory((current) => {
      const previous = current.past.at(-1);
      if (!previous) return current;
      return {
        past: current.past.slice(0, -1),
        present: cloneTimeline(previous),
        future: [cloneTimeline(current.present), ...current.future],
      };
    });
  };

  const redo = (): void => {
    setHistory((current) => {
      const next = current.future[0];
      if (!next) return current;
      return {
        past: [...current.past, cloneTimeline(current.present)],
        present: cloneTimeline(next),
        future: current.future.slice(1),
      };
    });
  };

  const deleteSelected = (): void => {
    if (!selectedClip) return;
    const deletedEnd = selectedClip.startSec + selectedClip.durationSec;
    commit((current) => ({
      ...current,
      clips: current.clips
        .filter((clip) => clip.id !== selectedClip.id)
        .map((clip) =>
          ripple && clip.track === selectedClip.track && clip.startSec >= deletedEnd
            ? { ...clip, startSec: Math.max(selectedClip.startSec, clip.startSec - selectedClip.durationSec) }
            : clip
        ),
    }));
    setSelectedClipId(null);
  };

  const splitSelected = (): void => {
    if (
      !selectedClip ||
      playheadSec <= selectedClip.startSec ||
      playheadSec >= selectedClip.startSec + selectedClip.durationSec
    )
      return;
    const leftDuration = playheadSec - selectedClip.startSec;
    const rightDuration = selectedClip.durationSec - leftDuration;
    const rightId = `${selectedClip.id}-split-${Date.now().toString(36)}`;
    commit((current) => ({
      ...current,
      clips: current.clips.flatMap((clip) =>
        clip.id !== selectedClip.id
          ? [clip]
          : [
              { ...clip, durationSec: leftDuration, trimEndSec: clip.trimEndSec + rightDuration },
              {
                ...clip,
                id: rightId,
                startSec: playheadSec,
                durationSec: rightDuration,
                trimStartSec: clip.trimStartSec + leftDuration,
              },
            ]
      ),
    }));
    setSelectedClipId(rightId);
  };

  const beginPointer = (event: React.PointerEvent, clip: TimelineClip, mode: PointerMode): void => {
    event.stopPropagation();
    event.preventDefault();
    setSelectedClipId(clip.id);
    pointerRef.current = {
      clipId: clip.id,
      mode,
      clientX: event.clientX,
      original: { ...clip },
      timeline: cloneTimeline(timeline),
    };
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const session = pointerRef.current;
      if (!session) return;
      const deltaSec = (event.clientX - session.clientX) / zoom;
      setHistory((current) => {
        const base = session.timeline;
        const originalEnd = session.original.startSec + session.original.durationSec;
        const nextClips = base.clips.map((clip) => {
          if (clip.id !== session.clipId) {
            if (!ripple || clip.track !== session.original.track) return { ...clip };
            if (session.mode === 'resize-end' && clip.startSec >= originalEnd) {
              const nextDuration = Math.max(MIN_DURATION, session.original.durationSec + deltaSec);
              return { ...clip, startSec: Math.max(0, clip.startSec + nextDuration - session.original.durationSec) };
            }
            return { ...clip };
          }
          if (session.mode === 'move') {
            return {
              ...clip,
              startSec: snapTime(session.original.startSec + deltaSec, base, clip.id, snapping),
            };
          }
          if (session.mode === 'resize-start') {
            const unsnappedStart = clamp(
              session.original.startSec + deltaSec,
              0,
              session.original.startSec + session.original.durationSec - MIN_DURATION
            );
            const nextStart = snapTime(unsnappedStart, base, clip.id, snapping);
            const consumed = nextStart - session.original.startSec;
            return {
              ...clip,
              startSec: nextStart,
              durationSec: Math.max(MIN_DURATION, session.original.durationSec - consumed),
              trimStartSec: Math.max(0, session.original.trimStartSec + consumed),
            };
          }
          const unsnappedEnd = Math.max(session.original.startSec + MIN_DURATION, originalEnd + deltaSec);
          const nextEnd = snapTime(unsnappedEnd, base, clip.id, snapping);
          const nextDuration = Math.max(MIN_DURATION, nextEnd - session.original.startSec);
          return {
            ...clip,
            durationSec: nextDuration,
            trimEndSec: Math.max(0, session.original.trimEndSec - (nextDuration - session.original.durationSec)),
          };
        });
        return { ...current, present: { ...base, clips: nextClips } };
      });
    };
    const onUp = (): void => {
      const session = pointerRef.current;
      if (!session) return;
      setHistory((current) => ({
        past: [...current.past.slice(-(HISTORY_LIMIT - 1)), session.timeline],
        present: current.present,
        future: [],
      }));
      pointerRef.current = null;
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
    };
  }, [ripple, snapping, zoom]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    startedAtRef.current = performance.now();
    startedPlayheadRef.current = playheadSec;
    const tick = (now: number): void => {
      const next = startedPlayheadRef.current + (now - startedAtRef.current) / 1000;
      if (next >= durationSec) {
        setPlayheadSec(durationSec);
        setPlaying(false);
        return;
      }
      setPlayheadSec(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, durationSec]);

  useEffect(() => {
    const media = videoRef.current;
    if (!media || !activeVideoClip || isImageSource(previewSource)) return;
    const target = Math.max(0, playheadSec - activeVideoClip.startSec + activeVideoClip.trimStartSec);
    if (Math.abs(media.currentTime - target) > 0.18) media.currentTime = target;
    media.volume = clamp(activeVideoClip.volume, 0, 1);
    if (playing) {
      void media.play().catch((): void => {});
    } else {
      media.pause();
    }
  }, [activeVideoClip, playheadSec, playing, previewSource]);

  useEffect(() => {
    const media = audioRef.current;
    if (!media || !activeAudioClip) return;
    const target = Math.max(0, playheadSec - activeAudioClip.startSec + activeAudioClip.trimStartSec);
    if (Math.abs(media.currentTime - target) > 0.18) media.currentTime = target;
    media.volume = clamp(activeAudioClip.volume, 0, 1);
    if (playing) {
      void media.play().catch((): void => {});
    } else {
      media.pause();
    }
  }, [activeAudioClip, audioSource, playheadSec, playing]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        setPlaying((value) => !value);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        splitSelected();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await onSave(timeline);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='h-full min-h-0 grid grid-rows-[minmax(240px,42%)_auto_minmax(260px,1fr)] gap-10px bg-1'>
      <div className='min-h-0 grid grid-cols-[minmax(0,1fr)_300px] gap-10px'>
        <div className='relative min-h-0 rd-10px border border-b-1 bg-fill-1 overflow-hidden flex-center'>
          {previewSource && isImageSource(previewSource) ? (
            <img className='max-w-full max-h-full object-contain' src={previewSource} alt={previewScene?.title ?? ''} />
          ) : previewSource ? (
            <video ref={videoRef} className='max-w-full max-h-full' src={previewSource} controls={false} playsInline />
          ) : (
            <div className='text-13px text-t-tertiary'>{t('makeVideo.editor.noPreview')}</div>
          )}
          {audioSource ? <audio ref={audioRef} src={audioSource} /> : null}
          <div className='absolute left-12px bottom-10px px-8px py-4px rd-6px bg-3 text-12px text-t-secondary font-mono'>
            {formatTime(playheadSec, timeline.fps)} / {formatTime(durationSec, timeline.fps)}
          </div>
        </div>

        <div className='min-h-0 rd-10px border border-b-1 bg-2 p-12px overflow-auto'>
          <div className='text-13px font-[600] text-t-primary mb-12px'>{t('makeVideo.editor.inspector')}</div>
          {selectedClip ? (
            <div className='flex flex-col gap-12px'>
              <div className='text-12px text-t-tertiary line-clamp-2'>{selectedScene?.title ?? selectedClip.id}</div>
              <label className='flex flex-col gap-4px text-12px text-t-secondary'>
                {t('makeVideo.editor.trackLabel')}
                <Select
                  value={selectedClip.track}
                  onChange={(value) => updateClip(selectedClip.id, { track: value as TimelineClip['track'] })}
                >
                  {TRACKS.map((track) => (
                    <Select.Option key={track} value={track}>
                      {t(`makeVideo.editor.track.${track}`)}
                    </Select.Option>
                  ))}
                </Select>
              </label>
              <div className='grid grid-cols-2 gap-8px'>
                <label className='flex flex-col gap-4px text-12px text-t-secondary'>
                  {t('makeVideo.editor.start')}
                  <InputNumber
                    min={0}
                    step={0.1}
                    value={selectedClip.startSec}
                    onChange={(value) => updateClip(selectedClip.id, { startSec: Number(value ?? 0) })}
                  />
                </label>
                <label className='flex flex-col gap-4px text-12px text-t-secondary'>
                  {t('makeVideo.editor.duration')}
                  <InputNumber
                    min={MIN_DURATION}
                    step={0.1}
                    value={selectedClip.durationSec}
                    onChange={(value) => updateClip(selectedClip.id, { durationSec: Number(value ?? MIN_DURATION) })}
                  />
                </label>
              </div>
              <label className='flex flex-col gap-4px text-12px text-t-secondary'>
                {t('makeVideo.editor.volume')}
                <Slider
                  min={0}
                  max={2}
                  step={0.05}
                  value={selectedClip.volume}
                  onChange={(value) => updateClip(selectedClip.id, { volume: Number(value) })}
                />
              </label>
              {selectedClip.track === 'video' ? (
                <div className='grid grid-cols-2 gap-8px'>
                  <label className='flex flex-col gap-4px text-12px text-t-secondary'>
                    {t('makeVideo.editor.transitionIn')}
                    <Select
                      value={selectedClip.transitionIn ?? 'cut'}
                      onChange={(value) =>
                        updateClip(selectedClip.id, { transitionIn: value as TimelineClip['transitionIn'] })
                      }
                    >
                      {TRANSITIONS.map((transition) => (
                        <Select.Option key={transition} value={transition}>
                          {t(`makeVideo.editor.transition.${transition}`)}
                        </Select.Option>
                      ))}
                    </Select>
                  </label>
                  <label className='flex flex-col gap-4px text-12px text-t-secondary'>
                    {t('makeVideo.editor.transitionOut')}
                    <Select
                      value={selectedClip.transitionOut ?? 'cut'}
                      onChange={(value) =>
                        updateClip(selectedClip.id, { transitionOut: value as TimelineClip['transitionOut'] })
                      }
                    >
                      {TRANSITIONS.map((transition) => (
                        <Select.Option key={transition} value={transition}>
                          {t(`makeVideo.editor.transition.${transition}`)}
                        </Select.Option>
                      ))}
                    </Select>
                  </label>
                </div>
              ) : null}
              <div className='grid grid-cols-2 gap-8px'>
                <Button onClick={splitSelected}>{t('makeVideo.editor.split')}</Button>
                <Button status='danger' onClick={deleteSelected}>
                  {t('makeVideo.editor.delete')}
                </Button>
              </div>
            </div>
          ) : (
            <div className='text-12px text-t-tertiary'>{t('makeVideo.editor.selectClip')}</div>
          )}
        </div>
      </div>

      <div className='flex items-center gap-8px rd-10px border border-b-1 bg-2 px-10px py-8px'>
        <Button onClick={() => setPlaying((value) => !value)}>
          {playing ? t('makeVideo.editor.pause') : t('makeVideo.editor.play')}
        </Button>
        <Button disabled={history.past.length === 0} onClick={undo}>
          {t('makeVideo.editor.undo')}
        </Button>
        <Button disabled={history.future.length === 0} onClick={redo}>
          {t('makeVideo.editor.redo')}
        </Button>
        <Button disabled={!selectedClip} onClick={splitSelected}>
          {t('makeVideo.editor.split')}
        </Button>
        <span className='ml-8px text-11px text-t-tertiary'>{t('makeVideo.editor.snapping')}</span>
        <Switch size='small' checked={snapping} onChange={setSnapping} />
        <span className='text-11px text-t-tertiary'>{t('makeVideo.editor.ripple')}</span>
        <Switch size='small' checked={ripple} onChange={setRipple} />
        <div className='w-150px ml-auto flex items-center gap-8px'>
          <span className='text-11px text-t-tertiary'>{t('makeVideo.editor.zoom')}</span>
          <Slider min={24} max={140} value={zoom} onChange={(value) => setZoom(Number(value))} />
        </div>
        <Button type='primary' loading={saving} onClick={() => void save()}>
          {t('makeVideo.editor.save')}
        </Button>
      </div>

      <div className='min-h-0 rd-10px border border-b-1 bg-2 overflow-auto'>
        <div className='relative min-w-max' style={{ width: Math.max(900, durationSec * zoom + 120) }}>
          <div className='sticky top-0 z-20 h-28px bg-3 border-b border-b-1 ml-100px relative'>
            {Array.from({ length: Math.ceil(durationSec) + 1 }, (_, second) => (
              <div
                key={second}
                className='absolute top-0 h-full border-l border-b-1 text-10px text-t-quaternary pl-4px pt-5px'
                style={{ left: second * zoom }}
              >
                {second}s
              </div>
            ))}
          </div>
          <div
            className='absolute z-30 top-0 bottom-0 w-1px bg-primary pointer-events-none'
            style={{ left: 100 + playheadSec * zoom }}
          />
          {TRACKS.map((track) => (
            <div key={track} className='grid grid-cols-[100px_1fr] min-h-54px border-b border-b-1'>
              <div className='sticky left-0 z-10 bg-3 border-r border-b-1 px-10px flex items-center text-11px font-[600] text-t-secondary uppercase tracking-wide'>
                {t(`makeVideo.editor.track.${track}`)}
              </div>
              <div
                className='relative min-h-54px bg-fill-1 cursor-crosshair'
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const raw = (event.clientX - rect.left) / zoom;
                  setPlayheadSec(Math.min(durationSec, snapTime(raw, timeline, '', snapping)));
                }}
              >
                {timeline.clips
                  .filter((clip) => clip.track === track)
                  .map((clip) => {
                    const scene = findScene(project, clip);
                    return (
                      <div
                        key={clip.id}
                        className={`group absolute top-6px h-42px rd-6px border overflow-hidden cursor-grab transition-colors ${
                          selectedClipId === clip.id
                            ? 'border-primary bg-primary-light-1 shadow-sm'
                            : 'border-b-2 bg-3 hover:border-primary'
                        }`}
                        style={{ left: clip.startSec * zoom, width: Math.max(24, clip.durationSec * zoom) }}
                        onPointerDown={(event) => beginPointer(event, clip, 'move')}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedClipId(clip.id);
                        }}
                      >
                        <div
                          className='absolute left-0 top-0 bottom-0 w-6px cursor-ew-resize bg-fill-3 opacity-0 group-hover:opacity-100'
                          onPointerDown={(event) => beginPointer(event, clip, 'resize-start')}
                        />
                        <div className='px-9px py-5px pointer-events-none'>
                          <div className='text-11px font-[600] text-t-primary truncate'>
                            {scene?.title ?? findAsset(project, clip)?.name ?? clip.id}
                          </div>
                          <div className='text-10px text-t-tertiary truncate'>{clip.durationSec.toFixed(1)}s</div>
                        </div>
                        <div
                          className='absolute right-0 top-0 bottom-0 w-6px cursor-ew-resize bg-fill-3 opacity-0 group-hover:opacity-100'
                          onPointerDown={(event) => beginPointer(event, clip, 'resize-end')}
                        />
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default VideoEditor;
