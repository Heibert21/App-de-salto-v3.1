/**
 * ============================================================================
 * MODELO: JumpModel.ts
 * Responsabilidad: Lógica de medición biomecánica de salto vertical de alta precisión.
 *
 * Novedades v4 (Precisión Científica + Mobile-First):
 *  - Gravedad ISO estándar: g = 980.665 cm/s² (9.80665 m/s² IUPAC).
 *  - Offset Anatómico de Coronilla: calibración de estatura con factor ×1.115
 *    sobre la distancia tobillo-ojo, eliminando el error sistemático del 6-7%.
 *  - Longitud de Pierna en Reposo (standingLegLengthPx): vector de referencia
 *    hip→ankle para la detección de encogimiento en vuelo.
 *  - Corrección Tuck Jump: Si las piernas están encogidas al aterrizar
 *    (legExtensionRatio < 0.88), se estima el exceso de tiempo de vuelo
 *    usando cinemática de impacto y se substrae con precisión sub-frame.
 *  - Interpolación Sub-Frame Asimétrica en Aterrizaje: umbral de toque
 *    reducido al 50% del despegue para capturar el primer contacto de la punta.
 *  - Fusión Gaussiana Ponderada por Coherencia Parabólica: peso de cada fuente
 *    (cinemática vs desplazamiento) determinado por e^(-3.5 × Δ_rel²). Saltos
 *    perfectamente coherántes usan más cinemática; saltos con discrepancia
 *    (encogimiento, rebote) pesan más el desplazamiento visual.
 *  - Cota Parabólica en Vivo: la estimación en tiempo real está acotada por
 *    la altura máxima teórica h = v₀²/(2g) estimada desde la velocidad actual.
 *  - Estimación 3D de Estatura por worldLandmarks de MediaPipe: autodetecta
 *    la estatura en metros sin que el usuario tenga que introducirla.
 *  - Chips Táctiles Mobile-First: selección de estatura en 1-Tap (sin teclado).
 * ============================================================================
 */

import { NormalizedLandmark } from "./PoseModel";

export type JumpState = 'IDLE' | 'PREPARING' | 'IN_AIR' | 'LANDED';

// Constante de gravedad terrestre estándar en cm/s² (ISO / IUPAC 9.80665 m/s²)
const GRAVITY_CM_S2 = 980.665;

export interface FrameSample {
  timestampMs: number;
  hipYPx: number;
  ankleYPx: number;
  toeYPx: number;
}

export interface AthleteProfile {
  name: string;
  weightKg: number;
  heightCm: number;
}

export class JumpModel {
  // ── Suelo / Calibración ──
  private baselineHipY: number | null = null;
  private baselineAnkleY: number | null = null;
  private baselineToeY: number | null = null;
  private standingBodyHeightPx: number = 0; // Distancia coronilla a tobillos en píxeles
  private standingLegLengthPx: number = 0;   // Longitud anatómica de piernas en reposo (hip-to-ankle px)
  private isBaselineLocked: boolean = false;

  // Parámetros del atleta
  private athleteName: string = 'Atleta';
  private athleteWeightKg: number = 70;
  private userHeightCm: number = 172; // Estatura por defecto en cm
  private isVideoMode: boolean = false;

  // ── Suavizado de señal EMA (Exponential Moving Average) ──
  private smoothedHipY: number | null = null;
  private smoothedAnkleY: number | null = null;
  private smoothedToeY: number | null = null;
  // EMA adaptativo: menos suavizado en video (señal más limpia) vs en vivo (más ruidoso)
  private get EMA_ALPHA(): number { return this.isVideoMode ? 0.45 : 0.25; }

  // ── Detección de reposo para auto-bloqueo de suelo ──
  private idleStartTimeMs: number = 0;
  private recentHipPositions: number[] = [];
  private readonly CALIBRATION_STABILITY_TIME_MS = 1500;
  private readonly VIDEO_STABILITY_TIME_MS = 300;

  // ── Multi-frame baseline averaging ──
  private baselineHipSamples: number[] = [];
  private baselineAnkleSamples: number[] = [];
  private baselineToeSamples: number[] = [];
  private readonly BASELINE_SAMPLE_COUNT = 15; // Promediar 15 frames para baseline robusto

  // ── Velocity gate para despegue ──
  private hipVelocityPxPerSec: number = 0;
  private lastHipYForVelocity: number | null = null;
  private lastTimeMsForVelocity: number = 0;

  // ── Historial de cuadros para interpolación sub-frame ──
  private lastFrameSample: FrameSample | null = null;

  // ── Estado del Salto ──
  private currentState: JumpState = 'IDLE';
  private currentJumpCm: number = 0;
  private peakJumpCm: number = 0;
  private maxJumpCm: number = 0;

  private peakHipY: number = Infinity;  // Mínima coordenada Y alcanzada en canvas (más arriba)

  // Tiempos exactos (con decimales de interpolación)
  private flightStartTimeMs: number = 0;
  private flightEndTimeMs: number = 0;
  private lastFlightTimeMs: number = 0;

  // Métricas desglosadas del último salto
  private lastFlightHeightCm: number = 0;
  private lastDisplacementHeightCm: number = 0;

  private lastJumpCm: number | null = null;


  // Callbacks al exterior
  public onJumpCompleted?: (peakJumpCm: number, flightTimeMs: number, dispCm: number) => void;
  public onBaselineCalibrated?: (isLocked: boolean) => void;
  public onNewRecord?: (peakJumpCm: number) => void;
  public onAutoHeightEstimated?: (estimatedCm: number) => void;

