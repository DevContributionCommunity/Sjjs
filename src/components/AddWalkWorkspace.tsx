import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Compass,
  CornerUpLeft,
  CornerUpRight,
  Crosshair,
  Footprints,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Ruler,
  Trash2,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type {
  CaptureMode,
  HouseSide,
  LatLngPoint,
  RoadJunction,
  VillageHouse,
  VillageRoad,
} from '../types/map.ts';
import { computePathDistance, formatDistance, formatDuration } from '../utils/geo.ts';
import type { GpsPrecisionMode, GpsQualityReport } from '../utils/gpsFilter.ts';

export type StraightSymbolAction =
  | 'turn_left'
  | 'turn_right'
  | 'curve_left'
  | 'curve_right'
  | 'straight_step'
  | 'nudge_left'
  | 'nudge_right';

interface AddWalkWorkspaceProps {
  captureMode: CaptureMode;
  onChangeCaptureMode: (mode: CaptureMode) => void;
  gpsPrecisionMode: GpsPrecisionMode;
  onTogglePrecisionMode: () => void;
  gpsQuality: GpsQualityReport;
  isRecording: boolean;
  isPaused: boolean;
  segments: LatLngPoint[][];
  draftHouses: VillageHouse[];
  draftJunctions: RoadJunction[];
  straightHeadingDeg: number | null;
  elapsedSeconds: number;
  gpsError: string | null;
  detectedVillage: string;
  onStartWalk: () => void;
  onPauseResume: () => void;
  onUndoLastPoint: () => void;
  onDiscardWalk: () => void;
  onSimulateStep: (dLat: number, dLng: number) => void;
  onStraightSymbol: (action: StraightSymbolAction) => void;
  onStraightJunction: (type: '3-way' | '4-way', exitTurn: 'left' | 'straight' | 'right') => void;
  onAddHouseOnWalk: (houseNumber: string, side: HouseSide, note?: string) => void;
  onRemoveDraftHouse: (houseId: string) => void;
  onSaveWalkedRoad: (payload: {
    roadName: string;
    villageName: string;
    surface: VillageRoad['surface'];
  }) => void;
  nextSuggestedHouse: string;
  onLocateMe: () => void;
  mapSlot: ReactNode;
}

