import { Download, Eye, Maximize2, Navigation, Search, Trash2, Upload } from 'lucide-react';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import type { VillageHouse, VillageRoad } from '../types/map.ts';
import { formatDistance, generateGpxExport, getSurfaceLabel } from '../utils/geo.ts';

interface SavedDataViewProps {
  roads: VillageRoad[];
  houses: VillageHouse[];
  mapSlot: ReactNode;
  onNavigateHouse: (house: VillageHouse) => void;
  onFocusRoad: (road: VillageRoad) => void;
  onFocusHouse: (house: VillageHouse) => void;
  onFitAll: () => void;
  onDeleteHouse: (houseId: string) => void;
  onDeleteRoad: (roadId: string) => void;
  onImportBackup: (data: { roads: VillageRoad[]; houses: VillageHouse[] }) => void;
  onClearAll: () => void;
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function SavedDataView({
  roads,
  houses,
  mapSlot,
  onNavigateHouse,
  onFocusRoad,
  onFocusHouse,
  onFitAll,
  onDeleteHouse,
  onDeleteRoad,
  onImportBackup,
  onClearAll,
}: SavedDataViewProps) {
  const [query, setQuery] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const scrollToMap = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const filteredHouses = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return houses;
    return houses.filter(
      (h) =>
        h.houseNumber.toLowerCase().includes(q) ||
        h.roadName.toLowerCase().includes(q) ||
        (h.note ?? '').toLowerCase().includes(q)
    );
  }, [houses, query]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as {
        roads?: VillageRoad[];
        houses?: VillageHouse[];
      };
      if (Array.isArray(parsed.roads) || Array.isArray(parsed.houses)) {
        onImportBackup({
          roads: Array.isArray(parsed.roads) ? parsed.roads : [],
          houses: Array.isArray(parsed.houses) ? parsed.houses : [],
        });
      }
    } catch {
      // ignore invalid file
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div ref={scrollContainerRef} className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Preview Saved Roads &amp; House Numbers
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
              Saved locally in browser ·{' '}
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                {roads.length} roads · {houses.length} houses
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onFitAll}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              Fit All on Map
            </button>

            <button
              type="button"
              onClick={() =>
                downloadFile(
                  `grampath-backup-${new Date().toISOString().slice(0, 10)}.json`,
                  JSON.stringify({ roads, houses }, null, 2),
                  'application/json'
                )
              }
              className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Backup JSON
            </button>

            <button
              type="button"
              onClick={() =>
                downloadFile(
                  `grampath-osm-tracks.gpx`,
                  generateGpxExport(roads, houses),
                  'application/gpx+xml'
                )
              }
              className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export .GPX
            </button>

            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImport}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              Restore
            </button>

            {confirmClear ? (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1 text-xs">
                <span className="text-red-800 font-medium">Delete all?</span>
                <button
                  type="button"
                  onClick={() => {
                    onClearAll();
                    setConfirmClear(false);
                  }}
                  className="font-bold text-red-700 hover:underline cursor-pointer"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="text-slate-600 hover:underline cursor-pointer"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-700 text-slate-600 text-xs font-medium rounded-lg cursor-pointer"
              >
                Clear All
              </button>
            )}
          </div>
        </div>

        {/* Interactive Saved Map Preview (Shows exact roads, turns, curves, 3W/4W junctions, and houses) */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-3.5 py-2 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/70">
            <span className="text-xs font-semibold text-slate-800">
              Saved Map Preview (All Roads, Turns, Junctions &amp; Houses)
            </span>
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              Tap any house marker to track directly
            </span>
          </div>
          <div className="h-[270px] sm:h-[340px] lg:h-[380px] w-full relative">{mapSlot}</div>
        </div>

        {/* Houses & Roads Lists */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {/* Houses Section */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <h2 className="text-sm font-semibold text-slate-900">
                House Numbers ({filteredHouses.length})
              </h2>
              <div className="relative w-full sm:w-56">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter house no. or road..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                />
              </div>
            </div>

            {filteredHouses.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No saved house numbers match your filter.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 max-h-[420px] overflow-y-auto">
                {filteredHouses.map((h) => (
                  <div key={h.id} className="p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">
                        House #{h.houseNumber}{' '}
                        <span
                          className={`text-xs font-medium ${
                            h.side === 'left' ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          · {h.side === 'left' ? 'Left' : 'Right'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 font-mono tabular-nums truncate">
                        {h.roadName}
                        {h.note ? ` · ${h.note}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          onFocusHouse(h);
                          scrollToMap();
                        }}
                        title="Show on Preview Map"
                        className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigateHouse(h)}
                        className="px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        Track
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteHouse(h.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg cursor-pointer"
                        aria-label={`Delete house ${h.houseNumber}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Roads Section */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-3.5 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">
                Walked Village Roads ({roads.length})
              </h2>
            </div>

            {roads.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No roads saved yet. Start walking in Add mode to record a road.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 max-h-[420px] overflow-y-auto">
                {roads.map((r) => (
                  <div key={r.id} className="p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{r.name}</div>
                      <div className="text-xs text-slate-500 truncate">
                        {r.villageName} · {getSurfaceLabel(r.surface)} ·{' '}
                        <span className="font-mono tabular-nums">
                          {formatDistance(r.distanceMeters)} · {r.points.length} pts
                          {r.junctions && r.junctions.length > 0
                            ? ` · ${r.junctions.length} jnc`
                            : ''}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          onFocusRoad(r);
                          scrollToMap();
                        }}
                        title="Show Road on Preview Map"
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-lg inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteRoad(r.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg cursor-pointer"
                        aria-label={`Delete road ${r.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