  private autoHeightEstimatedThisSession: boolean = false;
  private autoHeightSamplesBuffer: number[] = [];
  private inAirFlightSamples: { t: number; y: number }[] = [];
  private preTakeoffSamplesBuffer: FrameSample[] = [];

  private takeoffVelocityCmS: number = 0;
  private lastKineticHeightCm: number = 0;

  private static readonly STORAGE_KEY = 'youcanfly_record_cm';
  private static readonly HEIGHT_STORAGE_KEY = 'youcanfly_user_height_cm';
  private static readonly LAST_JUMP_KEY = 'youcanfly_last_jump_cm';
  public static readonly ATHLETE_STORAGE_KEY = 'youcanfly_athlete_profile_v1';

  constructor() {
    // Recuperar récord guardado
    const savedRecord = parseFloat(localStorage.getItem(JumpModel.STORAGE_KEY) ?? '0');
    if (!isNaN(savedRecord) && savedRecord > 0) {
      this.maxJumpCm = savedRecord;
    }

    // Recuperar estatura guardada
    const savedHeight = parseFloat(localStorage.getItem(JumpModel.HEIGHT_STORAGE_KEY) ?? '172');
    if (!isNaN(savedHeight) && savedHeight > 130 && savedHeight < 230) {
      this.userHeightCm = savedHeight;
    }

    // Recuperar perfil de atleta guardado
    try {
      const savedProfileRaw = localStorage.getItem(JumpModel.ATHLETE_STORAGE_KEY);
      if (savedProfileRaw) {
        const parsed = JSON.parse(savedProfileRaw);
        if (parsed.name && typeof parsed.name === 'string') {
          this.athleteName = parsed.name;
        }
        if (parsed.weightKg && typeof parsed.weightKg === 'number' && parsed.weightKg >= 30 && parsed.weightKg <= 250) {
          this.athleteWeightKg = parsed.weightKg;
        }
        if (parsed.heightCm && typeof parsed.heightCm === 'number' && parsed.heightCm >= 120 && parsed.heightCm <= 230) {
          this.userHeightCm = parsed.heightCm;
        }
      }
    } catch {
      // Ignorar si hay error de formato
    }

    // Recuperar último salto guardado
    const savedLast = parseFloat(localStorage.getItem(JumpModel.LAST_JUMP_KEY) ?? '0');
    if (!isNaN(savedLast) && savedLast > 0) {
      this.lastJumpCm = savedLast;
    }
  }

  // ── Getters & Setters Públicos ──

  public getBaselineHipY(): number | null {
    return this.baselineHipY;
  }

  public getLastJumpCm(): number | null {
    return this.lastJumpCm;
  }

  public getBaselineAnkleY(): number | null {
    return this.baselineAnkleY;
  }

  public getIsBaselineLocked(): boolean {
    return this.isBaselineLocked;
  }

  public getCurrentJumpCm(): number {
    return Math.max(0, this.currentJumpCm);
  }

  public getMaxJumpCm(): number {
    return this.maxJumpCm;
  }

  public setMaxJumpCm(val: number): void {
    this.maxJumpCm = Math.max(0, val);
  }

  public getCurrentState(): JumpState {
    return this.currentState;
  }

  public getPeakHipY(): number {
    return this.peakHipY;
  }

  public getLastFlightTimeMs(): number {
    return this.lastFlightTimeMs;
  }

  public getLastFlightHeightCm(): number {
    return this.lastFlightHeightCm;
  }

  public getLastDisplacementHeightCm(): number {
    return this.lastDisplacementHeightCm;
  }

  public getUserHeightCm(): number {
    return this.userHeightCm;
  }

  public setUserHeightCm(heightCm: number): void {
    if (heightCm >= 120 && heightCm <= 230) {
      this.userHeightCm = heightCm;
      localStorage.setItem(JumpModel.HEIGHT_STORAGE_KEY, String(heightCm));
      // Sincronizar también con el perfil del atleta
      try {
        const current = this.getAthleteProfile();
        current.heightCm = heightCm;
        localStorage.setItem(JumpModel.ATHLETE_STORAGE_KEY, JSON.stringify(current));
      } catch {
        // Ignorar
      }
    }
  }

  public getAthleteProfile(): AthleteProfile {
    return {
      name: this.athleteName,
      weightKg: this.athleteWeightKg,
      heightCm: this.userHeightCm
    };
  }

  public setAthleteProfile(profile: Partial<AthleteProfile>): void {
    if (profile.name !== undefined && profile.name.trim().length > 0) {
      this.athleteName = profile.name.trim();
    }
    if (profile.weightKg !== undefined && profile.weightKg >= 30 && profile.weightKg <= 250) {
      this.athleteWeightKg = profile.weightKg;
    }
    if (profile.heightCm !== undefined && profile.heightCm >= 120 && profile.heightCm <= 230) {
      this.userHeightCm = profile.heightCm;
      localStorage.setItem(JumpModel.HEIGHT_STORAGE_KEY, String(this.userHeightCm));
    }
    localStorage.setItem(JumpModel.ATHLETE_STORAGE_KEY, JSON.stringify(this.getAthleteProfile()));
  }

  public calculateBMI(): number {
    const heightM = this.userHeightCm / 100;
    if (heightM <= 0) return 0;
    return parseFloat((this.athleteWeightKg / (heightM * heightM)).toFixed(1));
  }

  public calculatePeakPowerWatts(jumpHeightCm?: number): number {
    const h = jumpHeightCm ?? this.maxJumpCm ?? 0;
    if (h <= 0 || this.athleteWeightKg <= 0) return 0;
    // Fórmula de Sayers: P_peak (W) = 60.7 * JumpHeight(cm) + 45.3 * BodyMass(kg) - 2055
    const watts = 60.7 * h + 45.3 * this.athleteWeightKg - 2055;
    return Math.max(0, Math.round(watts));
  }