export default function AddWalkWorkspace({
  captureMode,
  onChangeCaptureMode,
  gpsPrecisionMode,
  onTogglePrecisionMode,
  gpsQuality,
  isRecording,
  isPaused,
  segments,
  draftHouses,
  draftJunctions,
  straightHeadingDeg,
  elapsedSeconds,
  gpsError,
  detectedVillage,
  onStartWalk,
  onPauseResume,
  onUndoLastPoint,
  onDiscardWalk,
  onSimulateStep,
  onStraightSymbol,
  onStraightJunction,
  onAddHouseOnWalk,
  onRemoveDraftHouse,
  onSaveWalkedRoad,
  nextSuggestedHouse,
  onLocateMe,
  mapSlot,
}: AddWalkWorkspaceProps) {
  const [houseInput, setHouseInput] = useState(nextSuggestedHouse || '1');
  const [houseNote, setHouseNote] = useState('');
  const [pendingJunction, setPendingJunction] = useState<'3-way' | '4-way' | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [roadName, setRoadName] = useState('');
  const [villageName, setVillageName] = useState('');
  const [surface, setSurface] = useState<VillageRoad['surface']>('concrete');

  // Keep house counter synced to next global sequential house number when starting a fresh walk
  useEffect(() => {
    if (draftHouses.length === 0 && !isRecording) {
      setHouseInput(nextSuggestedHouse || '1');
    }
  }, [nextSuggestedHouse, draftHouses.length, isRecording]);

  const liveDistance = segments.reduce((sum, seg) => sum + computePathDistance(seg), 0);
  const totalPoints = segments.reduce((sum, seg) => sum + seg.length, 0);
  const hasSavableSegment = segments.some((seg) => seg.length >= 2);
  const leftHouses = draftHouses.filter((h) => h.side === 'left');
  const rightHouses = draftHouses.filter((h) => h.side === 'right');

  const adjustHouseNumber = (delta: number) => {
    const parsed = parseInt(houseInput.trim(), 10);
    if (Number.isFinite(parsed)) {
      setHouseInput(String(Math.max(1, parsed + delta)));
    } else {
      setHouseInput('1');
    }
  };

  const handleTagHouse = (side: HouseSide) => {
    const trimmed = houseInput.trim();
    if (!trimmed) return;
    onAddHouseOnWalk(trimmed, side, houseNote.trim() || undefined);
    setHouseNote('');
    const numeric = Number(trimmed);
    if (Number.isInteger(numeric) && numeric >= 0) {
      setHouseInput(String(numeric + 1));
    }
  };

  const handleOpenSave = () => {
    setVillageName((v) => v || detectedVillage || 'My Village');
    setShowSaveModal(true);
  };

  const handleFinishSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasSavableSegment) return;
    onSaveWalkedRoad({
      roadName: roadName.trim() || `Village Lane (${draftHouses.length} houses)`,
      villageName: villageName.trim() || detectedVillage || 'My Village',
      surface,
    });
    setRoadName('');
    setShowSaveModal(false);
    setHouseInput(nextSuggestedHouse || '1');
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-slate-100">
      {/* Compact Top Walk Controls Bar */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-2.5 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2 z-20">
        {/* Capture Mode + Precision Selector */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-lg">
            <button
              type="button"
              disabled={isRecording}
              onClick={() => onChangeCaptureMode('straight_walk')}
              title="Clean Straight Road + Turn/Curve/Junction Symbols (no GPS zig-zag)"
              className={`px-2 py-1 text-[11px] font-medium rounded-md inline-flex items-center gap-1 whitespace-nowrap cursor-pointer disabled:opacity-60 ${
                captureMode === 'straight_walk'
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Ruler className="w-3 h-3" />
              Straight
            </button>
            <button
              type="button"
              disabled={isRecording}
              onClick={() => onChangeCaptureMode('gps_walk')}
              className={`px-2 py-1 text-[11px] font-medium rounded-md inline-flex items-center gap-1 whitespace-nowrap cursor-pointer disabled:opacity-60 ${
                captureMode === 'gps_walk'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Footprints className="w-3 h-3" />
              GPS
            </button>
            <button
              type="button"
              disabled={isRecording}
              onClick={() => onChangeCaptureMode('manual_trace')}
              className={`px-2 py-1 text-[11px] font-medium rounded-md inline-flex items-center gap-1 whitespace-nowrap cursor-pointer disabled:opacity-60 ${
                captureMode === 'manual_trace'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Pencil className="w-3 h-3" />
              Tap
            </button>
            <button
              type="button"
              disabled={isRecording}
              onClick={() => onChangeCaptureMode('simulated_walk')}
              className={`px-2 py-1 text-[11px] font-medium rounded-md inline-flex items-center gap-1 whitespace-nowrap cursor-pointer disabled:opacity-60 ${
                captureMode === 'simulated_walk'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Compass className="w-3 h-3" />
              Test
            </button>
          </div>

          {/* 5m Accurate GPS Toggle */}
          <button
            type="button"
            onClick={onTogglePrecisionMode}
            title="Toggle max 5m accurate GPS lock vs 15m indoor tolerance"
            className={`px-2 py-1 rounded-lg text-[11px] font-mono font-semibold border whitespace-nowrap cursor-pointer ${
              gpsPrecisionMode === 'accurate_5m'
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : 'bg-slate-50 border-slate-300 text-slate-700'
            }`}
          >
            {gpsPrecisionMode === 'accurate_5m' ? '≤5m GPS' : '≤15m Indoor'}
          </button>

          <button
            type="button"
            onClick={onLocateMe}
            aria-label="Center on GPS"
            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
          >
            <Crosshair className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Live Telemetry & Recording Action Buttons */}
        <div className="flex items-center gap-2 ml-auto">
          <div className="hidden sm:flex items-center gap-2.5 text-xs font-mono tabular-nums text-slate-700 px-2">
            <span>{formatDistance(liveDistance)}</span>
            <span className="text-slate-300">|</span>
            <span>{totalPoints} pts</span>
            <span className="text-slate-300">|</span>
            <span>{formatDuration(elapsedSeconds)}</span>
          </div>

          {!isRecording && totalPoints === 0 ? (
            <button
              type="button"
              onClick={onStartWalk}
              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              Start Walk
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={isRecording ? onPauseResume : onStartWalk}
                className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
              >
                {!isRecording || isPaused ? (
                  <>
                    <Play className="w-3 h-3" />
                    Resume
                  </>
                ) : (
                  <>
                    <Pause className="w-3 h-3" />
                    Pause
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={totalPoints === 0}
                onClick={onUndoLastPoint}
                title="Undo last GPS point"
                className="p-1.5 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 text-slate-700 rounded-lg cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                disabled={!hasSavableSegment}
                onClick={handleOpenSave}
                className="px-2.5 py-1.5 bg-sky-700 hover:bg-sky-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                Save
              </button>

              <button
                type="button"
                onClick={onDiscardWalk}
                title="Discard walk"
                className="p-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Live Paused Notice (GPS keeps running so user sees where to resume) */}
      {isRecording && isPaused && (
        <div className="shrink-0 bg-sky-50 border-b border-sky-200 px-3 py-1.5 flex items-center justify-between gap-2 text-[11px] text-sky-900">
          <span>Paused — Live GPS active so you can see where you are before pressing Resume</span>
          <button
            type="button"
            onClick={onPauseResume}
            className="font-bold underline text-sky-950 shrink-0 cursor-pointer"
          >
            Resume Now
          </button>
        </div>
      )}

      {/* Optional GPS Alert Strip */}
      {gpsError && (
        <div className="shrink-0 bg-amber-50 border-b border-amber-200 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-amber-900">
          <span>
            {gpsError}
            {gpsQuality.accuracyMeters != null ? ` (Current: ±${gpsQuality.accuracyMeters}m)` : ''}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {gpsPrecisionMode === 'accurate_5m' && (
              <button
                type="button"
                onClick={onTogglePrecisionMode}
                className="font-semibold underline text-amber-950 cursor-pointer"
              >
                Allow ≤15m
              </button>
            )}
            {(captureMode === 'gps_walk' || captureMode === 'straight_walk') && (
              <button
                type="button"
                onClick={() => onChangeCaptureMode('simulated_walk')}
                className="font-semibold underline text-amber-950 cursor-pointer"
              >
                Use Test Walk
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3-COLUMN MOBILE & DESKTOP WORKSPACE: [LEFT VERTICAL] | [CENTER LIVE MAP] | [RIGHT VERTICAL] */}
      <div className="flex-1 min-h-0 flex items-stretch overflow-hidden">
        {/* LEFT VERTICAL STRIP */}
        <aside className="w-[68px] sm:w-28 md:w-32 shrink-0 bg-white border-r border-slate-200 flex flex-col justify-between p-1.5 sm:p-2 z-10">
          <div className="space-y-1.5">
            <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-emerald-800 text-center">
              Left
            </div>
            <button
              type="button"
              disabled={!houseInput.trim()}
              onClick={() => handleTagHouse('left')}
              className="w-full min-h-[68px] sm:min-h-[82px] px-1 py-2 bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl flex flex-col items-center justify-center gap-1 shadow-sm transition cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="text-[11px] sm:text-xs font-bold font-mono">
                + #{houseInput.trim() || '?'}
              </span>
              <span className="text-[9px] sm:text-[10px] opacity-90">Add Left</span>
            </button>
          </div>

          {/* Left Tagged Houses List */}
          <div className="flex-1 min-h-0 my-2 overflow-y-auto space-y-1">
            <div className="text-[10px] font-mono text-slate-500 text-center">
              {leftHouses.length} left
            </div>
            {leftHouses
              .slice()
              .reverse()
              .map((h) => (
                <div
                  key={h.id}
                  className="px-1.5 py-1 bg-emerald-50 border border-emerald-200 rounded-md flex items-center justify-between gap-1 text-[11px]"
                >
                  <span className="font-mono font-bold text-emerald-900 truncate">
                    #{h.houseNumber}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveDraftHouse(h.id)}
                    className="text-emerald-700/70 hover:text-red-600 shrink-0 cursor-pointer"
                    aria-label={`Remove left house ${h.houseNumber}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
          </div>

          <div className="text-[10px] font-mono tabular-nums text-center text-slate-500 sm:hidden">
            {formatDistance(liveDistance)}
          </div>
        </aside>

        {/* CENTER LIVE MOVING MAP */}
        <section className="flex-1 min-w-0 h-full relative">
          {mapSlot}

          {/* Clean Straight + Symbol Road Builder Dock */}
          {captureMode === 'straight_walk' && isRecording && !isPaused && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[450] w-[calc(100%-0.75rem)] max-w-md space-y-1.5">
              {/* Inline 3-Way / 4-Way Branch Exit Selector */}
              {pendingJunction && (
                <div className="bg-slate-900 text-white rounded-xl shadow-lg px-2.5 py-2 flex items-center justify-between gap-1.5">
                  <span className="text-[11px] font-semibold text-emerald-300 whitespace-nowrap">
                    {pendingJunction === '4-way' ? '4-Way:' : '3-Way:'} Go
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        onStraightJunction(pendingJunction, 'left');
                        setPendingJunction(null);
                      }}
                      className="px-2 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <CornerUpLeft className="w-3.5 h-3.5" />
                      Left
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onStraightJunction(pendingJunction, 'straight');
                        setPendingJunction(null);
                      }}
                      className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                      Straight
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onStraightJunction(pendingJunction, 'right');
                        setPendingJunction(null);
                      }}
                      className="px-2 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <CornerUpRight className="w-3.5 h-3.5" />
                      Right
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingJunction(null)}
                      aria-label="Cancel junction"
                      className="p-1 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl shadow-lg p-1.5 space-y-1">
                {/* Heading Lock & Fine-Tune Strip */}
                <div className="flex items-center justify-between gap-1 px-1 text-[10px] text-slate-600">
                  <span className="font-mono font-semibold text-emerald-800 truncate">
                    {straightHeadingDeg != null
                      ? `Steel Line · ${Math.round(straightHeadingDeg)}°${
                          draftJunctions.length > 0 ? ` · ${draftJunctions.length} jnc` : ''
                        }`
                      : 'Walk forward — straight line follows you'}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onStraightSymbol('nudge_left')}
                      title="Rotate straight line angle -15°"
                      className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 font-mono font-semibold text-slate-800 cursor-pointer"
                    >
                      -15°
                    </button>
                    <button
                      type="button"
                      onClick={() => onStraightSymbol('nudge_right')}
                      title="Rotate straight line angle +15°"
                      className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 font-mono font-semibold text-slate-800 cursor-pointer"
                    >
                      +15°
                    </button>
                    <button
                      type="button"
                      onClick={() => onStraightSymbol('straight_step')}
                      title="Extend straight line forward 5m"
                      className="px-1.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 font-mono font-semibold text-white cursor-pointer"
                    >
                      +5m
                    </button>
                  </div>
                </div>

                {/* 1-Tap Turn, Curve & 3-Way / 4-Way Symbol Row */}
                <div className="grid grid-cols-6 gap-1">
                  <button
                    type="button"
                    onClick={() => onStraightSymbol('turn_left')}
                    className="py-1.5 px-1 rounded-lg bg-slate-50 hover:bg-emerald-50 border border-slate-200 flex flex-col items-center justify-center gap-0.5 text-slate-800 cursor-pointer"
                  >
                    <CornerUpLeft className="w-4 h-4 text-emerald-700" />
                    <span className="text-[9px] font-semibold leading-none">Left</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onStraightSymbol('curve_left')}
                    className="py-1.5 px-1 rounded-lg bg-slate-50 hover:bg-emerald-50 border border-slate-200 flex flex-col items-center justify-center gap-0.5 text-slate-800 cursor-pointer"
                  >
                    <svg className="w-4 h-4 text-sky-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 20 C16 12 13 8 6 5" />
                      <path d="M10 4 L5.5 4.8 L6.8 9.2" />
                    </svg>
                    <span className="text-[9px] font-semibold leading-none">Curve L</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPendingJunction((p) => (p === '3-way' ? null : '3-way'))}
                    className={`py-1.5 px-1 rounded-lg border flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                      pendingJunction === '3-way'
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800'
                    }`}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <path d="M12 20 V11" />
                      <path d="M4 11 H20" />
                    </svg>
                    <span className="text-[9px] font-semibold leading-none">3-Way</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPendingJunction((p) => (p === '4-way' ? null : '4-way'))}
                    className={`py-1.5 px-1 rounded-lg border flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                      pendingJunction === '4-way'
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800'
                    }`}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <path d="M12 4 V20" />
                      <path d="M4 12 H20" />
                    </svg>
                    <span className="text-[9px] font-semibold leading-none">4-Way</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onStraightSymbol('curve_right')}
                    className="py-1.5 px-1 rounded-lg bg-slate-50 hover:bg-emerald-50 border border-slate-200 flex flex-col items-center justify-center gap-0.5 text-slate-800 cursor-pointer"
                  >
                    <svg className="w-4 h-4 text-sky-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 20 C8 12 11 8 18 5" />
                      <path d="M14 4 L18.5 4.8 L17.2 9.2" />
                    </svg>
                    <span className="text-[9px] font-semibold leading-none">Curve R</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onStraightSymbol('turn_right')}
                    className="py-1.5 px-1 rounded-lg bg-slate-50 hover:bg-emerald-50 border border-slate-200 flex flex-col items-center justify-center gap-0.5 text-slate-800 cursor-pointer"
                  >
                    <CornerUpRight className="w-4 h-4 text-emerald-700" />
                    <span className="text-[9px] font-semibold leading-none">Right</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Directional Step Controls Overlay when Test Walk is active */}
          {captureMode === 'simulated_walk' && isRecording && !isPaused && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[450] bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl shadow-md p-1.5 flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSimulateStep(0, -0.00012)}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 cursor-pointer"
              >
                W
              </button>
              <button
                type="button"
                onClick={() => onSimulateStep(0.00012, 0)}
                className="w-8 h-8 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-bold text-white cursor-pointer"
              >
                N
              </button>
              <button
                type="button"
                onClick={() => onSimulateStep(-0.00012, 0)}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 cursor-pointer"
              >
                S
              </button>
              <button
                type="button"
                onClick={() => onSimulateStep(0, 0.00012)}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 cursor-pointer"
              >
                E
              </button>
            </div>
          )}
        </section>

        {/* RIGHT VERTICAL STRIP */}
        <aside className="w-[68px] sm:w-28 md:w-32 shrink-0 bg-white border-l border-slate-200 flex flex-col justify-between p-1.5 sm:p-2 z-10">
          <div className="space-y-1.5">
            <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-amber-700 text-center">
              Right
            </div>
            <button
              type="button"
              disabled={!houseInput.trim()}
              onClick={() => handleTagHouse('right')}
              className="w-full min-h-[68px] sm:min-h-[82px] px-1 py-2 bg-amber-600 hover:bg-amber-700 active:scale-[0.98] disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl flex flex-col items-center justify-center gap-1 shadow-sm transition cursor-pointer"
            >
              <ArrowRight className="w-5 h-5" />
              <span className="text-[11px] sm:text-xs font-bold font-mono">
                + #{houseInput.trim() || '?'}
              </span>
              <span className="text-[9px] sm:text-[10px] opacity-90">Add Right</span>
            </button>
          </div>

          {/* Right Tagged Houses List */}
          <div className="flex-1 min-h-0 my-2 overflow-y-auto space-y-1">
            <div className="text-[10px] font-mono text-slate-500 text-center">
              {rightHouses.length} right
            </div>
            {rightHouses
              .slice()
              .reverse()
              .map((h) => (
                <div
                  key={h.id}
                  className="px-1.5 py-1 bg-amber-50 border border-amber-200 rounded-md flex items-center justify-between gap-1 text-[11px]"
                >
                  <span className="font-mono font-bold text-amber-900 truncate">
                    #{h.houseNumber}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveDraftHouse(h.id)}
                    className="text-amber-700/70 hover:text-red-600 shrink-0 cursor-pointer"
                    aria-label={`Remove right house ${h.houseNumber}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
          </div>

          <div className="text-[10px] font-mono tabular-nums text-center text-slate-500 sm:hidden">
            {totalPoints} pts
          </div>
        </aside>
      </div>

      {/* Bottom Compact House Number Stepper Bar */}
      <div className="shrink-0 bg-white border-t border-slate-200 px-2.5 sm:px-4 py-2 flex items-center gap-2 z-20">
        <span className="text-[11px] sm:text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0">
          House No.
        </span>

        <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden bg-slate-50 shrink-0">
          <button
            type="button"
            onClick={() => adjustHouseNumber(-1)}
            aria-label="Decrease house number"
            className="w-9 h-9 flex items-center justify-center hover:bg-slate-200 text-slate-700 cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <input
            type="text"
            value={houseInput}
            onChange={(e) => setHouseInput(e.target.value)}
            aria-label="House number to tag"
            className="w-14 sm:w-16 h-9 text-center bg-white text-sm font-bold font-mono text-slate-900 border-x border-slate-200 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => adjustHouseNumber(1)}
            aria-label="Increase house number"
            className="w-9 h-9 flex items-center justify-center hover:bg-slate-200 text-slate-700 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <input
          type="text"
          value={houseNote}
          onChange={(e) => setHouseNote(e.target.value)}
          placeholder="Note (shop, landmark)..."
          className="flex-1 min-w-0 h-9 px-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />

        {houseInput !== nextSuggestedHouse && (
          <button
            type="button"
            onClick={() => setHouseInput(nextSuggestedHouse)}
            title={`Continue from #${nextSuggestedHouse}`}
            className="px-2 h-9 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-[11px] font-mono font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            #{nextSuggestedHouse}
          </button>
        )}
      </div>

      {/* Save Walked Road & Tagged Houses Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-[1200] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleFinishSubmit}
            className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Save Walked Road</h3>
                <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                  {formatDistance(liveDistance)} · {totalPoints} lat/lng pts ·{' '}
                  {draftHouses.length} houses
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Road / Gali Name
              </label>
              <input
                type="text"
                required
                autoFocus
                placeholder="e.g. Mandir Gali, Ward 4 Road"
                value={roadName}
                onChange={(e) => setRoadName(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Village Name
                </label>
                <input
                  type="text"
                  required
                  value={villageName}
                  onChange={(e) => setVillageName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Surface</label>
                <select
                  value={surface}
                  onChange={(e) => setSurface(e.target.value as VillageRoad['surface'])}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                >
                  <option value="concrete">CC Road</option>
                  <option value="cobblestone">Brick / Kharanja</option>
                  <option value="asphalt">Tar / Pakka</option>
                  <option value="unpaved">Kachha Road</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Keep Walking
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                Save to Local Map
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
