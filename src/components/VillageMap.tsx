import L from '../utils/leafletInit.ts';
import 'leaflet-rotate';
import { Compass, Crosshair, RotateCcw, RotateCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  LatLngPoint,
  NavigationInstruction,
  RoadJunction,
  VillageHouse,
  VillageRoad,
  VillageRouteResult,
} from '../types/map.ts';
import {
  type LiveRouteProgress,
  calculateBearing,
  formatDistance,
  getSurfaceLabel,
  haversineMeters,
  offsetCoord,
} from '../utils/geo.ts';
import type { GpsQualityReport } from '../utils/gpsFilter.ts';
import { TurnIcon } from './NavigationPanel.tsx';

export type BaseLayerId = 'osm_hot' | 'osm_standard' | 'satellite';

export type MapInteractionMode = 'browse' | 'manual_trace' | 'pick_user_location';

interface VillageMapProps {
  roads: VillageRoad[];
  houses: VillageHouse[];
  draftHouses: VillageHouse[];
  activeWalkSegments: LatLngPoint[][];
  draftJunctions?: RoadJunction[];
  currentGps: LatLngPoint;
  userHeadingDeg?: number | null;
  gpsQuality: GpsQualityReport;
  routeResult: VillageRouteResult | null;
  alternativeRoutes?: VillageRouteResult[];
  liveProgress?: LiveRouteProgress | null;
  targetHouse: VillageHouse | null;
  isolateNavigation: boolean;
  activeInstruction: NavigationInstruction | null;
  distanceToNextTurnMeters: number | null;
  interactionMode: MapInteractionMode;
  onMapClick: (lat: number, lng: number) => void;
  onNavigateHouse: (house: VillageHouse) => void;
  onExitNavigation?: () => void;
  onCenterGps?: () => void;
  isFollowingGps?: boolean;
  initialView: { lat: number; lng: number; zoom: number; bearing?: number };
  onViewChange: (view: { lat: number; lng: number; zoom: number; bearing?: number }) => void;
  onUserDrag?: () => void;
  focusTarget: {
    lat: number;
    lng: number;
    zoom?: number;
    boundsPoints?: { lat: number; lng: number }[];
    key: number;
  } | null;
}

const TILE_LAYERS: Record<
  BaseLayerId,
  { label: string; url: string; attribution: string; maxZoom: number }
> = {
  osm_hot: {
    label: 'Village',
    url: 'https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap',
    maxZoom: 20,
  },
  osm_standard: {
    label: 'OSM',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap',
    maxZoom: 20,
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri',
    maxZoom: 20,
  },
};