  public setIsVideoMode(isVideo: boolean): void {
    this.isVideoMode = isVideo;
    if (isVideo) {
      // Al cambiar a modo video, resetear suelo para calibrar rápido con el primer cuadro
      this.recalibrateBaseline();
    }
  }

  /**
   * Forzar recalibración manual del suelo
   */
  public recalibrateBaseline(): void {
    this.baselineHipY = null;
    this.baselineAnkleY = null;
    this.baselineToeY = null;
    this.isBaselineLocked = false;
    this.autoHeightEstimatedThisSession = false;
    this.autoHeightSamplesBuffer = [];
    this.inAirFlightSamples = [];
    this.preTakeoffSamplesBuffer = [];
    this.takeoffVelocityCmS = 0;
    this.lastKineticHeightCm = 0;
    this.standingBodyHeightPx = 0;
    this.standingLegLengthPx = 0;
    this.idleStartTimeMs = performance.now();
    this.recentHipPositions = [];
    this.currentState = 'IDLE';
    this.currentJumpCm = 0;

    // RESETS CRÍTICOS PARA EVITAR LECTURAS RESIDUALES ENTRE VIDEOS CONSECUTIVOS:
    this.smoothedHipY = null;
    this.smoothedAnkleY = null;
    this.smoothedToeY = null;
    this.lastFrameSample = null;
    this.peakHipY = Infinity;
    this.flightStartTimeMs = 0;
    this.flightEndTimeMs = 0;
    this.lastFlightTimeMs = 0;
    this.lastFlightHeightCm = 0;
    this.lastDisplacementHeightCm = 0;
    this.peakJumpCm = 0;

    // Reset de multi-frame baseline averaging
    this.baselineHipSamples = [];
    this.baselineAnkleSamples = [];
    this.baselineToeSamples = [];

    // Reset velocity gate
    this.hipVelocityPxPerSec = 0;
    this.lastHipYForVelocity = null;
    this.lastTimeMsForVelocity = 0;


  }

  /**
   * Fórmula cinemática h = (g × t²) / 8
   * Derivada de h = v₀·t/2 donde v₀ = g·(t/2)
   */
  private calculateJumpHeightFromFlightTime(flightTimeMs: number): number {
    const t = flightTimeMs / 1000;
    return (GRAVITY_CM_S2 * t * t) / 8;
  }

  /**
   * Velocidad inicial de despegue en cm/s: v₀ = g × (t_vuelo / 2)
   */
  private calculateInitialVelocity(flightTimeMs: number): number {
    return GRAVITY_CM_S2 * (flightTimeMs / 2000);
  }

  /**
   * Estima la estatura 3D del atleta a partir de un búfer multi-muestra filtrado por mediana
   * para eliminar ruido instantáneo de MediaPipe y lograr precisión milimétrica.
   */
  public estimateHeightFrom3D(worldLandmarks: NormalizedLandmark[]): void {
    if (this.autoHeightEstimatedThisSession || !worldLandmarks || worldLandmarks.length < 33) return;

    const leftAnkle = worldLandmarks[27];
    const rightAnkle = worldLandmarks[28];
    const leftEye = worldLandmarks[2];
    const rightEye = worldLandmarks[5];
    const leftEar = worldLandmarks[7];
    const rightEar = worldLandmarks[8];

    if (!leftAnkle || !rightAnkle || (!leftEye && !leftEar)) return;

    const ankleY = (leftAnkle.y + rightAnkle.y) / 2;
    const ankleX = (leftAnkle.x + rightAnkle.x) / 2;
    const ankleZ = (leftAnkle.z + rightAnkle.z) / 2;

    let headY = (leftEye && rightEye) ? (leftEye.y + rightEye.y) / 2 : ankleY - 1.5;
    let headX = (leftEye && rightEye) ? (leftEye.x + rightEye.x) / 2 : ankleX;
    let headZ = (leftEye && rightEye) ? (leftEye.z + rightEye.z) / 2 : ankleZ;

    if (leftEar && rightEar) {
      headY = (leftEar.y + rightEar.y) / 2;
      headX = (leftEar.x + rightEar.x) / 2;
      headZ = (leftEar.z + rightEar.z) / 2;
    }

    // Offset estimado para la coronilla (aprox. 11 cm sobre el plano ojos/orejas)
    const crownY = headY - 0.11;

    // Distancia 3D euclidiana en metros
    const dx = headX - ankleX;
    const dy = crownY - ankleY;
    const dz = headZ - ankleZ;
    const heightMeters = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const estimatedCm = Math.round(heightMeters * 100);

    if (estimatedCm >= 125 && estimatedCm <= 220) {
      this.autoHeightSamplesBuffer.push(estimatedCm);
      if (this.autoHeightSamplesBuffer.length > 30) {
        this.autoHeightSamplesBuffer.shift();
      }

      // Acumular al menos 15 muestras estables en IDLE y obtener la mediana
      if (this.autoHeightSamplesBuffer.length >= 15) {
        const sorted = [...this.autoHeightSamplesBuffer].sort((a, b) => a - b);
        const medianCm = sorted[Math.floor(sorted.length / 2)];
        const variance = this.calculateVariance(sorted);

        // Si la dispersión de muestras es baja (varianza < 9 cm²)
        if (variance < 9.0) {
          this.autoHeightEstimatedThisSession = true;
          if (Math.abs(medianCm - this.userHeightCm) >= 2) {
            this.setUserHeightCm(medianCm);
            if (this.onAutoHeightEstimated) {
              this.onAutoHeightEstimated(medianCm);
            }
          }
        }
      }
    }
  }

