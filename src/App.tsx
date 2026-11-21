import {
  ChevronDown,
  ChevronUp,
  Eye,
  Hash,
  Loader2,
  MapPin,
  Navigation,
  PlusCircle,
  Search,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AddWalkWorkspace, { type StraightSymbolAction } from './components/AddWalkWorkspace.tsx';
import NavigationPanel from './components/NavigationPanel.tsx';
import SavedDataView from './components/SavedDataView.tsx';
import VillageMap, { type MapInteractionMode } from './components/VillageMap.tsx';
import type {
  CaptureMode,
  HouseSide,
  LatLngPoint,
  RoadJunction,
  VillageHouse,
  VillageRoad,
} from './types/map.ts';
import {
  calculateBearing,
  computeLiveRouteProgress,
  computePathDistance,
  findRoutesToHouse,
  formatDistance,
  getNextSequentialHouseNumber,
  haversineMeters,
  offsetCoord,
} from './utils/geo.ts';
import {
  type GpsPrecisionMode,
  PrecisionGpsSmoother,
  evaluateGpsFix,
} from './utils/gpsFilter.ts';
import {
  type NominatimSearchResult,
  reverseGeocodeVillage,
  searchPlaceNominatim,
} from './utils/osmClient.ts';
import { clearLocalStore, loadLocalStore, saveLocalStore } from './utils/storage.ts';

type WorkspaceMode = 'navigate' | 'add' | 'preview';

const DRAFT_WALK_KEY = 'grampath_walk_draft_v2';

export default function App() {
  const [mode, setMode] = useState<WorkspaceMode>('navigate');

  // LocalStorage data (roads + left/right houses)
  const initialStore = useMemo(() => loadLocalStore(), []);
  const [roads, setRoads] = useState<VillageRoad[]>(initialStore.roads);
  const [houses, setHouses] = useState<VillageHouse[]>(initialStore.houses);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    saveLocalStore({ roads, houses });
  }, [roads, houses]);

  // Top Nav Search 1: Village / Location Search
  const [areaQuery, setAreaQuery] = useState('');
  const [areaResults, setAreaResults] = useState<NominatimSearchResult[]>([]);
  const [isSearchingArea, setIsSearchingArea] = useState(false);

  // Top Nav Search 2: ONLY House Number Search
  const [houseQuery, setHouseQuery] = useState('');
  const [houseDropdownOpen, setHouseDropdownOpen] = useState(false);

  // Accurate GPS State (Max 5m filter by default with Kalman smoothing)
  const [gpsPrecisionMode, setGpsPrecisionMode] = useState<GpsPrecisionMode>('accurate_5m');
  const [userLocation, setUserLocation] = useState<LatLngPoint>({
    lat: 24.9852,
    lng: 82.0625,
    accuracy: 3.0,
  });
  const [isLiveGps, setIsLiveGps] = useState(false);
  const [isPickingSpot, setIsPickingSpot] = useState(false);
  const [userHeadingDeg, setUserHeadingDeg] = useState<number | null>(null);
  const [navOrigin, setNavOrigin] = useState<{ lat: number; lng: number }>({
    lat: 24.9852,
    lng: 82.0625,
  });
  const navWatchIdRef = useRef<number | null>(null);
  const lastNavGpsRef = useRef<LatLngPoint | null>(null);
  const lastAddGpsRef = useRef<LatLngPoint | null>(null);
  const gpsSmootherRef = useRef(new PrecisionGpsSmoother());

  const gpsQuality = useMemo(
    () => evaluateGpsFix(userLocation.accuracy, gpsPrecisionMode),
    [userLocation.accuracy, gpsPrecisionMode]
  );

  const mapViewRef = useRef<{ lat: number; lng: number; zoom: number; bearing?: number }>({
    lat: 24.986,
    lng: 82.0633,
    zoom: 18,
    bearing: 0,
  });
  const autoFollowGpsRef = useRef(true);
  const [isFollowingGps, setIsFollowingGps] = useState(true);

  const [focusTarget, setFocusTarget] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
    boundsPoints?: { lat: number; lng: number }[];
    key: number;
  } | null>(null);

  // Live Turn-by-Turn Navigation State
  const [targetHouse, setTargetHouse] = useState<VillageHouse | null>(null);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [currentNavStepIdx, setCurrentNavStepIdx] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [isSimulatingNav, setIsSimulatingNav] = useState(false);
  const simIdxRef = useRef<number>(0);
  const lastSpokenRef = useRef<number>(-1);
  const arrivedHouseIdRef = useRef<string | null>(null);

  // Add / Walk & Left/Right House Recording State (multi-segment so Pause->Resume never bridges gaps)
  const [captureMode, setCaptureMode] = useState<CaptureMode>('straight_walk');
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [walkSegments, setWalkSegments] = useState<LatLngPoint[][]>(() => {
    try {
      const saved = localStorage.getItem(DRAFT_WALK_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          segments?: LatLngPoint[][];
          points?: LatLngPoint[];
        };
        if (Array.isArray(parsed.segments)) return parsed.segments;
        if (Array.isArray(parsed.points) && parsed.points.length > 0) return [parsed.points];
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [draftHouses, setDraftHouses] = useState<VillageHouse[]>(() => {
    try {
      const saved = localStorage.getItem(DRAFT_WALK_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { draftHouses?: VillageHouse[] };
        return Array.isArray(parsed.draftHouses) ? parsed.draftHouses : [];
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [draftJunctions, setDraftJunctions] = useState<RoadJunction[]>(() => {
    try {
      const saved = localStorage.getItem(DRAFT_WALK_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { draftJunctions?: RoadJunction[] };
        return Array.isArray(parsed.draftJunctions) ? parsed.draftJunctions : [];
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [straightHeadingDeg, setStraightHeadingDeg] = useState<number | null>(null);
  const straightHeadingRef = useRef<number | null>(null);
  const straightAnchorCountRef = useRef<number>(1);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [detectedVillage, setDetectedVillage] = useState('Koraon Gram');
  const walkWatchIdRef = useRef<number | null>(null);
  const lastAcceptedWalkTsRef = useRef<number>(0);
  const lastReverseRef = useRef<{ lat: number; lng: number } | null>(null);
  const recordingStateRef = useRef({
    isRecording,
    isPaused,
    gpsPrecisionMode,
    captureMode,
  });
  recordingStateRef.current = { isRecording, isPaused, gpsPrecisionMode, captureMode };

  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3600);
    return () => clearTimeout(t);
  }, [toastMessage]);

  useEffect(() => {
    try {
      const hasPoints = walkSegments.some((seg) => seg.length > 0);
      if (hasPoints || draftHouses.length > 0 || draftJunctions.length > 0) {
        localStorage.setItem(
          DRAFT_WALK_KEY,
          JSON.stringify({ segments: walkSegments, draftHouses, draftJunctions })
        );
      } else {
        localStorage.removeItem(DRAFT_WALK_KEY);
      }
    } catch {
      // ignore
    }
  }, [walkSegments, draftHouses, draftJunctions]);

  const maybeDetectVillage = useCallback(async (lat: number, lng: number) => {
    const prev = lastReverseRef.current;
    if (prev && haversineMeters(prev, { lat, lng }) < 800) return;
    lastReverseRef.current = { lat, lng };
    const name = await reverseGeocodeVillage(lat, lng);
    if (name) setDetectedVillage(name);
  }, []);

  // Live GPS Watcher in Navigate mode (Kalman smoothed + heading + spike rejection)
  useEffect(() => {
    if (!isLiveGps) {
      if (navWatchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(navWatchIdRef.current);
        navWatchIdRef.current = null;
      }
      return;
    }
    if (!('geolocation' in navigator)) {
      showToast('GPS unavailable in this browser. Tap Set Spot on Map instead.');
      setIsLiveGps(false);
      return;
    }
    gpsSmootherRef.current.reset();
    navWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const nowTs = pos.timestamp || Date.now();
        const rawPt: LatLngPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: nowTs,
        };
        const prevPt = lastNavGpsRef.current;
        const ageMs = prevPt?.timestamp ? nowTs - prevPt.timestamp : Infinity;
        // Reject sudden coarse accuracy spikes (>35m) when we have a recent accurate fix
        if (
          rawPt.accuracy != null &&
          rawPt.accuracy > 35 &&
          prevPt &&
          (prevPt.accuracy ?? 99) < 20 &&
          ageMs < 12000
        ) {
          return;
        }

        const smoothed = gpsSmootherRef.current.update(rawPt, prevPt?.timestamp);
        if (
          pos.coords.heading != null &&
          Number.isFinite(pos.coords.heading) &&
          pos.coords.speed != null &&
          pos.coords.speed >= 0.5
        ) {
          setUserHeadingDeg(pos.coords.heading);
        } else if (prevPt && haversineMeters(prevPt, smoothed) >= 1.5) {
          setUserHeadingDeg(calculateBearing(prevPt, smoothed));
        }

        lastNavGpsRef.current = smoothed;
        setUserLocation(smoothed);
        if (autoFollowGpsRef.current) {
          setFocusTarget({ lat: smoothed.lat, lng: smoothed.lng, key: Date.now() });
        }
        maybeDetectVillage(smoothed.lat, smoothed.lng);
      },
      () => {
        showToast('Could not read GPS. Tap Set Spot on Map to place your marker.');
        setIsLiveGps(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
    );
    return () => {
      if (navWatchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(navWatchIdRef.current);
        navWatchIdRef.current = null;
      }
    };
  }, [isLiveGps, maybeDetectVillage, showToast]);

  // Walk Timer
  useEffect(() => {
    if (!isRecording || isPaused) return;
    const t = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [isRecording, isPaused]);

  // Live GPS Watcher in Add Mode: stays active BEFORE start AND while PAUSED so user always sees live location,
  // while ONLY recording road vertices when isRecording && !isPaused!
  useEffect(() => {
    if (mode !== 'add' || (captureMode !== 'gps_walk' && captureMode !== 'straight_walk')) {
      if (walkWatchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(walkWatchIdRef.current);
        walkWatchIdRef.current = null;
      }
      return;
    }
    if (!('geolocation' in navigator)) {
      setGpsError('Geolocation unavailable. Use Tap or Test Walk.');
      return;
    }
    setGpsError(null);
    gpsSmootherRef.current.reset();

    walkWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const {
          isRecording: activeRec,
          isPaused: pausedRec,
          gpsPrecisionMode: pMode,
          captureMode: cMode,
        } = recordingStateRef.current;

        const rawPt: LatLngPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp || Date.now(),
        };
        const prevPt = lastAddGpsRef.current;
        const quality = evaluateGpsFix(rawPt.accuracy, pMode);
        const smoothed = gpsSmootherRef.current.update(rawPt, prevPt?.timestamp);

        if (
          pos.coords.heading != null &&
          Number.isFinite(pos.coords.heading) &&
          pos.coords.speed != null &&
          pos.coords.speed >= 0.5
        ) {
          setUserHeadingDeg(pos.coords.heading);
        } else if (prevPt && haversineMeters(prevPt, smoothed) >= 1.5) {
          setUserHeadingDeg(calculateBearing(prevPt, smoothed));
        }

        lastAddGpsRef.current = smoothed;
        setUserLocation(smoothed);
        if (autoFollowGpsRef.current) {
          setFocusTarget({ lat: smoothed.lat, lng: smoothed.lng, key: Date.now() });
        }
        maybeDetectVillage(smoothed.lat, smoothed.lng);

        const nowTs = rawPt.timestamp || Date.now();
        const fallbackSmoothOk =
          rawPt.accuracy != null &&
          rawPt.accuracy <= 12.0 &&
          nowTs - lastAcceptedWalkTsRef.current >= 2500;

        if (!quality.accepted && !fallbackSmoothOk) {
          if (activeRec && !pausedRec) {
            setGpsError(
              pMode === 'accurate_5m'
                ? 'Waiting for ≤5m GPS lock outdoors'
                : 'Weak GPS (>15m). Move to open sky'
            );
          }
          return;
        }
        if (quality.accepted) {
          setGpsError(null);
        } else if (activeRec && !pausedRec) {
          setGpsError(
            `GPS ±${Math.round(rawPt.accuracy ?? 0)}m · smoothing straight line (best ≤5m)`
          );
        }

        // When paused or not yet started, keep live GPS dot moving without recording road points!
        if (!activeRec || pausedRec) return;

        lastAcceptedWalkTsRef.current = nowTs;

        if (cMode === 'straight_walk') {
          let nextStraightHeading: number | null = null;
          setWalkSegments((prev) => {
            if (prev.length === 0) {
              straightAnchorCountRef.current = 1;
              return [[smoothed]];
            }
            const next = [...prev];
            const lastIdx = next.length - 1;
            const activeSeg = next[lastIdx];
            if (activeSeg.length === 0) {
              straightAnchorCountRef.current = 1;
              next[lastIdx] = [smoothed];
              return next;
            }

            const anchorCount = Math.max(
              1,
              Math.min(straightAnchorCountRef.current, activeSeg.length)
            );
            const anchor = activeSeg[anchorCount - 1];
            const distFromAnchor = haversineMeters(anchor, smoothed);

            if (distFromAnchor < 1.2) return prev;

            const currentTip = activeSeg[activeSeg.length - 1];
            const movedSinceTip = haversineMeters(currentTip, smoothed);
            if (activeSeg.length > anchorCount && movedSinceTip < 0.8) {
              return prev;
            }

            nextStraightHeading = calculateBearing(anchor, smoothed);
            straightHeadingRef.current = nextStraightHeading;
            next[lastIdx] = [...activeSeg.slice(0, anchorCount), smoothed];
            return next;
          });
          if (nextStraightHeading != null) {
            setStraightHeadingDeg(nextStraightHeading);
          }
          return;
        }

        const minStepMeters = pMode === 'accurate_5m' ? 1.5 : 2.5;
        setWalkSegments((prev) => {
          if (prev.length === 0) return [[smoothed]];
          const next = [...prev];
          const lastIdx = next.length - 1;
          const activeSeg = next[lastIdx];
          if (activeSeg.length === 0) {
            next[lastIdx] = [smoothed];
            return next;
          }
          if (haversineMeters(activeSeg[activeSeg.length - 1], smoothed) < minStepMeters) {
            return prev;
          }
          next[lastIdx] = [...activeSeg, smoothed];
          return next;
        });
      },
      (err) => {
        setGpsError(
          err.code === err.PERMISSION_DENIED
            ? 'GPS permission denied. Switch to Tap or Test Walk.'
            : `Waiting for GPS: ${err.message}`
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
    return () => {
      if (walkWatchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(walkWatchIdRef.current);
        walkWatchIdRef.current = null;
      }
    };
  }, [mode, captureMode, maybeDetectVillage]);

  // House Number matching for Top-Nav Search Bar 2
  const matchingHouses = useMemo(() => {
    const q = houseQuery.trim().toLowerCase();
    if (!q) return houses.slice(0, 8);
    return houses
      .filter((h) => h.houseNumber.toLowerCase().includes(q))
      .sort((a, b) => {
        const aExact = a.houseNumber.toLowerCase() === q ? 0 : 1;
        const bExact = b.houseNumber.toLowerCase() === q ? 0 : 1;
        return aExact - bExact;
      });
  }, [houses, houseQuery]);

  // Compute up to 3 saved-road routes from navOrigin to target House for distance/time comparison
  const navRouteOptions = useMemo(() => {
    if (!targetHouse) return [];
    return findRoutesToHouse(roads, navOrigin, targetHouse, 3);
  }, [targetHouse, roads, navOrigin]);

  const safeSelectedRouteIndex =
    navRouteOptions.length > 0 ? Math.min(selectedRouteIndex, navRouteOptions.length - 1) : 0;
  const navRouteResult = navRouteOptions[safeSelectedRouteIndex] ?? null;

  // Real-time progress (covered behind vs remaining ahead, forward/backward step, heading status)
  const liveProgress = useMemo(() => {
    if (!targetHouse || !navRouteResult) return null;
    return computeLiveRouteProgress(navRouteResult, userLocation, userHeadingDeg);
  }, [targetHouse, navRouteResult, userLocation, userHeadingDeg]);

  // Automatic reroute if user goes more than 25m off the active road path
  useEffect(() => {
    if (!targetHouse || !liveProgress || liveProgress.offRouteMeters <= 25) return;
    setNavOrigin({ lat: userLocation.lat, lng: userLocation.lng });
  }, [targetHouse, liveProgress, userLocation.lat, userLocation.lng]);

  // Notify once on live GPS arrival within 6 meters
  useEffect(() => {
    if (!targetHouse || !liveProgress || isSimulatingNav) return;
    if (liveProgress.remainingMeters <= 6 && arrivedHouseIdRef.current !== targetHouse.id) {
      arrivedHouseIdRef.current = targetHouse.id;
      showToast(
        `Arrived: House #${targetHouse.houseNumber} is on your ${
          targetHouse.side === 'left' ? 'Left' : 'Right'
        }!`
      );
    }
  }, [targetHouse, liveProgress, isSimulatingNav, showToast]);

  const nextSuggestedHouse = useMemo(
    () => getNextSequentialHouseNumber(houses, draftHouses),
    [houses, draftHouses]
  );

  // Bidirectional active step (advances when walking forward, reverts when walking backward)
  const activeNavStepIdx = useMemo(() => {
    if (!targetHouse || !navRouteResult?.reachable || navRouteResult.instructions.length === 0) {
      return 0;
    }
    if (liveProgress) {
      return Math.min(liveProgress.activeStepIndex, navRouteResult.instructions.length - 1);
    }
    return Math.min(currentNavStepIdx, navRouteResult.instructions.length - 1);
  }, [targetHouse, navRouteResult, liveProgress, currentNavStepIdx]);

  const activeNavInstruction =
    targetHouse && navRouteResult?.reachable && navRouteResult.instructions.length > 0
      ? navRouteResult.instructions[activeNavStepIdx]
      : null;

  const distanceToNextTurnMeters = useMemo(() => {
    if (!targetHouse || !navRouteResult?.reachable || !activeNavInstruction) return null;
    if (liveProgress) return liveProgress.distanceToNextTurnMeters;
    const nextInst = navRouteResult.instructions[activeNavStepIdx + 1];
    const targetPt = nextInst ? nextInst.anchorPoint : activeNavInstruction.anchorPoint;
    return Math.round(haversineMeters(userLocation, targetPt));
  }, [targetHouse, navRouteResult, activeNavInstruction, liveProgress, activeNavStepIdx, userLocation]);

  // Voice guidance
  useEffect(() => {
    if (!voiceEnabled || !targetHouse || !activeNavInstruction) return;
    if (lastSpokenRef.current === activeNavStepIdx) return;
    lastSpokenRef.current = activeNavStepIdx;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(activeNavInstruction.instruction);
      utter.rate = 0.95;
      window.speechSynthesis.speak(utter);
    }
  }, [voiceEnabled, targetHouse, activeNavInstruction, activeNavStepIdx]);

  // Navigation Simulation Controls
  const stepNavSimulation = useCallback(() => {
    if (!navRouteResult?.reachable || navRouteResult.polyline.length < 2) return;
    const poly = navRouteResult.polyline;
    const prevIdx = Math.min(simIdxRef.current, poly.length - 1);
    const nextIdx = Math.min(prevIdx + 1, poly.length - 1);
    simIdxRef.current = nextIdx;
    const prevPt = poly[prevIdx];
    const pt = poly[nextIdx];
    if (prevIdx !== nextIdx && haversineMeters(prevPt, pt) >= 0.5) {
      setUserHeadingDeg(calculateBearing(prevPt, pt));
    }
    setUserLocation({ lat: pt.lat, lng: pt.lng, accuracy: 1.5, timestamp: Date.now() });
    if (autoFollowGpsRef.current) {
      setFocusTarget({ lat: pt.lat, lng: pt.lng, key: Date.now() });
    }
    if (nextIdx >= poly.length - 1) {
      setIsSimulatingNav(false);
      setCurrentNavStepIdx(navRouteResult.instructions.length - 1);
      showToast(
        `Arrived: House #${targetHouse?.houseNumber} is on your ${
          targetHouse?.side === 'left' ? 'Left' : 'Right'
        }!`
      );
    }
  }, [navRouteResult, targetHouse, showToast]);

  useEffect(() => {
    if (!isSimulatingNav || !targetHouse) return;
    const t = setInterval(stepNavSimulation, 1400);
    return () => clearInterval(t);
  }, [isSimulatingNav, targetHouse, stepNavSimulation]);

  const handleLocateMe = useCallback(
    (panToGps: boolean | unknown = true) => {
      const shouldPan = panToGps !== false;
      if (shouldPan) {
        autoFollowGpsRef.current = true;
        setIsFollowingGps(true);
      }
      if (!('geolocation' in navigator)) {
        showToast('GPS unavailable. Tap Set Spot on Map or use Test Walk.');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const pt: LatLngPoint = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp || Date.now(),
          };
          if (pos.coords.heading != null && Number.isFinite(pos.coords.heading)) {
            setUserHeadingDeg(pos.coords.heading);
          }
          lastNavGpsRef.current = pt;
          setUserLocation(pt);
          setNavOrigin((prev) =>
            haversineMeters(prev, pt) > 25 ? { lat: pt.lat, lng: pt.lng } : prev
          );
          if (shouldPan && autoFollowGpsRef.current) {
            setFocusTarget({ lat: pt.lat, lng: pt.lng, key: Date.now() });
          }
          maybeDetectVillage(pt.lat, pt.lng);
        },
        () => {
          if (shouldPan) {
            showToast('Could not access GPS. Use Set Spot on Map or Test Walk.');
          }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    },
    [maybeDetectVillage, showToast]
  );

  const handleFitAllSaved = useCallback(
    (roadList: VillageRoad[] = roads, houseList: VillageHouse[] = houses) => {
      const pts: { lat: number; lng: number }[] = [
        ...roadList.flatMap((r) => r.points.map((p) => ({ lat: p.lat, lng: p.lng }))),
        ...houseList.map((h) => ({ lat: h.lat, lng: h.lng })),
      ];
      if (pts.length >= 2) {
        setFocusTarget({
          lat: pts[0].lat,
          lng: pts[0].lng,
          boundsPoints: pts,
          key: Date.now(),
        });
      } else if (pts.length === 1) {
        setFocusTarget({
          lat: pts[0].lat,
          lng: pts[0].lng,
          zoom: 18,
          key: Date.now(),
        });
      }
    },
    [roads, houses]
  );

  const startNavigateToHouse = useCallback(
    (house: VillageHouse) => {
      setMode('navigate');
      setTargetHouse(house);
      setNavOrigin({ lat: userLocation.lat, lng: userLocation.lng });
      setSelectedRouteIndex(0);
      setCurrentNavStepIdx(0);
      simIdxRef.current = 0;
      lastSpokenRef.current = -1;
      arrivedHouseIdRef.current = null;
      setIsSimulatingNav(false);
      setIsPickingSpot(false);
      setHouseDropdownOpen(false);
      autoFollowGpsRef.current = true;
      setIsFollowingGps(true);
      if ('geolocation' in navigator) {
        setIsLiveGps(true);
        handleLocateMe(false);
      }

      const initialRoutes = findRoutesToHouse(roads, userLocation, house, 3);
      const bestRoute = initialRoutes[0];
      const targetRoad = roads.find((r) => r.id === house.roadId);
      const distToHouse = haversineMeters(userLocation, house);

      if (bestRoute?.reachable && bestRoute.polyline.length >= 2 && distToHouse <= 5000) {
        const framePts = [
          { lat: userLocation.lat, lng: userLocation.lng },
          ...bestRoute.polyline.map((p) => ({ lat: p.lat, lng: p.lng })),
          { lat: house.lat, lng: house.lng },
        ];
        setFocusTarget({
          lat: house.lat,
          lng: house.lng,
          boundsPoints: framePts,
          key: Date.now(),
        });
      } else if (targetRoad && targetRoad.points.length >= 2) {
        const framePts = [
          ...targetRoad.points.map((p) => ({ lat: p.lat, lng: p.lng })),
          { lat: house.lat, lng: house.lng },
        ];
        setFocusTarget({
          lat: house.lat,
          lng: house.lng,
          boundsPoints: framePts,
          key: Date.now(),
        });
      } else {
        setFocusTarget({
          lat: house.lat,
          lng: house.lng,
          zoom: mapViewRef.current.zoom < 17 ? 18 : undefined,
          key: Date.now(),
        });
      }
    },
    [roads, userLocation, handleLocateMe]
  );

  const handleExitNavigation = useCallback(() => {
    setTargetHouse(null);
    setIsSimulatingNav(false);
    arrivedHouseIdRef.current = null;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  const handleHouseSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!houseQuery.trim()) return;
    if (matchingHouses.length > 0) {
      startNavigateToHouse(matchingHouses[0]);
    } else {
      showToast(`House #${houseQuery.trim()} is not saved yet.`);
    }
  };

  const handleAreaSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (areaQuery.trim().length < 2) return;
    setIsSearchingArea(true);
    try {
      const results = await searchPlaceNominatim(areaQuery);
      setAreaResults(results);
    } finally {
      setIsSearchingArea(false);
    }
  };

  // Add / Walk Actions
  const handleStartWalk = () => {
    setMode('add');
    setTargetHouse(null);
    setIsRecording(true);
    setIsPaused(false);
    setGpsError(null);
    const hasAnyPoints = walkSegments.some((s) => s.length > 0);
    if (!hasAnyPoints) {
      if (captureMode === 'simulated_walk') {
        const startPt: LatLngPoint = {
          lat: userLocation.lat,
          lng: userLocation.lng,
          accuracy: 2.5,
          timestamp: Date.now(),
        };
        setWalkSegments([[startPt]]);
        if (autoFollowGpsRef.current) {
          setFocusTarget({ lat: startPt.lat, lng: startPt.lng, key: Date.now() });
        }
      } else if (captureMode === 'straight_walk') {
        const startPt: LatLngPoint = {
          lat: userLocation.lat,
          lng: userLocation.lng,
          accuracy: userLocation.accuracy ?? 2.5,
          timestamp: Date.now(),
        };
        setWalkSegments([[startPt]]);
        straightAnchorCountRef.current = 1;
        straightHeadingRef.current = null;
        setStraightHeadingDeg(null);
        lastAcceptedWalkTsRef.current = 0;
        if (autoFollowGpsRef.current) {
          setFocusTarget({ lat: startPt.lat, lng: startPt.lng, key: Date.now() });
        }
      } else if (captureMode === 'gps_walk') {
        if (gpsQuality.accepted) {
          setWalkSegments([[userLocation]]);
        } else {
          setWalkSegments([[]]);
        }
        // Only pan if user hasn't manually moved the map, and never change their zoom
        if (autoFollowGpsRef.current) {
          setFocusTarget({ lat: userLocation.lat, lng: userLocation.lng, key: Date.now() });
        }
      }
    }
  };

  const handlePauseResumeWalk = () => {
    if (!isPaused) {
      setIsPaused(true);
      return;
    }
    // Resuming: if user moved > 6m while paused, start a NEW road segment so no straight line bridges the gap!
    setWalkSegments((prev) => {
      const lastNonEmpty = [...prev].reverse().find((s) => s.length > 0);
      const lastPt = lastNonEmpty ? lastNonEmpty[lastNonEmpty.length - 1] : null;
      if (lastPt && haversineMeters(lastPt, userLocation) > 6) {
        if (captureMode === 'straight_walk') {
          straightAnchorCountRef.current = 1;
          straightHeadingRef.current = null;
          setStraightHeadingDeg(null);
          return [...prev, [{ ...userLocation, timestamp: Date.now() }]];
        }
        const startOfNewSeg =
          captureMode === 'gps_walk' && gpsQuality.accepted ? [userLocation] : [];
        return [...prev, startOfNewSeg];
      }
      return prev.length === 0 ? [[]] : prev;
    });
    setIsPaused(false);
  };

  const handleUndoLastPoint = () => {
    setWalkSegments((prev) => {
      const next = [...prev];
      while (next.length > 0 && next[next.length - 1].length === 0) {
        next.pop();
      }
      if (next.length === 0) return [];
      const lastIdx = next.length - 1;
      const removedPt = next[lastIdx][next[lastIdx].length - 1];
      next[lastIdx] = next[lastIdx].slice(0, -1);
      if (next[lastIdx].length === 0 && next.length > 1) {
        next.pop();
      }
      const updatedSeg = next[next.length - 1] ?? [];
      straightAnchorCountRef.current = Math.max(1, updatedSeg.length);
      if (updatedSeg.length >= 2) {
        const b = calculateBearing(
          updatedSeg[updatedSeg.length - 2],
          updatedSeg[updatedSeg.length - 1]
        );
        straightHeadingRef.current = b;
        setStraightHeadingDeg(b);
      } else {
        straightHeadingRef.current = null;
        setStraightHeadingDeg(null);
      }
      if (removedPt) {
        setDraftJunctions((jPrev) =>
          jPrev.filter((j) => haversineMeters(j, removedPt) > 1.5)
        );
      }
      return next;
    });
  };

  const handleStraightSymbol = (action: StraightSymbolAction) => {
    const activeSeg = walkSegments[walkSegments.length - 1] ?? [];
    const currentTip = activeSeg[activeSeg.length - 1] ?? userLocation;
    const prevVertex = activeSeg.length >= 2 ? activeSeg[activeSeg.length - 2] : null;
    const inferredBearing = prevVertex
      ? calculateBearing(prevVertex, currentTip)
      : straightHeadingRef.current ?? userHeadingDeg ?? 0;

    if (action === 'nudge_left' || action === 'nudge_right') {
      const delta = action === 'nudge_left' ? -15 : 15;
      const nextH = (inferredBearing + delta + 360) % 360;
      straightHeadingRef.current = nextH;
      setStraightHeadingDeg(nextH);
      const anchorCount = Math.max(1, Math.min(straightAnchorCountRef.current, activeSeg.length));
      if (activeSeg.length > anchorCount) {
        const anchor = activeSeg[anchorCount - 1];
        const len = Math.max(3, haversineMeters(anchor, currentTip));
        const swung = offsetCoord(anchor, nextH, len);
        const swungPt: LatLngPoint = {
          lat: swung.lat,
          lng: swung.lng,
          accuracy: 2.0,
          timestamp: Date.now(),
        };
        setWalkSegments((prev) => {
          const next = [...prev];
          const idx = next.length - 1;
          next[idx] = [...next[idx].slice(0, anchorCount), swungPt];
          return next;
        });
      }
      return;
    }

    if (action === 'straight_step') {
      const h = straightHeadingRef.current ?? inferredBearing;
      straightHeadingRef.current = h;
      setStraightHeadingDeg(h);
      setUserHeadingDeg(h);
      const extended = offsetCoord(currentTip, h, 5);
      const pt: LatLngPoint = {
        lat: extended.lat,
        lng: extended.lng,
        accuracy: 2.0,
        timestamp: Date.now(),
      };
      setUserLocation(pt);
      if (autoFollowGpsRef.current) {
        setFocusTarget({ lat: pt.lat, lng: pt.lng, key: Date.now() });
      }
      setWalkSegments((prev) => {
        const next = prev.length > 0 ? [...prev] : [[{ ...userLocation, timestamp: Date.now() }]];
        const idx = next.length - 1;
        const seg = next[idx];
        const anchorCount = Math.max(1, Math.min(straightAnchorCountRef.current, seg.length));
        next[idx] = [...seg.slice(0, anchorCount), pt];
        return next;
      });
      return;
    }

    if (action === 'turn_left' || action === 'turn_right') {
      const nextH = (inferredBearing + (action === 'turn_left' ? 270 : 90)) % 360;
      straightHeadingRef.current = nextH;
      setStraightHeadingDeg(nextH);
      setUserHeadingDeg(nextH);
      const cornerPt: LatLngPoint = {
        lat: userLocation.lat,
        lng: userLocation.lng,
        accuracy: userLocation.accuracy ?? 2.5,
        timestamp: Date.now(),
      };
      setWalkSegments((prev) => {
        const next = prev.length > 0 ? [...prev] : [[cornerPt]];
        const idx = next.length - 1;
        const seg = next[idx];
        const anchorCount = Math.max(1, Math.min(straightAnchorCountRef.current, seg.length));
        const lockedSeg =
          seg.length === 0
            ? [cornerPt]
            : haversineMeters(seg[seg.length - 1], cornerPt) >= 0.8
            ? [...seg.slice(0, anchorCount), cornerPt]
            : seg;
        straightAnchorCountRef.current = lockedSeg.length;
        next[idx] = lockedSeg;
        return next;
      });
      showToast(
        action === 'turn_left'
          ? 'Left turn locked · Keep walking straight'
          : 'Right turn locked · Keep walking straight'
      );
      return;
    }

    if (action === 'curve_left' || action === 'curve_right') {
      const delta = action === 'curve_left' ? -45 : 45;
      const nextH = (inferredBearing + delta + 360) % 360;
      straightHeadingRef.current = nextH;
      setStraightHeadingDeg(nextH);
      setUserHeadingDeg(nextH);
      let cursor: { lat: number; lng: number } =
        activeSeg.length > 0 ? currentTip : { lat: userLocation.lat, lng: userLocation.lng };
      const arcPts: LatLngPoint[] = [];
      const steps = 5;
      for (let k = 1; k <= steps; k++) {
        const stepH = (inferredBearing + (delta * k) / steps + 360) % 360;
        const p = offsetCoord(cursor, stepH, 1.2);
        const pt: LatLngPoint = {
          lat: p.lat,
          lng: p.lng,
          accuracy: 2.0,
          timestamp: Date.now(),
        };
        arcPts.push(pt);
        cursor = pt;
      }
      setWalkSegments((prev) => {
        const next = prev.length > 0 ? [...prev] : [[{ ...userLocation, timestamp: Date.now() }]];
        const idx = next.length - 1;
        const seg = next[idx].length > 0 ? next[idx] : [{ ...userLocation, timestamp: Date.now() }];
        const merged = [...seg, ...arcPts];
        straightAnchorCountRef.current = merged.length;
        next[idx] = merged;
        return next;
      });
      showToast(
        action === 'curve_left'
          ? 'Smooth Left Curve added · Keep walking straight'
          : 'Smooth Right Curve added · Keep walking straight'
      );
    }
  };

  const handleStraightJunction = (
    type: '3-way' | '4-way',
    exitTurn: 'left' | 'straight' | 'right'
  ) => {
    const activeSeg = walkSegments[walkSegments.length - 1] ?? [];
    const currentTip = activeSeg[activeSeg.length - 1] ?? userLocation;
    const prevVertex = activeSeg.length >= 2 ? activeSeg[activeSeg.length - 2] : null;
    const currentH = prevVertex
      ? calculateBearing(prevVertex, currentTip)
      : straightHeadingRef.current ?? userHeadingDeg ?? 0;
    const turnOffset = exitTurn === 'left' ? 270 : exitTurn === 'right' ? 90 : 0;
    const nextH = (currentH + turnOffset) % 360;
    straightHeadingRef.current = nextH;
    setStraightHeadingDeg(nextH);
    setUserHeadingDeg(nextH);

    const cornerPt: LatLngPoint = {
      lat: userLocation.lat,
      lng: userLocation.lng,
      accuracy: userLocation.accuracy ?? 2.5,
      timestamp: Date.now(),
    };

    const newJunction: RoadJunction = {
      id: `jnc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type,
      lat: cornerPt.lat,
      lng: cornerPt.lng,
      headingDeg: currentH,
      exitTurn,
    };
    setDraftJunctions((prev) => [...prev, newJunction]);

    setWalkSegments((prev) => {
      const next = prev.length > 0 ? [...prev] : [[cornerPt]];
      const idx = next.length - 1;
      const seg = next[idx];
      const anchorCount = Math.max(1, Math.min(straightAnchorCountRef.current, seg.length));
      const lockedSeg =
        seg.length === 0
          ? [cornerPt]
          : haversineMeters(seg[seg.length - 1], cornerPt) >= 0.8
          ? [...seg.slice(0, anchorCount), cornerPt]
          : seg;
      straightAnchorCountRef.current = lockedSeg.length;
      next[idx] = lockedSeg;
      return next;
    });

    showToast(
      `${type === '4-way' ? '4-Way Chauraha' : '3-Way Junction'} marked · Walk ${exitTurn}`
    );
  };

  const handleSimulateStep = (dLat: number, dLng: number) => {
    setWalkSegments((prev) => {
      const next = prev.length > 0 ? [...prev] : [[]];
      const lastIdx = next.length - 1;
      const activeSeg = next[lastIdx];
      const last =
        activeSeg[activeSeg.length - 1] ?? { lat: userLocation.lat, lng: userLocation.lng };
      const nextPt: LatLngPoint = {
        lat: Number((last.lat + dLat).toFixed(7)),
        lng: Number((last.lng + dLng).toFixed(7)),
        accuracy: 2.0,
        timestamp: Date.now(),
      };
      setUserLocation(nextPt);
      if (autoFollowGpsRef.current) {
        setFocusTarget({ lat: nextPt.lat, lng: nextPt.lng, key: Date.now() });
      }
      next[lastIdx] = [...activeSeg, nextPt];
      return next;
    });
  };

  const handleAddHouseOnWalk = (houseNumber: string, side: HouseSide, note?: string) => {
    const activeSegIdx = Math.max(0, walkSegments.length - 1);
    const activeSeg = walkSegments[activeSegIdx] ?? [];
    const anchor = activeSeg[activeSeg.length - 1] ?? userLocation;
    const prevPt = activeSeg.length >= 2 ? activeSeg[activeSeg.length - 2] : null;
    const heading =
      captureMode === 'straight_walk' && straightHeadingRef.current != null
        ? straightHeadingRef.current
        : prevPt
        ? calculateBearing(prevPt, anchor)
        : 0;
    const sideBearing = side === 'left' ? (heading + 270) % 360 : (heading + 90) % 360;
    const visual = offsetCoord(anchor, sideBearing, 7);

    if (activeSeg.length === 0) {
      setWalkSegments((prev) => {
        const next = prev.length > 0 ? [...prev] : [[]];
        next[next.length - 1] = [{ lat: anchor.lat, lng: anchor.lng, timestamp: Date.now() }];
        return next;
      });
    }

    const newHouse: VillageHouse = {
      id: `house-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      houseNumber,
      side,
      lat: visual.lat,
      lng: visual.lng,
      roadLat: anchor.lat,
      roadLng: anchor.lng,
      roadId: 'draft',
      roadName: 'Current Walk Road',
      villageName: detectedVillage,
      segmentIndex: activeSegIdx,
      note,
      createdAt: new Date().toISOString(),
    };

    setDraftHouses((prev) => [...prev, newHouse]);
    showToast(`Added #${houseNumber} (${side === 'left' ? 'Left' : 'Right'})`);
  };

  const handleSaveWalkedRoad = (payload: {
    roadName: string;
    villageName: string;
    surface: VillageRoad['surface'];
  }) => {
    const validEntries = walkSegments
      .map((seg, origIdx) => {
        // Deduplicate near-identical points (<0.4m) while keeping every walked curve & road point intact
        const clean: LatLngPoint[] = [];
        for (const pt of seg) {
          if (clean.length === 0 || haversineMeters(clean[clean.length - 1], pt) >= 0.4) {
            clean.push(pt);
          }
        }
        return { origIdx, points: clean };
      })
      .filter((entry) => entry.points.length >= 2);

    if (validEntries.length === 0) return;

    const now = new Date().toISOString();
    const baseTs = Date.now();
    const newRoads: VillageRoad[] = validEntries.map((entry, idx) => {
      const segName =
        validEntries.length === 1 ? payload.roadName : `${payload.roadName} (Part ${idx + 1})`;
      return {
        id: `road-${baseTs}-${idx}`,
        name: segName,
        villageName: payload.villageName,
        surface: payload.surface,
        points: entry.points,
        junctions: idx === 0 && draftJunctions.length > 0 ? draftJunctions : undefined,
        distanceMeters: computePathDistance(entry.points),
        durationSeconds: Math.round(elapsedSeconds / validEntries.length),
        captureMode,
        createdAt: now,
      };
    });

    const roadByOrigSegment = new Map<number, VillageRoad>();
    validEntries.forEach((entry, idx) => {
      roadByOrigSegment.set(entry.origIdx, newRoads[idx]);
    });

    const finalizedHouses = draftHouses.map((h) => {
      const matchedRoad =
        (h.segmentIndex != null ? roadByOrigSegment.get(h.segmentIndex) : undefined) ??
        newRoads[0];
      return {
        ...h,
        roadId: matchedRoad.id,
        roadName: matchedRoad.name,
        villageName: payload.villageName,
      };
    });

    setRoads((prev) => [...newRoads, ...prev]);
    if (finalizedHouses.length > 0) {
      setHouses((prev) => [...finalizedHouses, ...prev]);
    }

    const totalSavedDist = newRoads.reduce((sum, r) => sum + r.distanceMeters, 0);
    setIsRecording(false);
    setIsPaused(false);
    setWalkSegments([]);
    setDraftHouses([]);
    setDraftJunctions([]);
    straightHeadingRef.current = null;
    straightAnchorCountRef.current = 1;
    setStraightHeadingDeg(null);
    setElapsedSeconds(0);
    showToast(
      `Saved "${payload.roadName}" (${formatDistance(totalSavedDist)}) & ${finalizedHouses.length} house(s)!`
    );
  };

  const handleDiscardWalk = () => {
    setIsRecording(false);
    setIsPaused(false);
    setWalkSegments([]);
    setDraftHouses([]);
    setDraftJunctions([]);
    straightHeadingRef.current = null;
    straightAnchorCountRef.current = 1;
    setStraightHeadingDeg(null);
    setElapsedSeconds(0);
    setGpsError(null);
  };

  const interactionMode: MapInteractionMode = useMemo(() => {
    if (isPickingSpot) return 'pick_user_location';
    if (mode === 'add' && isRecording && !isPaused && captureMode === 'manual_trace') {
      return 'manual_trace';
    }
    return 'browse';
  }, [isPickingSpot, mode, isRecording, isPaused, captureMode]);

  const handleMapClick = (lat: number, lng: number) => {
    if (interactionMode === 'manual_trace') {
      setWalkSegments((prev) => {
        const next = prev.length > 0 ? [...prev] : [[]];
        const lastIdx = next.length - 1;
        next[lastIdx] = [...next[lastIdx], { lat, lng, timestamp: Date.now() }];
        return next;
      });
      return;
    }
    if (interactionMode === 'pick_user_location') {
      setIsLiveGps(false);
      const pt: LatLngPoint = { lat, lng, accuracy: 2.0, timestamp: Date.now() };
      lastNavGpsRef.current = pt;
      setUserLocation(pt);
      setNavOrigin({ lat, lng });
      setIsPickingSpot(false);
      maybeDetectVillage(lat, lng);
      showToast('Updated your location spot on the map.');
    }
  };

  const isolateNavigation = mode === 'navigate' && Boolean(targetHouse);

  const previewMapElement = (
    <VillageMap
      roads={roads}
      houses={houses}
      draftHouses={[]}
      activeWalkSegments={[]}
      draftJunctions={[]}
      currentGps={userLocation}
      userHeadingDeg={userHeadingDeg}
      gpsQuality={gpsQuality}
      routeResult={null}
      alternativeRoutes={[]}
      liveProgress={null}
      targetHouse={null}
      isolateNavigation={false}
      activeInstruction={null}
      distanceToNextTurnMeters={null}
      interactionMode="browse"
      onMapClick={() => {}}
      onNavigateHouse={startNavigateToHouse}
      onCenterGps={() => handleLocateMe(true)}
      isFollowingGps={isFollowingGps}
      initialView={mapViewRef.current}
      onViewChange={(view) => {
        mapViewRef.current = view;
      }}
      onUserDrag={() => {
        autoFollowGpsRef.current = false;
        setIsFollowingGps(false);
      }}
      focusTarget={focusTarget}
    />
  );

  const mapElement = (
    <VillageMap
      roads={roads}
      houses={houses}
      draftHouses={draftHouses}
      activeWalkSegments={walkSegments}
      draftJunctions={draftJunctions}
      currentGps={userLocation}
      userHeadingDeg={userHeadingDeg}
      gpsQuality={gpsQuality}
      routeResult={navRouteResult}
      alternativeRoutes={navRouteOptions}
      liveProgress={mode === 'add' ? null : liveProgress}
      targetHouse={mode === 'add' ? null : targetHouse}
      isolateNavigation={isolateNavigation}
      activeInstruction={mode === 'add' ? null : activeNavInstruction}
      distanceToNextTurnMeters={mode === 'add' ? null : distanceToNextTurnMeters}
      interactionMode={interactionMode}
      onMapClick={handleMapClick}
      onNavigateHouse={startNavigateToHouse}
      onExitNavigation={handleExitNavigation}
      onCenterGps={() => handleLocateMe(true)}
      isFollowingGps={isFollowingGps}
      initialView={mapViewRef.current}
      onViewChange={(view) => {
        mapViewRef.current = view;
      }}
      onUserDrag={() => {
        autoFollowGpsRef.current = false;
        setIsFollowingGps(false);
      }}
      focusTarget={focusTarget}
    />
  );

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-50 text-slate-900">
      {/* Top Nav: Brand + Icon Mode Tabs (Navigate, Add, Preview) + Dual Search Bars (Area + House No.) */}
      <header className="shrink-0 bg-white border-b border-slate-200 px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2 z-40">
        {/* Brand + Icon Tabs */}
        <div className="flex items-center justify-between w-full lg:w-auto gap-3">
          <button
            type="button"
            onClick={() => {
              setMode('navigate');
              handleExitNavigation();
            }}
            className="text-base sm:text-lg font-bold tracking-tight text-slate-900 font-display whitespace-nowrap shrink-0 cursor-pointer"
          >
            GramPath
          </button>

          <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl shrink-0">
            <button
              type="button"
              onClick={() => setMode('navigate')}
              className={`px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                mode === 'navigate'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Navigation className="w-3.5 h-3.5 text-sky-700" />
              Navigate
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('add');
                setTargetHouse(null);
              }}
              className={`px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                mode === 'add'
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <PlusCircle className="w-3.5 h-3.5" />
              Add
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('preview');
                setTimeout(() => handleFitAllSaved(), 60);
              }}
              className={`px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                mode === 'preview'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-slate-700" />
              Preview ({houses.length})
            </button>
          </nav>
        </div>

        {/* Dual Search Bars: (1) Village / Area + (2) House Number Only */}
        <div className="flex flex-1 items-center gap-2 w-full lg:w-auto lg:max-w-xl">
          {/* Search Bar 1: Area / Village */}
          <div className="relative flex-1 min-w-[130px]">
            <form
              onSubmit={handleAreaSearchSubmit}
              className="flex items-center bg-slate-50 border border-slate-200 rounded-lg overflow-hidden"
            >
              <Search className="w-3.5 h-3.5 text-slate-400 ml-2 shrink-0" />
              <input
                type="text"
                placeholder="Search village / area..."
                value={areaQuery}
                onChange={(e) => setAreaQuery(e.target.value)}
                className="w-full px-2 py-1.5 text-xs text-slate-900 bg-transparent focus:outline-none"
              />
              {areaQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setAreaQuery('');
                    setAreaResults([]);
                  }}
                  className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="submit"
                disabled={isSearchingArea}
                className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-medium shrink-0 cursor-pointer"
              >
                {isSearchingArea ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Area'}
              </button>
            </form>

            {areaResults.length > 0 && (
              <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg divide-y divide-slate-100 max-h-56 overflow-y-auto z-50">
                {areaResults.map((item) => (
                  <button
                    key={item.place_id}
                    type="button"
                    onClick={() => {
                      setFocusTarget({
                        lat: Number(item.lat),
                        lng: Number(item.lon),
                        zoom: 17,
                        key: Date.now(),
                      });
                      setDetectedVillage(item.display_name.split(',')[0]?.trim() || 'My Village');
                      setAreaResults([]);
                    }}
                    className="w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-start gap-2 cursor-pointer"
                  >
                    <MapPin className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
                    <span className="line-clamp-2">{item.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Search Bar 2: ONLY House Number */}
          <div className="relative w-36 sm:w-48 shrink-0">
            <form
              onSubmit={handleHouseSearchSubmit}
              className="flex items-center bg-emerald-50/70 border border-emerald-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-emerald-600"
            >
              <Hash className="w-3.5 h-3.5 text-emerald-700 ml-2 shrink-0" />
              <input
                type="text"
                placeholder="House No."
                value={houseQuery}
                onFocus={() => setHouseDropdownOpen(true)}
                onBlur={() => setTimeout(() => setHouseDropdownOpen(false), 180)}
                onChange={(e) => {
                  setHouseQuery(e.target.value);
                  setHouseDropdownOpen(true);
                }}
                className="w-full px-1.5 py-1.5 text-xs font-mono font-semibold text-slate-900 bg-transparent focus:outline-none"
              />
              <button
                type="submit"
                className="px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold shrink-0 cursor-pointer"
              >
                Track
              </button>
            </form>

            {houseDropdownOpen && matchingHouses.length > 0 && (
              <div className="absolute right-0 w-60 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg divide-y divide-slate-100 max-h-60 overflow-y-auto z-50">
                {matchingHouses.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onMouseDown={() => startNavigateToHouse(h)}
                    className="w-full px-3 py-2 text-left text-xs hover:bg-emerald-50 flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <span className="font-mono font-bold text-slate-900">
                      House #{h.houseNumber}
                    </span>
                    <span className="text-slate-500 truncate">
                      {h.side === 'left' ? 'Left' : 'Right'} · {h.roadName}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 min-h-0 relative flex flex-col lg:flex-row">
        {mode === 'preview' ? (
          <div className="w-full h-full">
            <SavedDataView
              roads={roads}
              houses={houses}
              mapSlot={previewMapElement}
              onNavigateHouse={startNavigateToHouse}
              onFocusRoad={(road) => {
                if (road.points.length >= 2) {
                  setFocusTarget({
                    lat: road.points[0].lat,
                    lng: road.points[0].lng,
                    boundsPoints: road.points.map((p) => ({ lat: p.lat, lng: p.lng })),
                    key: Date.now(),
                  });
                } else if (road.points.length === 1) {
                  setFocusTarget({
                    lat: road.points[0].lat,
                    lng: road.points[0].lng,
                    zoom: 18,
                    key: Date.now(),
                  });
                }
              }}
              onFocusHouse={(house) =>
                setFocusTarget({
                  lat: house.lat,
                  lng: house.lng,
                  zoom: 19,
                  key: Date.now(),
                })
              }
              onFitAll={() => handleFitAllSaved()}
              onDeleteHouse={(id) => setHouses((prev) => prev.filter((h) => h.id !== id))}
              onDeleteRoad={(id) => {
                setRoads((prev) => prev.filter((r) => r.id !== id));
                setHouses((prev) => prev.filter((h) => h.roadId !== id));
              }}
              onImportBackup={(data) => {
                setRoads((prev) => {
                  const ids = new Set(prev.map((r) => r.id));
                  return [...data.roads.filter((r) => !ids.has(r.id)), ...prev];
                });
                setHouses((prev) => {
                  const ids = new Set(prev.map((h) => h.id));
                  return [...data.houses.filter((h) => !ids.has(h.id)), ...prev];
                });
                showToast('Restored backup into localStorage.');
              }}
              onClearAll={() => {
                const empty = clearLocalStore();
                setRoads(empty.roads);
                setHouses(empty.houses);
                setTargetHouse(null);
                showToast('Cleared all saved roads and houses.');
              }}
            />
          </div>
        ) : mode === 'add' ? (
          <AddWalkWorkspace
            captureMode={captureMode}
            onChangeCaptureMode={setCaptureMode}
            gpsPrecisionMode={gpsPrecisionMode}
            onTogglePrecisionMode={() =>
              setGpsPrecisionMode((m) => (m === 'accurate_5m' ? 'relaxed_15m' : 'accurate_5m'))
            }
            gpsQuality={gpsQuality}
            isRecording={isRecording}
            isPaused={isPaused}
            segments={walkSegments}
            draftHouses={draftHouses}
            draftJunctions={draftJunctions}
            straightHeadingDeg={straightHeadingDeg}
            elapsedSeconds={elapsedSeconds}
            gpsError={gpsError}
            detectedVillage={detectedVillage}
            onStartWalk={handleStartWalk}
            onPauseResume={handlePauseResumeWalk}
            onUndoLastPoint={handleUndoLastPoint}
            onDiscardWalk={handleDiscardWalk}
            onSimulateStep={handleSimulateStep}
            onStraightSymbol={handleStraightSymbol}
            onStraightJunction={handleStraightJunction}
            onAddHouseOnWalk={handleAddHouseOnWalk}
            onRemoveDraftHouse={(id) =>
              setDraftHouses((prev) => prev.filter((h) => h.id !== id))
            }
            onSaveWalkedRoad={handleSaveWalkedRoad}
            nextSuggestedHouse={nextSuggestedHouse}
            onLocateMe={handleLocateMe}
            mapSlot={mapElement}
          />
        ) : (
          <>
            {/* Desktop Left Panel for Navigate */}
            <aside className="hidden lg:block w-[360px] shrink-0 h-full">
              <NavigationPanel
                houses={houses}
                userLocation={userLocation}
                isLiveGps={isLiveGps}
                isPickingSpot={isPickingSpot}
                onToggleLiveGps={() => {
                  setIsLiveGps((prev) => {
                    const next = !prev;
                    if (next) handleLocateMe();
                    return next;
                  });
                }}
                onTogglePickSpot={() => setIsPickingSpot((v) => !v)}
                targetHouse={targetHouse}
                routeResult={navRouteResult}
                routeOptions={navRouteOptions}
                selectedRouteIndex={safeSelectedRouteIndex}
                onSelectRouteIndex={(idx) => {
                  setSelectedRouteIndex(idx);
                  setCurrentNavStepIdx(0);
                  simIdxRef.current = 0;
                  setIsSimulatingNav(false);
                }}
                liveProgress={liveProgress}
                currentStepIndex={activeNavStepIdx}
                distanceToNextTurnMeters={distanceToNextTurnMeters}
                voiceEnabled={voiceEnabled}
                isSimulatingNav={isSimulatingNav}
                onToggleVoice={() => setVoiceEnabled((v) => !v)}
                onSelectHouseToNavigate={startNavigateToHouse}
                onExitNavigation={handleExitNavigation}
                onStepNavSim={stepNavSimulation}
                onToggleAutoSim={() => setIsSimulatingNav((v) => !v)}
                onFocusPoint={(lat, lng, zoom) =>
                  setFocusTarget({ lat, lng, zoom, key: Date.now() })
                }
              />
            </aside>

            {/* Map Viewport */}
            <div className="flex-1 min-w-0 h-full relative">
              {interactionMode === 'pick_user_location' && (
                <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[450] px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg shadow flex items-center gap-2 whitespace-nowrap">
                  <span>Tap map to place your location</span>
                  <button
                    type="button"
                    onClick={() => setIsPickingSpot(false)}
                    className="underline text-slate-300 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {mapElement}

              {/* Mobile Compact Bottom Sheet for Navigate */}
              <div className="lg:hidden absolute bottom-0 inset-x-0 z-[500]">
                <div className="bg-white border-t border-slate-200 shadow-lg">
                  <button
                    type="button"
                    onClick={() => setMobileSheetOpen((v) => !v)}
                    className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-900 cursor-pointer"
                  >
                    <span>
                      {targetHouse
                        ? `Tracking House #${targetHouse.houseNumber} (${
                            targetHouse.side === 'left' ? 'Left' : 'Right'
                          })`
                        : `Select a House (${houses.length}) to Track`}
                    </span>
                    {mobileSheetOpen ? (
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    ) : (
                      <ChevronUp className="w-4 h-4 text-slate-500" />
                    )}
                  </button>

                  {mobileSheetOpen && (
                    <div className="max-h-[58vh] overflow-y-auto border-t border-slate-100">
                      <NavigationPanel
                        houses={houses}
                        userLocation={userLocation}
                        isLiveGps={isLiveGps}
                        isPickingSpot={isPickingSpot}
                        onToggleLiveGps={() => {
                          setIsLiveGps((prev) => {
                            const next = !prev;
                            if (next) handleLocateMe();
                            return next;
                          });
                        }}
                        onTogglePickSpot={() => {
                          setIsPickingSpot((v) => !v);
                          setMobileSheetOpen(false);
                        }}
                        targetHouse={targetHouse}
                        routeResult={navRouteResult}
                        routeOptions={navRouteOptions}
                        selectedRouteIndex={safeSelectedRouteIndex}
                        onSelectRouteIndex={(idx) => {
                          setSelectedRouteIndex(idx);
                          setCurrentNavStepIdx(0);
                          simIdxRef.current = 0;
                          setIsSimulatingNav(false);
                        }}
                        liveProgress={liveProgress}
                        currentStepIndex={activeNavStepIdx}
                        distanceToNextTurnMeters={distanceToNextTurnMeters}
                        voiceEnabled={voiceEnabled}
                        isSimulatingNav={isSimulatingNav}
                        onToggleVoice={() => setVoiceEnabled((v) => !v)}
                        onSelectHouseToNavigate={(h) => {
                          startNavigateToHouse(h);
                          setMobileSheetOpen(false);
                        }}
                        onExitNavigation={handleExitNavigation}
                        onStepNavSim={stepNavSimulation}
                        onToggleAutoSim={() => setIsSimulatingNav((v) => !v)}
                        onFocusPoint={(lat, lng, zoom) => {
                          setFocusTarget({ lat, lng, zoom, key: Date.now() });
                          setMobileSheetOpen(false);
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {toastMessage && (
          <div className="fixed bottom-16 lg:bottom-5 right-4 z-[1100] max-w-xs sm:max-w-sm bg-slate-900 text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-3">
            <span>{toastMessage}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
