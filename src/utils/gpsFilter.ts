import type { LatLngPoint } from '../types/map.ts';
import { haversineMeters } from './geo.ts';

export type GpsPrecisionMode = 'accurate_5m' | 'relaxed_15m';

export interface GpsQualityReport {
  accuracyMeters: number | null;
  quality: 'ultra' | 'good' | 'weak' | 'none';
  label: string;
  accepted: boolean;
}

/**
 * Evaluates raw hardware GPS fix against a practical 5m village road precision limit.
 */
export function evaluateGpsFix(
  accuracy: number | undefined,
  precisionMode: GpsPrecisionMode
): GpsQualityReport {
  if (accuracy == null || !Number.isFinite(accuracy)) {
    return {
      accuracyMeters: null,
      quality: 'none',
      label: 'No GPS',
      accepted: false,
    };
  }

  const rounded = Number(accuracy.toFixed(1));
  const limit = precisionMode === 'accurate_5m' ? 5.0 : 15.0;

  if (rounded <= 5.0) {
    return {
      accuracyMeters: rounded,
      quality: 'ultra',
      label: `±${rounded} m`,
      accepted: true,
    };
  }
  if (rounded <= 15.0) {
    return {
      accuracyMeters: rounded,
      quality: 'good',
      label: `±${rounded} m`,
      accepted: rounded <= limit,
    };
  }
  return {
    accuracyMeters: rounded,
    quality: 'weak',
    label: `±${rounded} m`,
    accepted: false,
  };
}

/**
 * Inverse-variance weighted Kalman-style smoothing to suppress GNSS jitter while walking.
 */
export class PrecisionGpsSmoother {
  private estLat: number | null = null;
  private estLng: number | null = null;
  private variance = 12; // meters^2

  reset(): void {
    this.estLat = null;
    this.estLng = null;
    this.variance = 12;
  }

  update(raw: LatLngPoint, lastTimestamp?: number): LatLngPoint {
    const acc = Math.max(1.0, raw.accuracy ?? 4);
    const measVar = acc * acc;

    if (this.estLat === null || this.estLng === null) {
      this.estLat = raw.lat;
      this.estLng = raw.lng;
      this.variance = measVar;
      return raw;
    }

    const dtSec =
      lastTimestamp && raw.timestamp
        ? Math.max(0.2, Math.min(10, (raw.timestamp - lastTimestamp) / 1000))
        : 1;

    const rawJump = haversineMeters(
      { lat: this.estLat, lng: this.estLng },
      { lat: raw.lat, lng: raw.lng }
    );

    // Reject impossible teleportation spikes while walking
    if (rawJump > 30 && acc > 5) {
      return {
        lat: Number(this.estLat.toFixed(7)),
        lng: Number(this.estLng.toFixed(7)),
        accuracy: raw.accuracy,
        timestamp: raw.timestamp,
      };
    }

    // Walking speed ~1.4 m/s -> adapt process noise when moving so marker doesn't lag behind walker
    const motionNoise = rawJump >= 1.5 ? Math.max(4.5, rawJump * 3.0) : 1.5;
    const processNoise = motionNoise * dtSec;
    this.variance += processNoise;

    let gain = this.variance / (this.variance + measVar);
    if (rawJump >= 1.5 && acc <= 10) {
      gain = Math.max(gain, 0.52);
    }

    this.estLat = this.estLat + gain * (raw.lat - this.estLat);
    this.estLng = this.estLng + gain * (raw.lng - this.estLng);
    this.variance = (1 - gain) * this.variance;

    return {
      lat: Number(this.estLat.toFixed(7)),
      lng: Number(this.estLng.toFixed(7)),
      accuracy: raw.accuracy,
      timestamp: raw.timestamp,
    };
  }
}