  /**
   * Calibra las coordenadas de referencia del suelo con los landmarks actuales
   */
  public calibrateBaseline(
    landmarks: NormalizedLandmark[],
    canvasHeight: number,
    worldLandmarks?: NormalizedLandmark[]
  ): void {
    if (!landmarks || landmarks.length < 33) return;

    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    const leftAnkle = landmarks[27];
    const rightAnkle = landmarks[28];
    const leftToe = landmarks[31];
    const rightToe = landmarks[32];
    const leftEye = landmarks[2];
    const rightEye = landmarks[5];

    if (!leftHip || !rightHip || !leftAnkle || !rightAnkle) return;

    // ── Filtro de simetría bilateral ──
    // Si la diferencia vertical entre cadera izquierda y derecha es muy grande,
    // la persona está girada o hay oclusión → descartar este frame para calibración
    const hipAsymmetry = Math.abs(leftHip.y - rightHip.y) * canvasHeight;
    const ankleAsymmetry = Math.abs(leftAnkle.y - rightAnkle.y) * canvasHeight;
    if (hipAsymmetry > canvasHeight * 0.08 || ankleAsymmetry > canvasHeight * 0.08) return;

    const hipYPx = ((leftHip.y + rightHip.y) / 2) * canvasHeight;
    const ankleYPx = ((leftAnkle.y + rightAnkle.y) / 2) * canvasHeight;

    const toesOk = !!(leftToe && rightToe && (leftToe.visibility ?? 0) > 0.3 && (rightToe.visibility ?? 0) > 0.3);
    const toeYPx = toesOk ? ((leftToe!.y + rightToe!.y) / 2) * canvasHeight : ankleYPx;

    // ── Multi-frame baseline averaging ──
    // Acumular muestras para promediar y obtener un suelo robusto contra ruido
    this.baselineHipSamples.push(hipYPx);
    this.baselineAnkleSamples.push(ankleYPx);
    this.baselineToeSamples.push(toeYPx);

    if (this.baselineHipSamples.length > this.BASELINE_SAMPLE_COUNT) {
      this.baselineHipSamples.shift();
      this.baselineAnkleSamples.shift();
      this.baselineToeSamples.shift();
    }

    // Usar mediana (más robusta que promedio ante outliers) cuando hay suficientes muestras
    const useMedian = this.baselineHipSamples.length >= 5;
    const finalHipY = useMedian ? this.median(this.baselineHipSamples) : hipYPx;
    const finalAnkleY = useMedian ? this.median(this.baselineAnkleSamples) : ankleYPx;
    const finalToeY = useMedian ? this.median(this.baselineToeSamples) : toeYPx;

    let headYPx = finalAnkleY - canvasHeight * 0.7; // Fallback
    if (leftEye && rightEye) {
      const eyeYPx = ((leftEye.y + rightEye.y) / 2) * canvasHeight;
      const ankleEyeDist = finalAnkleY - eyeYPx;
      headYPx = finalAnkleY - ankleEyeDist * 1.115;
    }

    this.baselineHipY = finalHipY;
    this.baselineAnkleY = finalAnkleY;
    this.baselineToeY = finalToeY;
    this.smoothedHipY = finalHipY;
    this.smoothedAnkleY = finalAnkleY;
    this.smoothedToeY = finalToeY;
    this.standingBodyHeightPx = Math.max(50, finalAnkleY - headYPx);
    this.standingLegLengthPx = Math.max(20, finalAnkleY - finalHipY);
    this.peakHipY = finalHipY;
    this.currentJumpCm = 0;
    this.currentState = 'IDLE';

    if (worldLandmarks) {
      this.estimateHeightFrom3D(worldLandmarks);
    }
  }