export default function VillageMap({
  roads,
  houses,
  draftHouses,
  activeWalkSegments,
  draftJunctions = [],
  currentGps,
  userHeadingDeg = null,
  gpsQuality,
  routeResult,
  alternativeRoutes = [],
  liveProgress = null,
  targetHouse,
  isolateNavigation,
  activeInstruction,
  distanceToNextTurnMeters,
  interactionMode,
  onMapClick,
  onNavigateHouse,
  onExitNavigation,
  onCenterGps,
  isFollowingGps = true,
  initialView,
  onViewChange,
  onUserDrag,
  focusTarget,
}: VillageMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const roadsLayerRef = useRef<L.LayerGroup | null>(null);
  const housesLayerRef = useRef<L.LayerGroup | null>(null);
  const walkLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const gpsLayerRef = useRef<L.LayerGroup | null>(null);

  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onNavigateHouseRef = useRef(onNavigateHouse);
  onNavigateHouseRef.current = onNavigateHouse;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const onUserDragRef = useRef(onUserDrag);
  onUserDragRef.current = onUserDrag;
  const initialViewRef = useRef(initialView);
  const isProgrammaticMoveRef = useRef(false);
  const isProgrammaticRotateRef = useRef(false);

  const [baseLayer, setBaseLayer] = useState<BaseLayerId>('osm_hot');
  const [mapBearing, setMapBearing] = useState<number>(initialView.bearing ?? 0);
  const [autoRotateHeading, setAutoRotateHeading] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [initialViewRef.current.lat, initialViewRef.current.lng],
      zoom: initialViewRef.current.zoom,
      maxZoom: 20,
      zoomControl: false,
      rotate: true,
      bearing: initialViewRef.current.bearing ?? 0,
      touchRotate: true,
      shiftKeyRotate: true,
      rotateControl: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

    const cfg = TILE_LAYERS.osm_hot;
    tileLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
      maxNativeZoom: 19,
    }).addTo(map);

    roadsLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    walkLayerRef.current = L.layerGroup().addTo(map);
    housesLayerRef.current = L.layerGroup().addTo(map);
    gpsLayerRef.current = L.layerGroup().addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      onMapClickRef.current(e.latlng.lat, e.latlng.lng);
    });

    map.on('dragstart', () => {
      if (!isProgrammaticMoveRef.current) {
        onUserDragRef.current?.();
      }
    });

    map.on('zoomstart', () => {
      if (!isProgrammaticMoveRef.current) {
        onUserDragRef.current?.();
      }
    });

    map.on('rotate', () => {
      const b = Math.round(((map.getBearing() % 360) + 360) % 360);
      setMapBearing(b);
      if (!isProgrammaticRotateRef.current) {
        setAutoRotateHeading(false);
      }
      const c = map.getCenter();
      onViewChangeRef.current({ lat: c.lat, lng: c.lng, zoom: map.getZoom(), bearing: b });
    });

    const syncView = () => {
      isProgrammaticMoveRef.current = false;
      const c = map.getCenter();
      const b = Math.round(((map.getBearing() % 360) + 360) % 360);
      onViewChangeRef.current({ lat: c.lat, lng: c.lng, zoom: map.getZoom(), bearing: b });
    };
    map.on('moveend', syncView);
    map.on('zoomend', syncView);

    // ResizeObserver ensures center map stays crisp when mobile/vertical panels resize
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
    });
    ro.observe(containerRef.current);

    mapRef.current = map;

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    const cfg = TILE_LAYERS[baseLayer];
    tileLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
      maxNativeZoom: 19,
    }).addTo(map);
    tileLayerRef.current.bringToBack();
  }, [baseLayer]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.cursor = interactionMode === 'browse' ? '' : 'crosshair';
    }
  }, [interactionMode]);

  useEffect(() => {
    if (!focusTarget || !mapRef.current) return;
    isProgrammaticMoveRef.current = true;
    if (focusTarget.boundsPoints && focusTarget.boundsPoints.length >= 2) {
      const bounds = L.latLngBounds(
        focusTarget.boundsPoints.map((p) => [p.lat, p.lng] as [number, number])
      );
      mapRef.current.fitBounds(bounds, {
        padding: [56, 56],
        maxZoom: 19,
        animate: true,
      });
    } else if (focusTarget.zoom != null) {
      mapRef.current.flyTo([focusTarget.lat, focusTarget.lng], focusTarget.zoom, {
        duration: 0.45,
      });
    } else {
      // Preserve whatever zoom level and rotation the user currently chose!
      mapRef.current.panTo([focusTarget.lat, focusTarget.lng], {
        animate: true,
        duration: 0.3,
      });
    }
  }, [focusTarget]);

  // Smoothly align map with walking direction only when Heading-Up mode is explicitly enabled
  useEffect(() => {
    if (!autoRotateHeading || !targetHouse || !mapRef.current) return;
    if (userHeadingDeg == null || !Number.isFinite(userHeadingDeg)) return;
    isProgrammaticRotateRef.current = true;
    mapRef.current.setBearing((360 - userHeadingDeg) % 360);
    isProgrammaticRotateRef.current = false;
  }, [autoRotateHeading, targetHouse, userHeadingDeg]);

  // Reset Heading-Up mode when exiting house tracking (keep manual rotation if user set one)
  useEffect(() => {
    if (!targetHouse) {
      setAutoRotateHeading(false);
    }
  }, [targetHouse]);

  const setBearingManually = (nextDeg: number) => {
    if (!mapRef.current) return;
    setAutoRotateHeading(false);
    isProgrammaticRotateRef.current = true;
    mapRef.current.setBearing(((nextDeg % 360) + 360) % 360);
    isProgrammaticRotateRef.current = false;
  };

  // Render Saved Roads & Junctions (kept visible during tracking so mapped turns, curves, and 3W/4W crossings match Add mode)
  useEffect(() => {
    const group = roadsLayerRef.current;
    if (!group) return;
    group.clearLayers();

    for (const r of roads) {
      if (r.points.length < 2) continue;
      const latlngs = r.points.map((pt) => [pt.lat, pt.lng] as [number, number]);
      const isKachha = r.surface === 'unpaved';
      const isTrackedRoad = Boolean(isolateNavigation && targetHouse && r.id === targetHouse.roadId);
      const isMutedDuringTrack = Boolean(isolateNavigation && targetHouse && !isTrackedRoad);

      const line = L.polyline(latlngs, {
        color: isMutedDuringTrack ? '#64748b' : isKachha ? '#d97706' : '#0f766e',
        weight: isMutedDuringTrack ? 3.5 : 5,
        opacity: isMutedDuringTrack ? 0.5 : 0.92,
        dashArray: isKachha ? '7 6' : undefined,
        lineCap: 'round',
        lineJoin: 'round',
      });
      line.bindTooltip(
        `${r.name} · ${getSurfaceLabel(r.surface)} · ${formatDistance(r.distanceMeters)}`,
        { sticky: true }
      );
      line.addTo(group);

      for (const j of r.junctions ?? []) {
        const leftArm = offsetCoord(j, (j.headingDeg + 270) % 360, 7);
        const rightArm = offsetCoord(j, (j.headingDeg + 90) % 360, 7);
        const aheadArm = offsetCoord(j, j.headingDeg, 7);
        const arms: [number, number][][] = [];
        if (j.type === '4-way') {
          arms.push(
            [
              [leftArm.lat, leftArm.lng],
              [rightArm.lat, rightArm.lng],
            ],
            [
              [j.lat, j.lng],
              [aheadArm.lat, aheadArm.lng],
            ]
          );
        } else {
          if (j.exitTurn !== 'left') {
            arms.push([
              [j.lat, j.lng],
              [leftArm.lat, leftArm.lng],
            ]);
          }
          if (j.exitTurn !== 'right') {
            arms.push([
              [j.lat, j.lng],
              [rightArm.lat, rightArm.lng],
            ]);
          }
        }
        for (const pts of arms) {
          L.polyline(pts, {
            color: '#475569',
            weight: 3,
            opacity: 0.75,
            dashArray: '3 3',
            lineCap: 'round',
          }).addTo(group);
        }
        const badgeIcon = L.divIcon({
          className: 'grampath-junction-badge',
          iconSize: [22, 16],
          iconAnchor: [11, 8],
          html: `<div style="width:22px;height:16px;border-radius:4px;background:#0f172a;color:#fff;border:1.5px solid #fff;font-size:9px;font-weight:700;font-family:'JetBrains Mono',monospace;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(15,23,42,0.35);">${
            j.type === '4-way' ? '4W' : '3W'
          }</div>`,
        });
        L.marker([j.lat, j.lng], { icon: badgeIcon })
          .bindTooltip(`${j.type === '4-way' ? '4-Way Chauraha' : '3-Way Junction'}`)
          .addTo(group);
      }
    }
  }, [roads, isolateNavigation, targetHouse]);

  // Render Houses: in isolated navigation mode, ONLY render targetHouse!
  useEffect(() => {
    const group = housesLayerRef.current;
    if (!group) return;
    group.clearLayers();

    const visibleHouses =
      isolateNavigation && targetHouse
        ? [targetHouse]
        : [...houses, ...draftHouses];

    for (const h of visibleHouses) {
      const isTarget = targetHouse?.id === h.id;
      const bg = isTarget
        ? '#dc2626'
        : h.side === 'left'
        ? '#15803d'
        : '#d97706';

      const hasRouteConnector =
        isTarget && Boolean(routeResult?.reachable && routeResult.polyline.length >= 2);
      if (!hasRouteConnector) {
        L.polyline(
          [
            [h.roadLat, h.roadLng],
            [h.lat, h.lng],
          ],
          {
            color: bg,
            weight: 1.5,
            opacity: 0.65,
            dashArray: '2 3',
          }
        ).addTo(group);
      }

      const icon = L.divIcon({
        className: 'grampath-marker-icon',
        iconSize: [34, 24],
        iconAnchor: [17, 12],
        html: `<div style="min-width:30px;height:22px;padding:0 6px;border-radius:6px;background:${bg};color:#fff;border:2px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,0.35);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;font-family:'JetBrains Mono',monospace;">#${h.houseNumber}</div>`,
      });

      const marker = L.marker([h.lat, h.lng], { icon });
      const popupEl = document.createElement('div');
      popupEl.style.fontSize = '12px';
      popupEl.style.minWidth = '145px';
      popupEl.innerHTML = `
        <div style="font-weight:700;color:#0f172a;font-size:13px;">House #${h.houseNumber} (${
        h.side === 'left' ? 'Left' : 'Right'
      })</div>
        <div style="color:#475569;margin-top:2px;">${h.roadName}</div>
        ${h.note ? `<div style="color:#334155;margin-top:4px;">${h.note}</div>` : ''}
      `;

      if (!isTarget) {
        const navBtn = document.createElement('button');
        navBtn.type = 'button';
        navBtn.textContent = `Track House #${h.houseNumber}`;
        navBtn.style.marginTop = '8px';
        navBtn.style.width = '100%';
        navBtn.style.padding = '6px 10px';
        navBtn.style.backgroundColor = '#15803d';
        navBtn.style.color = '#ffffff';
        navBtn.style.border = 'none';
        navBtn.style.borderRadius = '6px';
        navBtn.style.fontWeight = '600';
        navBtn.style.fontSize = '12px';
        navBtn.style.cursor = 'pointer';
        navBtn.onclick = () => {
          marker.closePopup();
          onNavigateHouseRef.current(h);
        };
        popupEl.appendChild(navBtn);
      }

      marker.bindPopup(popupEl);
      marker.addTo(group);
    }
  }, [houses, draftHouses, targetHouse, isolateNavigation, routeResult]);

  // Render Active Walk Segments (each segment draws independently so Pause->Resume jumps never bridge with a straight line)
  useEffect(() => {
    const group = walkLayerRef.current;
    if (!group) return;
    group.clearLayers();
    if (isolateNavigation && targetHouse) return;

    for (let sIdx = 0; sIdx < activeWalkSegments.length; sIdx++) {
      const seg = activeWalkSegments[sIdx];
      if (seg.length === 0) continue;

      const latlngs = seg.map((pt) => [pt.lat, pt.lng] as [number, number]);
      if (latlngs.length >= 2) {
        L.polyline(latlngs, {
          color: '#059669',
          weight: 6,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(group);
      }

      const isLastSegment = sIdx === activeWalkSegments.length - 1;
      for (let i = 0; i < seg.length; i++) {
        const pt = seg[i];
        L.circleMarker([pt.lat, pt.lng], {
          radius: isLastSegment && i === seg.length - 1 ? 5.5 : 3,
          color: '#ffffff',
          weight: 1.5,
          fillColor: '#047857',
          fillOpacity: 1,
        }).addTo(group);
      }
    }

    for (const j of draftJunctions) {
      const leftArm = offsetCoord(j, (j.headingDeg + 270) % 360, 7);
      const rightArm = offsetCoord(j, (j.headingDeg + 90) % 360, 7);
      const aheadArm = offsetCoord(j, j.headingDeg, 7);
      const arms: [number, number][][] = [];
      if (j.type === '4-way') {
        arms.push(
          [
            [leftArm.lat, leftArm.lng],
            [rightArm.lat, rightArm.lng],
          ],
          [
            [j.lat, j.lng],
            [aheadArm.lat, aheadArm.lng],
          ]
        );
      } else {
        if (j.exitTurn !== 'left') {
          arms.push([
            [j.lat, j.lng],
            [leftArm.lat, leftArm.lng],
          ]);
        }
        if (j.exitTurn !== 'right') {
          arms.push([
            [j.lat, j.lng],
            [rightArm.lat, rightArm.lng],
          ]);
        }
      }
      for (const pts of arms) {
        L.polyline(pts, {
          color: '#0f172a',
          weight: 3,
          opacity: 0.8,
          dashArray: '3 3',
          lineCap: 'round',
        }).addTo(group);
      }
      const badgeIcon = L.divIcon({
        className: 'grampath-junction-badge',
        iconSize: [24, 18],
        iconAnchor: [12, 9],
        html: `<div style="width:24px;height:18px;border-radius:4px;background:#0f172a;color:#34d399;border:1.5px solid #fff;font-size:9px;font-weight:700;font-family:'JetBrains Mono',monospace;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(15,23,42,0.35);">${
          j.type === '4-way' ? '4W' : '3W'
        }</div>`,
      });
      L.marker([j.lat, j.lng], { icon: badgeIcon }).addTo(group);
    }
  }, [activeWalkSegments, draftJunctions, isolateNavigation, targetHouse]);

  // Render Alternative Routes & Live Split Navigation Route (Walked Behind vs Remaining Ahead)
  useEffect(() => {
    const group = routeLayerRef.current;
    if (!group) return;
    group.clearLayers();
    if (!targetHouse || !routeResult?.reachable || routeResult.polyline.length < 2) return;

    for (const alt of alternativeRoutes) {
      if (!alt.reachable || alt.polyline.length < 2 || alt === routeResult) continue;
      const altLatLngs = alt.polyline.map((p) => [p.lat, p.lng] as [number, number]);
      L.polyline(altLatLngs, {
        color: '#64748b',
        weight: 4,
        opacity: 0.5,
        dashArray: '6 6',
        lineCap: 'round',
        lineJoin: 'round',
      })
        .bindTooltip(
          `${alt.routeLabel ?? 'Alt Route'} · ${formatDistance(alt.totalDistanceMeters)} (${alt.walkMinutes} min walk)`
        )
        .addTo(group);
    }

    // Already covered behind user
    if (liveProgress && liveProgress.completedPolyline.length >= 2) {
      const doneLatLngs = liveProgress.completedPolyline.map(
        (p) => [p.lat, p.lng] as [number, number]
      );
      L.polyline(doneLatLngs, {
        color: '#94a3b8',
        weight: 5,
        opacity: 0.7,
        dashArray: '4 6',
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(group);
    }

    // Remaining road ahead of user
    const aheadPts =
      liveProgress && liveProgress.remainingPolyline.length >= 2
        ? liveProgress.remainingPolyline
        : routeResult.polyline;
    const aheadLatLngs = aheadPts.map((p) => [p.lat, p.lng] as [number, number]);

    L.polyline(aheadLatLngs, {
      color: '#1e1b4b',
      weight: 10,
      opacity: 0.22,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(group);

    L.polyline(aheadLatLngs, {
      color: '#2563eb',
      weight: 6,
      opacity: 0.96,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(group);

    // Subtle directional chevrons every ~26m along remaining route so road direction is unmistakable
    let accum = 0;
    for (let i = 1; i < aheadPts.length; i++) {
      const a = aheadPts[i - 1];
      const b = aheadPts[i];
      const segLen = haversineMeters(a, b);
      accum += segLen;
      if (accum >= 26) {
        accum = 0;
        const brg = calculateBearing(a, b);
        const arrowIcon = L.divIcon({
          className: 'grampath-route-arrow',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
          html: `<div style="width:14px;height:14px;display:flex;align-items:center;justify-content:center;"><svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1L10.5 10L6 7.8L1.5 10L6 1Z" fill="#ffffff" stroke="#1d4ed8" stroke-width="1"/></svg></div>`,
        });
        L.marker([b.lat, b.lng], {
          icon: arrowIcon,
          interactive: false,
          rotateWithView: true,
          rotation: (brg * Math.PI) / 180,
        }).addTo(group);
      }
    }

    if (activeInstruction && activeInstruction.turnType !== 'arrive') {
      L.circleMarker([activeInstruction.anchorPoint.lat, activeInstruction.anchorPoint.lng], {
        radius: 7,
        color: '#ffffff',
        weight: 2,
        fillColor: '#f59e0b',
        fillOpacity: 1,
      }).addTo(group);
    }

    // End route strictly on the road with a clear stop dot + dotted pointer beside it to the house
    const routeEndPt = aheadPts[aheadPts.length - 1];
    if (routeEndPt) {
      L.polyline(
        [
          [routeEndPt.lat, routeEndPt.lng],
          [targetHouse.lat, targetHouse.lng],
        ],
        {
          color: '#dc2626',
          weight: 2.5,
          opacity: 0.9,
          dashArray: '3 5',
          lineCap: 'round',
        }
      ).addTo(group);

      L.circleMarker([routeEndPt.lat, routeEndPt.lng], {
        radius: 6,
        color: '#ffffff',
        weight: 2.5,
        fillColor: '#2563eb',
        fillOpacity: 1,
      })
        .bindTooltip(
          `Stop here on road · House #${targetHouse.houseNumber} (${
            targetHouse.side === 'left' ? 'Left' : 'Right'
          })`
        )
        .addTo(group);
    }
  }, [routeResult, alternativeRoutes, liveProgress, targetHouse, activeInstruction]);

  // Render Live GPS User Position + Heading Arrow (rotates accurately with map view)
  useEffect(() => {
    const group = gpsLayerRef.current;
    if (!group) return;
    group.clearLayers();

    if (currentGps.accuracy && currentGps.accuracy > 0 && currentGps.accuracy < 150) {
      L.circle([currentGps.lat, currentGps.lng], {
        radius: currentGps.accuracy,
        color: '#0284c7',
        weight: 1,
        fillColor: '#38bdf8',
        fillOpacity: 0.16,
      }).addTo(group);
    }

    if (userHeadingDeg != null && Number.isFinite(userHeadingDeg)) {
      const arrowIcon = L.divIcon({
        className: 'grampath-user-heading',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        html: `<div style="width:28px;height:28px;border-radius:999px;background:rgba(2,132,199,0.22);display:flex;align-items:center;justify-content:center;"><div style="width:20px;height:20px;border-radius:999px;background:#0284c7;border:2.5px solid #ffffff;box-shadow:0 2px 6px rgba(15,23,42,0.4);display:flex;align-items:center;justify-content:center;"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5L9.8 9.5L6 7.5L2.2 9.5L6 1.5Z" fill="#ffffff"/></svg></div></div>`,
      });
      L.marker([currentGps.lat, currentGps.lng], {
        icon: arrowIcon,
        rotateWithView: true,
        rotation: (userHeadingDeg * Math.PI) / 180,
      })
        .bindTooltip('You (Moving)')
        .addTo(group);
    } else {
      L.circleMarker([currentGps.lat, currentGps.lng], {
        radius: 8,
        color: '#ffffff',
        weight: 2.5,
        fillColor: '#0284c7',
        fillOpacity: 1,
      })
        .bindTooltip('You')
        .addTo(group);
    }
  }, [currentGps, userHeadingDeg]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full z-0" />

      {/* Live GPS Precision Readout & Quick Controls (Top Left) */}
      <div className="absolute top-2 left-2 z-[450] pointer-events-none flex flex-col gap-1 items-start">
        <div className="flex items-center gap-1 pointer-events-auto">
          <div
            className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg text-[10px] sm:text-[11px] font-mono tabular-nums font-semibold shadow-sm border whitespace-nowrap ${
              gpsQuality.quality === 'ultra'
                ? 'bg-emerald-900/90 text-emerald-100 border-emerald-700'
                : gpsQuality.quality === 'good'
                ? 'bg-white/95 text-slate-800 border-slate-200'
                : 'bg-amber-50/95 text-amber-900 border-amber-300'
            }`}
          >
            GPS {gpsQuality.label}
            {gpsQuality.quality === 'ultra' ? ' · ≤5m' : ''}
          </div>

          {onCenterGps && (
            <button
              type="button"
              onClick={onCenterGps}
              title={isFollowingGps ? 'Following live GPS (drag map for free mode)' : 'Free map mode — tap to re-center on GPS'}
              className={`px-2 py-1 rounded-lg border shadow-sm cursor-pointer inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-semibold transition-colors ${
                isFollowingGps
                  ? 'bg-sky-600 text-white border-sky-700 hover:bg-sky-700'
                  : 'bg-white/95 text-slate-800 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isFollowingGps ? 'Follow' : 'Center'}</span>
            </button>
          )}
        </div>

        {isolateNavigation && targetHouse && onExitNavigation && (
          <button
            type="button"
            onClick={onExitNavigation}
            className="pointer-events-auto px-2.5 py-1 rounded-lg bg-white/95 hover:bg-red-50 text-red-700 border border-slate-200 text-[11px] font-semibold shadow-sm cursor-pointer whitespace-nowrap"
          >
            Exit #{targetHouse.houseNumber} · Show All
          </button>
        )}
      </div>

      {/* Layer Switcher & Map Rotation / Compass Controls (Top Right) */}
      <div className="absolute top-2 right-2 z-[400] flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-0.5 p-0.5 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg shadow-sm">
          {(Object.keys(TILE_LAYERS) as BaseLayerId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setBaseLayer(id)}
              className={`px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                baseLayer === id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              {TILE_LAYERS[id].label}
            </button>
          ))}
        </div>

        {/* Map Rotation Bar: Free Twist/Rotate or North-Up / Heading-Up */}
        <div className="flex items-center gap-0.5 p-0.5 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg shadow-sm">
          <button
            type="button"
            onClick={() => setBearingManually(mapBearing - 45)}
            title="Rotate map left 45° (or two-finger twist)"
            className="p-1 text-slate-700 hover:bg-slate-100 rounded-md cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              if (targetHouse && !autoRotateHeading && mapBearing === 0) {
                setAutoRotateHeading(true);
              } else {
                setBearingManually(0);
              }
            }}
            title={
              autoRotateHeading
                ? 'Heading-Up active · Tap for North-Up'
                : mapBearing !== 0
                ? 'Rotated · Tap to reset North-Up'
                : targetHouse
                ? 'North-Up (Default) · Tap for Heading-Up auto-rotate'
                : 'North-Up'
            }
            className={`px-1.5 py-0.5 rounded-md inline-flex items-center gap-1 text-[10px] font-semibold cursor-pointer transition-colors ${
              autoRotateHeading
                ? 'bg-emerald-700 text-white'
                : mapBearing !== 0
                ? 'bg-amber-100 text-amber-900'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Compass
              className="w-3.5 h-3.5 transition-transform"
              style={{ transform: `rotate(${mapBearing}deg)` }}
            />
            <span className="font-mono tabular-nums">
              {autoRotateHeading ? 'Dir' : mapBearing !== 0 ? `${mapBearing}°` : 'N'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setBearingManually(mapBearing + 45)}
            title="Rotate map right 45° (or two-finger twist)"
            className="p-1 text-slate-700 hover:bg-slate-100 rounded-md cursor-pointer"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Real-Time Turn + Remaining Distance + Movement Status HUD */}
      {targetHouse && activeInstruction && (
        <div className="absolute top-16 sm:top-12 left-1/2 -translate-x-1/2 z-[460] w-[calc(100%-1rem)] max-w-md pointer-events-none">
          <div className="px-3.5 py-2.5 rounded-xl shadow-lg bg-slate-900/95 backdrop-blur-sm text-white space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
                <TurnIcon turn={activeInstruction.turnType} className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                  <span className="text-emerald-300 font-semibold">
                    {activeInstruction.turnType === 'arrive'
                      ? `Target: House #${targetHouse.houseNumber}`
                      : distanceToNextTurnMeters != null
                      ? `In ${formatDistance(distanceToNextTurnMeters)}`
                      : formatDistance(activeInstruction.distanceMeters)}
                  </span>
                  {liveProgress && (
                    <span className="text-sky-300 font-semibold">
                      {formatDistance(liveProgress.remainingMeters)} left ·{' '}
                      {liveProgress.remainingWalkMinutes}m
                    </span>
                  )}
                </div>
                <div className="text-xs sm:text-sm font-bold leading-snug truncate">
                  {activeInstruction.instruction}
                </div>
              </div>
            </div>

            {liveProgress && (
              <div className="flex items-center justify-between text-[11px] border-t border-white/15 pt-1">
                <span
                  className={`font-semibold ${
                    liveProgress.movementStatus === 'away'
                      ? 'text-amber-300'
                      : liveProgress.movementStatus === 'towards'
                      ? 'text-emerald-300'
                      : 'text-slate-300'
                  }`}
                >
                  {liveProgress.movementStatus === 'away'
                    ? 'Moving away · Turn back toward route'
                    : liveProgress.movementStatus === 'towards'
                    ? `Moving toward House #${targetHouse.houseNumber}`
                    : liveProgress.offRouteMeters > 12
                    ? `Off road by ${liveProgress.offRouteMeters} m`
                    : `On road · ${formatDistance(liveProgress.coveredMeters)} walked`}
                </span>
                <span className="font-mono tabular-nums text-slate-300">
                  {targetHouse.side === 'left' ? 'Left Side' : 'Right Side'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