  /**
   * Calcula la mediana de un array de números (inmune a outliers).
   */
  private median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  public processFrame(
    landmarks: NormalizedLandmark[],
    canvasHeight: number,
    nowMs: number,
    worldLandmarks?: NormalizedLandmark[]
  ): void {
    if (!landmarks || landmarks.length < 33) return;

    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    const leftAnkle = landmarks[27];
    const rightAnkle = landmarks[28];

    // Los dedos del pie (31/32) son opcionales — no todas las poses los detectan
    const leftToe = landmarks[31];
    const rightToe = landmarks[32];

    if (!leftHip || !rightHip || !leftAnkle || !rightAnkle) return;

    // Determinar si los dedos del pie están visibles con calidad suficiente
    const toesAvailable = !!(leftToe && rightToe
      && (leftToe.visibility ?? 0) > 0.3
      && (rightToe.visibility ?? 0) > 0.3);

    const rawHipY = ((leftHip.y + rightHip.y) / 2) * canvasHeight;
    const rawAnkleY = ((leftAnkle.y + rightAnkle.y) / 2) * canvasHeight;
    const rawToeY = toesAvailable
      ? ((leftToe!.y + rightToe!.y) / 2) * canvasHeight
      : rawAnkleY; // Fallback: usar tobillos como proxy de contacto con el suelo

    // ── Suavizado EMA ──
    if (this.smoothedHipY === null) {
      this.smoothedHipY = rawHipY;
      this.smoothedAnkleY = rawAnkleY;
      this.smoothedToeY = rawToeY;
    } else {
      this.smoothedHipY = this.EMA_ALPHA * rawHipY + (1 - this.EMA_ALPHA) * this.smoothedHipY;
      this.smoothedAnkleY = this.EMA_ALPHA * rawAnkleY + (1 - this.EMA_ALPHA) * (this.smoothedAnkleY ?? rawAnkleY);
      this.smoothedToeY = this.EMA_ALPHA * rawToeY + (1 - this.EMA_ALPHA) * (this.smoothedToeY ?? rawToeY);
    }

    const currentHipY = this.smoothedHipY;
    const currentAnkleY = this.smoothedAnkleY!;
    const currentToeY = this.smoothedToeY!;

    // ── Cálculo de velocidad vertical de cadera (velocity gate) ──
    const cmPerPx = this.standingBodyHeightPx > 0 ? (this.userHeightCm / this.standingBodyHeightPx) : 0.25;
    if (this.lastHipYForVelocity !== null && this.lastTimeMsForVelocity > 0) {
      const dtSec = (nowMs - this.lastTimeMsForVelocity) / 1000;
      if (dtSec > 0.001) {
        // Negativo = subiendo (Y crece hacia abajo en canvas)
        const rawVel = -((currentHipY - this.lastHipYForVelocity) * cmPerPx) / dtSec;
        // EMA suave en la velocidad para evitar picos de ruido
        this.hipVelocityPxPerSec = 0.4 * rawVel + 0.6 * this.hipVelocityPxPerSec;
      }
    }
    this.lastHipYForVelocity = currentHipY;
    this.lastTimeMsForVelocity = nowMs;

    // Velocidad mínima ascendente requerida para activar despegue (cm/s)
    // Evita falsos positivos por balanceo, cambio de peso o rebotes
    const MIN_TAKEOFF_VELOCITY_CMS = 30;
    const hasUpwardVelocity = this.hipVelocityPxPerSec > MIN_TAKEOFF_VELOCITY_CMS;

    // Auto-calibración inicial si no existe
    if (this.baselineHipY === null || this.baselineAnkleY === null || this.baselineToeY === null) {
      this.calibrateBaseline(landmarks, canvasHeight, worldLandmarks);
      this.idleStartTimeMs = nowMs;
      return;
    }

    const bodyHeight = Math.max(100, this.standingBodyHeightPx);

    // Umbral adaptativo: más fino si tenemos dedos del pie, más ancho si solo tobillos
    const groundThresholdPx = toesAvailable
      ? bodyHeight * 0.02   // 2% de estatura — preciso con puntas de pie
      : bodyHeight * 0.05;  // 5% de estatura — más seguro con tobillos
    const crouchThresholdPx = bodyHeight * 0.04;

    const hipElevationPx = this.baselineHipY - currentHipY;
    
    // Elevación de contacto con el suelo (dedos si disponibles, tobillos si no)
    let leftContactElevPx: number;
    let rightContactElevPx: number;

    if (toesAvailable) {
      leftContactElevPx = this.baselineToeY - leftToe!.y * canvasHeight;
      rightContactElevPx = this.baselineToeY - rightToe!.y * canvasHeight;
    } else {
      leftContactElevPx = (this.baselineAnkleY ?? 0) - leftAnkle.y * canvasHeight;
      rightContactElevPx = (this.baselineAnkleY ?? 0) - rightAnkle.y * canvasHeight;
    }

    const bothFeetElevated = leftContactElevPx > groundThresholdPx && rightContactElevPx > groundThresholdPx;

    // Condición completa de despegue: pies elevados + cadera arriba + velocidad ascendente real
    const takeoffCondition = bothFeetElevated && hipElevationPx > 0 && hasUpwardVelocity;

    // Crear muestra del cuadro actual
    const currentSample: FrameSample = {
      timestampMs: nowMs,
      hipYPx: currentHipY,
      ankleYPx: currentAnkleY,
      toeYPx: currentToeY
    };

    // Mantener ventana de 7 muestras previas al despegue para derivar v₀
    this.preTakeoffSamplesBuffer.push(currentSample);
    if (this.preTakeoffSamplesBuffer.length > 7) {
      this.preTakeoffSamplesBuffer.shift();
    }

    switch (this.currentState) {
      case 'IDLE': {
        this.currentJumpCm = 0;

        // ── Auto-bloqueo de suelo tras reposo estable (1.5s en vivo, 300ms en video) ──
        if (!this.isBaselineLocked) {
          this.recentHipPositions.push(currentHipY);
          if (this.recentHipPositions.length > 30) this.recentHipPositions.shift();

          const hipVariance = this.calculateVariance(this.recentHipPositions);
          const requiredTimeMs = this.isVideoMode ? this.VIDEO_STABILITY_TIME_MS : this.CALIBRATION_STABILITY_TIME_MS;

          if (hipVariance < 4.0 && (nowMs - this.idleStartTimeMs) > requiredTimeMs) {
            this.isBaselineLocked = true;
            if (this.onBaselineCalibrated) this.onBaselineCalibrated(true);
          } else if (hipVariance > 25.0) {
            this.calibrateBaseline(landmarks, canvasHeight, worldLandmarks);
            this.idleStartTimeMs = nowMs;
          }
        }

        // Transición a PREPARING si se agacha
        if (currentHipY > this.baselineHipY + crouchThresholdPx) {
          this.currentState = 'PREPARING';
        }
        // Transición directa a IN_AIR (requiere velocity gate)
        else if (takeoffCondition) {
          this.triggerTakeoff(currentSample, groundThresholdPx);
        }
        break;
      }

      case 'PREPARING': {
        this.currentJumpCm = 0;

        // Transición a IN_AIR (requiere velocity gate)
        if (takeoffCondition) {
          this.triggerTakeoff(currentSample, groundThresholdPx);
        }
        // Retorno a IDLE si se vuelve a parar erguido sin saltar
        else if (Math.abs(hipElevationPx) < groundThresholdPx && !bothFeetElevated) {
          this.currentState = 'IDLE';
          this.idleStartTimeMs = nowMs;
        }
        break;
      }

      case 'IN_AIR': {
        // Registrar muestra de vuelo para ajuste parabólico de apogeo
        this.inAirFlightSamples.push({ t: nowMs, y: currentHipY });

        // Registrar la cota máxima alcanzada (mínima Y en canvas)
        if (currentHipY < this.peakHipY) {
          this.peakHipY = currentHipY;
        }

        // Estimación en vivo en tiempo real durante el vuelo
        const partialFlightTimeMs = nowMs - this.flightStartTimeMs;
        this.currentJumpCm = this.calculateLiveHeight(partialFlightTimeMs, currentHipY);

        // Aterrizaje: cuando al menos un pie regresa al contacto inicial, la cadera ha bajado y no está subiendo
        const peakHeightPx = this.baselineHipY - this.peakHipY;
        const hipDescended = peakHeightPx > 0
          ? (hipElevationPx < peakHeightPx * 0.6 || hipElevationPx < groundThresholdPx * 2)
          : true;
        const isDescending = this.hipVelocityPxPerSec < 10; // velocidad de subida es baja o negativa (bajando)

        const leftLanded = leftContactElevPx <= groundThresholdPx * 0.5;
        const rightLanded = rightContactElevPx <= groundThresholdPx * 0.5;
        if ((leftLanded || rightLanded) && hipDescended && isDescending) {
          this.triggerLanding(currentSample, groundThresholdPx);
        }
        break;
      }

      case 'LANDED': {
        this.currentJumpCm = this.peakJumpCm;

        // Resetear a IDLE tras 2.0 segundos transcurridos en la línea de tiempo
        if (this.flightEndTimeMs > 0 && (nowMs - this.flightEndTimeMs) > 2000) {
          this.currentState = 'IDLE';
          this.idleStartTimeMs = nowMs;
          if (this.baselineHipY !== null) {
            this.peakHipY = this.baselineHipY;
          }
        }

        // Si salta inmediatamente de nuevo
        if (takeoffCondition) {
          this.triggerTakeoff(currentSample, groundThresholdPx);
        }
        break;
      }
    }

    this.lastFrameSample = currentSample;
  }

  /**
   * Inicia el estado de vuelo calculando la interpolación sub-frame del tiempo de despegue.
   */
  private triggerTakeoff(currentSample: FrameSample, thresholdPx: number): void {
    this.currentState = 'IN_AIR';
    this.peakHipY = currentSample.hipYPx;
    this.inAirFlightSamples = [{ t: currentSample.timestampMs, y: currentSample.hipYPx }];

    // Calcular velocidad de despegue en cm/s por 5 puntos Savitzky-Golay
    this.takeoffVelocityCmS = this.calculateTakeoffVelocityCmS(this.preTakeoffSamplesBuffer);

    let subFrameTimeMs = currentSample.timestampMs;

    // Interpolación lineal entre el cuadro anterior y el actual para t_off exacto (dedos)
    if (this.lastFrameSample && this.baselineToeY !== null) {
      const prevToeElev = this.baselineToeY - this.lastFrameSample.toeYPx;
      const currToeElev = this.baselineToeY - currentSample.toeYPx;
      const deltaElev = currToeElev - prevToeElev;

      if (deltaElev > 0) {
        const ratio = Math.max(0, Math.min(1, (thresholdPx - prevToeElev) / deltaElev));
        const dt = currentSample.timestampMs - this.lastFrameSample.timestampMs;
        subFrameTimeMs = this.lastFrameSample.timestampMs + ratio * dt;
      }
    }

    this.flightStartTimeMs = subFrameTimeMs;
  }

  /**
   * Procesa el aterrizaje con interpolación sub-frame y calcula la altura final según el modo elegido.
   */
  private triggerLanding(currentSample: FrameSample, thresholdPx: number): void {
    // ── Filtro de duración mínima de vuelo (180 ms) ──
    const tentativeFlightMs = currentSample.timestampMs - this.flightStartTimeMs;
    if (tentativeFlightMs < 180) return;

    // ── Ajuste Parabólico por Mínimos Cuadrados para Apogeo Sub-píxel ──
    const fittedApexY = this.fitParabolicApex(this.inAirFlightSamples);
    if (fittedApexY !== null && fittedApexY < this.peakHipY) {
      this.peakHipY = fittedApexY;
    }

    let subFrameLandMs = currentSample.timestampMs;
    const landingThresholdPx = thresholdPx * 0.5; // Toque de dedos

    // Interpolación lineal asimétrica para t_land exacto (dedos)
    if (this.lastFrameSample && this.baselineToeY !== null) {
      const prevToeElev = this.baselineToeY - this.lastFrameSample.toeYPx;
      const currToeElev = this.baselineToeY - currentSample.toeYPx;
      const deltaElev = prevToeElev - currToeElev;

      if (deltaElev > 0) {
        const ratio = Math.max(0, Math.min(1, (prevToeElev - landingThresholdPx) / deltaElev));
        const dt = currentSample.timestampMs - this.lastFrameSample.timestampMs;
        subFrameLandMs = this.lastFrameSample.timestampMs + ratio * dt;
      }
    }

    const rawFlightTimeMs = Math.max(100, subFrameLandMs - this.flightStartTimeMs);

    // ── Corrección Biomecánica por Encogimiento de Piernas (Tuck Jump Correction) ──
    const currentLegLengthPx = currentSample.ankleYPx - currentSample.hipYPx;
    const legExtensionRatio = this.standingLegLengthPx > 0
      ? currentLegLengthPx / this.standingLegLengthPx
      : 1.0;

    let correctedFlightTimeMs = rawFlightTimeMs;

    // Si las piernas están flexionadas al aterrizar (legExtensionRatio < 0.88), corregir el exceso de tiempo de vuelo
    if (legExtensionRatio < 0.88 && legExtensionRatio > 0.3) {
      const legShorteningRatio = 1.0 - legExtensionRatio;
      // Estimar altura de encogimiento en cm (~52% de la estatura es longitud promedio de piernas)
      const tuckCm = legShorteningRatio * (this.userHeightCm * 0.52);

      const deltaHipPx = Math.max(0, (this.baselineHipY ?? currentSample.hipYPx) - this.peakHipY);
      const cmPerPixel = this.standingBodyHeightPx > 0 ? (this.userHeightCm / this.standingBodyHeightPx) : 0.25;
      const approxDispCm = deltaHipPx * cmPerPixel;

      // Velocidad estimada de caída v = sqrt(2 * g * h_disp)
      const vImpactCmS = Math.sqrt(2 * GRAVITY_CM_S2 * Math.max(5, approxDispCm));
      // Tiempo inflado por encogimiento en ms: dt_tuck = (tuckCm / vImpact) * 1000
      const dtTuckMs = Math.min(250, (tuckCm / Math.max(10, vImpactCmS)) * 1000);
      correctedFlightTimeMs = Math.max(100, rawFlightTimeMs - dtTuckMs);
    }

    this.flightEndTimeMs = subFrameLandMs;
    this.lastFlightTimeMs = correctedFlightTimeMs;
    this.currentState = 'LANDED';

    // 1. Altura por Cinemática de Tiempo de Vuelo Corregido
    this.lastFlightHeightCm = this.calculateJumpHeightFromFlightTime(this.lastFlightTimeMs);

    // 2. Altura por Desplazamiento Vertical Escalado del Centro de Masa (Cadera)
    const deltaHipPx = Math.max(0, (this.baselineHipY ?? currentSample.hipYPx) - this.peakHipY);
    const cmPerPixel = this.standingBodyHeightPx > 0 ? (this.userHeightCm / this.standingBodyHeightPx) : 0.25;
    this.lastDisplacementHeightCm = deltaHipPx * cmPerPixel;

    // 3. Altura por Energía Cinemática de Velocidad de Despegue (v₀² / 2g)
    const v0CmS = this.takeoffVelocityCmS;
    this.lastKineticHeightCm = v0CmS > 0 ? (v0CmS * v0CmS) / (2 * GRAVITY_CM_S2) : 0;

    // 4. Modelo de Fusión Triangulada de 3 Fuentes (Vuelo, Apogeo y Velocidad Lanzamiento)
    let finalHeightCm = 0;

    const flightCm = this.lastFlightHeightCm;
    const dispCm = this.lastDisplacementHeightCm;
    const kineticCm = this.lastKineticHeightCm;

    if (dispCm > 3 && flightCm > 3) {
      const maxVal = Math.max(flightCm, dispCm);
      const relativeDiff = Math.abs(flightCm - dispCm) / maxVal;

      // ── Clamp de sanidad: si las dos fuentes discrepan más de un 40%,
      // confiar solo en la cinemática de tiempo de vuelo, que es menos
      // susceptible a errores de escala de píxeles y calibración de estatura ──
      if (relativeDiff > 0.40) {
        finalHeightCm = flightCm;
      } else {
        // Peso Gaussiano de Coherencia Parabólica
        const wFlight = Math.exp(-3.5 * Math.pow(relativeDiff, 2));
        const wDisp = 1.0 - wFlight;
        let fused = wFlight * flightCm + wDisp * dispCm;

        // Triangular con energía cinemática v₀ si está disponible y es coherente
        if (kineticCm > 3 && kineticCm < maxVal * 1.35) {
          fused = 0.75 * fused + 0.25 * kineticCm;
        }

        finalHeightCm = fused;
      }
    } else {
      finalHeightCm = Math.max(flightCm, dispCm);
    }

    // Guardar el anterior salto antes de actualizar
    const prevJump = this.peakJumpCm;

    this.peakJumpCm = Number(finalHeightCm.toFixed(1));
    this.currentJumpCm = this.peakJumpCm;

    // Si ya había un salto anterior registrado en esta sesión (o recuperado), lo guardamos como lastJumpCm
    if (prevJump > 0 && prevJump !== this.peakJumpCm) {
      this.lastJumpCm = prevJump;
      localStorage.setItem(JumpModel.LAST_JUMP_KEY, String(prevJump));
    }

    // Comprobar nuevo récord
    if (this.peakJumpCm > this.maxJumpCm) {
      this.maxJumpCm = this.peakJumpCm;
      localStorage.setItem(JumpModel.STORAGE_KEY, String(this.maxJumpCm));
      if (this.onNewRecord) this.onNewRecord(this.maxJumpCm);
    }

    if (this.onJumpCompleted) {
      this.onJumpCompleted(this.peakJumpCm, this.lastFlightTimeMs, this.lastDisplacementHeightCm);
    }

    // Se elimina el timer asíncrono. El reseteo a IDLE se gestiona directamente en el estado LANDED de processFrame.
  }

  /**
   * Calcula la altura estimada en vivo durante el vuelo.
   * Usa la misma fusión Gaussiana de coherencia parabólica que en el aterrizaje,
   * aplicando además una cota superior cinemática para evitar oscilaciones en vivo.
   */
  private calculateLiveHeight(flightMs: number, currentHipY: number): number {
    const flightCm = this.calculateJumpHeightFromFlightTime(flightMs);

    if (this.baselineHipY !== null && this.standingBodyHeightPx > 0) {
      const deltaHipPx = Math.max(0, this.baselineHipY - currentHipY);
      const dispCm = deltaHipPx * (this.userHeightCm / this.standingBodyHeightPx);

      // Fusión Gaussiana coherente en vivo (idéntica al modelo final de aterrizaje)
      if (dispCm > 2 && flightCm > 2) {
        const maxVal = Math.max(flightCm, dispCm);
        const relativeDiff = Math.abs(flightCm - dispCm) / maxVal;
        const wFlight = Math.exp(-3.5 * relativeDiff * relativeDiff);
        const wDisp = 1.0 - wFlight;
        const fused = wFlight * flightCm + wDisp * dispCm;

        // En vivo la cota superior es la altura máxima parabólica teórica estimada
        // desde la velocidad actual de despegue calculada a la mitad del vuelo:
        // h_max = v₀² / (2g), donde v₀ ≈ g × t_vuelo_parcial (si no llegamos al pico aún)
        const v0EstCmS = this.calculateInitialVelocity(flightMs * 2);
        const theoreticalMaxCm = (v0EstCmS * v0EstCmS) / (2 * GRAVITY_CM_S2);
        return Math.min(fused, theoreticalMaxCm * 1.05); // tolerancia del 5%
      }
      return Math.max(flightCm, dispCm);
    }

    return flightCm;
  }

  /**
   * Estima la velocidad vertical inicial de despegue v₀ en cm/s
   * mediante diferencias finitas centrales de 5 puntos (Savitzky-Golay).
   */
  private calculateTakeoffVelocityCmS(samples: FrameSample[]): number {
    if (samples.length < 3) return 0;
    const cmPerPx = this.standingBodyHeightPx > 0 ? (this.userHeightCm / this.standingBodyHeightPx) : 0.25;

    // Regresión lineal por mínimos cuadrados sobre los últimos N puntos.
    // A diferencia de Savitzky-Golay, funciona correctamente con intervalos
    // de tiempo no uniformes causados por el throttle de inferencia de MediaPipe.
    const nPts = Math.min(7, samples.length);
    const pts = samples.slice(-nPts);
    const t0 = pts[0].timestampMs;

    let sumT = 0, sumY = 0, sumTY = 0, sumT2 = 0;
    for (const pt of pts) {
      const t = (pt.timestampMs - t0) / 1000; // segundos relativos al primer punto
      sumT += t;
      sumY += pt.hipYPx;
      sumTY += t * pt.hipYPx;
      sumT2 += t * t;
    }

    const det = nPts * sumT2 - sumT * sumT;
    if (Math.abs(det) < 1e-9) return 0;

    // Pendiente en px/s (negativa = cuerpo subiendo, ya que Y crece hacia abajo)
    const slope = (nPts * sumTY - sumT * sumY) / det;
    const velocityCmS = Math.max(0, -slope * cmPerPx);
    return velocityCmS;
  }

  /**
   * Ajuste parabólico por mínimos cuadrados para calcular el vértice mínimo (apogeo del salto en canvas Y)
   * con precisión sub-píxel e inmunidad a ruido de detección de MediaPipe.
   */
  private fitParabolicApex(samples: { t: number; y: number }[]): number | null {
    if (samples.length < 5) return null;

    const minRawY = Math.min(...samples.map(s => s.y));
    const minIndex = samples.findIndex(s => s.y === minRawY);

    const startIndex = Math.max(0, minIndex - 4);
    const endIndex = Math.min(samples.length, minIndex + 5);
    const apexWindow = samples.slice(startIndex, endIndex);

    if (apexWindow.length < 5) return null;

    const tMid = apexWindow[Math.floor(apexWindow.length / 2)].t;
    let n = 0, sumT = 0, sumT2 = 0, sumT3 = 0, sumT4 = 0;
    let sumY = 0, sumTY = 0, sumT2Y = 0;

    for (const sample of apexWindow) {
      const t = (sample.t - tMid) / 1000;
      const y = sample.y;
      const t2 = t * t;

      n++;
      sumT += t;
      sumT2 += t2;
      sumT3 += t2 * t;
      sumT4 += t2 * t2;

      sumY += y;
      sumTY += t * y;
      sumT2Y += t2 * y;
    }

    const det = n * (sumT2 * sumT4 - sumT3 * sumT3) -
                sumT * (sumT * sumT4 - sumT2 * sumT3) +
                sumT2 * (sumT * sumT3 - sumT2 * sumT2);

    if (Math.abs(det) < 1e-7) return null;

    const detA = sumY * (sumT2 * sumT4 - sumT3 * sumT3) -
                 sumT * (sumTY * sumT4 - sumT2Y * sumT3) +
                 sumT2 * (sumTY * sumT3 - sumT2Y * sumT2);

    const detB = n * (sumTY * sumT4 - sumT2Y * sumT3) -
                 sumY * (sumT * sumT4 - sumT2 * sumT3) +
                 sumT2 * (sumT * sumT2Y - sumTY * sumT2);

    const detC = n * (sumT2 * sumT2Y - sumT3 * sumTY) -
                 sumT * (sumT * sumT2Y - sumT2 * sumTY) +
                 sumY * (sumT * sumT3 - sumT2 * sumT2);

    const a = detA / det;
    const b = detB / det;
    const c = detC / det;

    if (a <= 0) return null;

    const yVertex = c - (b * b) / (4 * a);
    return yVertex;
  }

  /**
   * Función auxiliar para calcular varianza
   */
  private calculateVariance(arr: number[]): number {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
  }

  /**
   * Reinicia la métrica de récord.
   */
  public resetRecord(): void {
    this.maxJumpCm = 0;
    this.peakJumpCm = 0;
    this.currentJumpCm = 0;
    localStorage.removeItem(JumpModel.STORAGE_KEY);
  }
}
