/**
 * ============================================================================
 * CONTROLADOR: JumpController.ts
 * Responsabilidad: Orquestar el flujo de la aplicación. Conecta el feed de
 * video, la visión por computadora (PoseModel), la matemática/estado (JumpModel),
 * el renderizado en canvas (CanvasView) y el DOM (UIView).
 *
 * Mejoras v2:
 *  - Constraints de video mejoradas: mayor resolución en móvil portrait + frameRate ideal 30.
 *  - Modelo `full` activado automáticamente en desktop para mayor precisión.
 *  - Detección y manejo de cambios de orientación (portrait/landscape).
 *  - Pasa avgPoseVisibility a CanvasView y UIView para indicadores de calidad.
 *  - Escucha onBaselineAutoRecalibrated de JumpModel para disparar toasts en UIView.
 * ============================================================================
 */

import { PoseModel } from "../models/PoseModel";
import { JumpModel, JumpState } from "../models/JumpModel";
import { CanvasView } from "../views/CanvasView";
import { UIView } from "../views/UIView";

export interface RecordedFrame {
  timestampMs: number;
  landmarks: any;
  worldLandmarks?: any;
  avgVisibility: number;
  state: JumpState;
  currentJumpCm: number;
  peakHipY: number;
  isBaselineLocked: boolean;
  baselineHipY: number | null;
  baselineAnkleY: number | null;
}


export class JumpController {
  private poseModel: PoseModel;
  private jumpModel: JumpModel;
  private canvasView: CanvasView;
  private uiView: UIView;

  private activeSource: 'camera' | 'video' | 'none' = 'none';
  private currentObjectUrl: string | null = null;
  private currentStream: MediaStream | null = null;
  private currentFacingMode: 'user' | 'environment' = 'environment';
  private isMirrored: boolean = false;
  private isInferringFrame: boolean = false;

  private animationFrameId: number | null = null;
  private lastLandmarks: any = null;
  private videoStopTimeout: number | null = null;
  private recordedFrames: RecordedFrame[] = [];

  // Contador de generación para evitar race conditions entre cargas rápidas de video
  private loadGeneration: number = 0;

  // Optimizaciones de rendimiento móvil
  private lastInferenceMs: number = 0;
  private lastVideoWidth: number = 0;
  private lastVideoHeight: number = 0;
  // En móvil se limita a ~30fps para la inferencia de pose; en desktop se permite hasta 60fps
  private readonly INFERENCE_INTERVAL_MS: number = this.isMobile() ? 34 : 17;

  // Calidad de detección y notificaciones
  private lastAvgVisibility: number = 0;   // promedio de visibilidad de keypoints clave
  private lastLandmarkSeenMs: number = 0;  // última vez que se detectó una persona
  private poseLostNotified: boolean = false; // evita notificaciones repetidas

  // Orientación del dispositivo
  private isPortrait: boolean = true;

  constructor() {
    this.uiView = new UIView();
    this.canvasView = new CanvasView(this.uiView.getCanvasElement(), this.isMobile());
    this.poseModel = new PoseModel();
    this.jumpModel = new JumpModel();

    // Detectar orientación inicial
    this.isPortrait = window.innerHeight > window.innerWidth;

    // Escuchar cuando se completa un salto
    this.jumpModel.onJumpCompleted = (peakCm) => {
      // Guardar el salto en el historial y récord del atleta activo
      this.uiView.recordJumpForActiveAthlete(peakCm);
      // Mostrar la rutina recomendada directamente
      this.uiView.updateRoutineAndProgress(peakCm);
    };

    // Toast al calibrar y fijar automáticamente el suelo
    this.jumpModel.onBaselineCalibrated = (isLocked) => {
      if (isLocked) {
        this.uiView.showToast("🔒 Suelo calibrado y fijado", 'success');
      } else {
        this.uiView.showToast("🎯 Suelo detectado automáticamente", 'info');
      }
    };

    // Toast y celebración visual al romper el récord personal
    this.jumpModel.onNewRecord = (peakCm) => {
      this.uiView.triggerRecordCelebration(peakCm);
    };

    // Notificación al estimar automáticamente la estatura 3D del atleta
    this.jumpModel.onAutoHeightEstimated = (estimatedCm) => {
      this.uiView.updateUserHeightInput(estimatedCm);
      this.jumpModel.setAthleteProfile({ heightCm: estimatedCm });
      this.uiView.showToast(`📏 Estatura estimada por IA: ${estimatedCm} cm`, 'info');
    };

    this.init();
  }

  /**
   * Inicializa los componentes de la aplicación y escucha los eventos de la UI.
   */
  private async init(): Promise<void> {
    // Sincronizar valores iniciales de la UI
    this.uiView.setInitialValues(
      this.jumpModel.getUserHeightCm()
    );

    // Vincular eventos de usuario desde la Vista UI
    const callbacks = {
      onSelectVideoFile: (file: File) => this.loadVideoFile(file),
      onStartCamera: () => {
        if (this.activeSource === 'camera') {
          this.stopActiveSource();
        } else {
          this.startCamera(this.currentFacingMode);
        }
      },
      onStopCamera: () => this.stopActiveSource(),
      onSwitchCamera: () => this.switchCamera(),
      onToggleMirror: () => this.toggleMirror(),
      onResetRecord: () => this.resetRecord(),
      onChangeUserHeight: (heightCm: number) => {
        this.jumpModel.setUserHeightCm(heightCm);
      },
      onShowRoutine: () => {
        const lastRecord = this.jumpModel.getMaxJumpCm();
        if (lastRecord > 0) {
          this.uiView.updateRoutineAndProgress(lastRecord);
        } else {
          this.uiView.showToast("📊 Registra un salto primero para generar tu rutina", 'info');
        }
      },
      onSaveAthleteProfile: (newProfile: { name: string; weightKg: number; heightCm: number }) => {
        this.jumpModel.setAthleteProfile(newProfile);
        this.uiView.updateUserHeightInput(newProfile.heightCm, false);
      },
      onSelectAthleteRecord: (recordCm: number) => {
        this.jumpModel.setMaxJumpCm(recordCm);
      }
    };
    this.uiView.bindEvents(callbacks);
    // Inicializar header del atleta activo desde el roster persistido
    this.uiView.initAthleteHeaderFromRoster(callbacks);

    try {
      // Cargar modelo de MediaPipe: Full en desktop (más preciso), Lite en móvil (más rápido)
      const useLiteModel = this.isMobile();
      this.uiView.updateLoadingState(true, `Iniciando IA (${useLiteModel ? 'Lite' : 'Full'})...`);
      await this.poseModel.initialize((msg) => {
        this.uiView.updateLoadingState(true, msg);
      }, useLiteModel);
      this.uiView.updateLoadingState(false);
    } catch (error) {
      console.error("No se pudo cargar el modelo:", error);
      this.uiView.updateLoadingState(true, "Error al cargar el modelo de IA. Verifica tu conexión a internet.");
    }

    // Pausar el bucle cuando el usuario cambia de pestaña o app (ahorra batería)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.animationFrameId !== null) {
          cancelAnimationFrame(this.animationFrameId);
          this.animationFrameId = null;
        }
      } else if (this.activeSource !== 'none') {
        // Reanudar el bucle al volver a la pestaña
        this.processLoop();
      }
    });
  }

  private async loadVideoFile(file: File): Promise<void> {
    // Detener cualquier fuente activa y resetear TODO el estado
    this.stopActiveSource();

    // Incrementar la generación para invalidar cargas anteriores que aún no resolvieron
    const thisGeneration = ++this.loadGeneration;

    this.currentObjectUrl = URL.createObjectURL(file);
    const videoEl = this.uiView.getVideoElement();

    // Limpiar listeners anteriores para evitar acumulación
    videoEl.onended = null;
    videoEl.onloadedmetadata = null;
    videoEl.onerror = null;

    videoEl.srcObject = null;
    videoEl.src = this.currentObjectUrl;
    videoEl.loop = false; // Desactivar bucle para detectar el final del video
    videoEl.muted = true;

    // Al finalizar el video por completo, esperar 2 segundos y detener la fuente para liberar recursos
    videoEl.onended = () => {
      if (this.activeSource === 'video' && this.loadGeneration === thisGeneration) {
        console.log("El video ha terminado. Esperando 2 segundos para liberar recursos...");
        if (this.videoStopTimeout) window.clearTimeout(this.videoStopTimeout);
        this.videoStopTimeout = window.setTimeout(() => {
          if (this.activeSource === 'video') {
            this.stopActiveSource();
          }
        }, 2000);
      }
    };

    // Manejar errores de carga de video para evitar crashes silenciosos
    videoEl.onerror = () => {
      if (this.loadGeneration === thisGeneration) {
        console.error("Error al cargar el video:", file.name);
        this.uiView.showToast("❌ Error al cargar el video. Intenta con otro archivo.", 'warning');
        this.stopActiveSource();
      }
    };

    try {
      this.uiView.updateLoadingState(true, "Cargando metadatos del video...");
      await new Promise<void>((resolve, reject) => {
        videoEl.onloadedmetadata = () => resolve();
        // Timeout de seguridad: si no carga en 15s, abortar
        setTimeout(() => reject(new Error('Timeout')), 15000);
      });
    } catch {
      if (this.loadGeneration !== thisGeneration) return;
      this.uiView.showToast("⚠️ El video tardó demasiado en cargar.", 'warning');
      this.stopActiveSource();
      return;
    }

    if (this.loadGeneration !== thisGeneration) {
      URL.revokeObjectURL(this.currentObjectUrl);
      return;
    }

    // Ajustar el canvas al tamaño del video
    this.canvasView.resize(videoEl.videoWidth, videoEl.videoHeight);
    this.lastVideoWidth = videoEl.videoWidth;
    this.lastVideoHeight = videoEl.videoHeight;

    this.uiView.updateLoadingState(true, "⏳ Analizando video... 0% | Espera unos segundos...");

    try {
      this.recordedFrames = await this.scanVideo(videoEl, thisGeneration);
    } catch (scanErr) {
      console.error("Error durante el escaneo del video:", scanErr);
      if (this.loadGeneration === thisGeneration) {
        this.uiView.showToast("❌ Error al procesar el video.", 'warning');
        this.stopActiveSource();
      }
      return;
    }

    if (this.loadGeneration !== thisGeneration) return;

    if (this.recordedFrames.length === 0) {
      this.uiView.showToast("⚠️ No se detectó ninguna persona en el video. Asegúrate de mostrar el cuerpo completo.", 'warning');
      this.stopActiveSource();
      return;
    }

    // Suavizar landmarks detectados (Filtro de Mediana 3D)
    this.recordedFrames = this.smoothLandmarks(this.recordedFrames);

    // Procesar frames a través de JumpModel de forma offline
    this.jumpModel.recalibrateBaseline();
    for (const frame of this.recordedFrames) {
      this.jumpModel.processFrame(frame.landmarks, videoEl.videoHeight, frame.timestampMs, frame.worldLandmarks);
      
      // Guardar outputs del modelo de salto
      frame.state = this.jumpModel.getCurrentState();
      frame.currentJumpCm = this.jumpModel.getCurrentJumpCm();
      frame.peakHipY = this.jumpModel.getPeakHipY();
      frame.isBaselineLocked = this.jumpModel.getIsBaselineLocked();
      frame.baselineHipY = this.jumpModel.getBaselineHipY();
      frame.baselineAnkleY = this.jumpModel.getBaselineAnkleY();
    }

    this.uiView.updateLoadingState(false);
    this.uiView.showToast("✅ Análisis completado con éxito", 'success');

    // Reproducir video
    videoEl.currentTime = 0;
    videoEl.play().catch(() => {
      console.warn('Autoplay bloqueado, el usuario debe interactuar.');
    });

    this.activeSource = 'video';
    this.jumpModel.setIsVideoMode(true);
    this.uiView.setSourceState('video', file.name);

    if (this.animationFrameId === null) {
      this.processLoop();
    }
  }

  /**
   * Inicia la captura de cámara en vivo y procesamiento en tiempo real.
   */
  private async startCamera(facingMode: 'user' | 'environment' = this.currentFacingMode): Promise<void> {
    // Detener cualquier fuente activa previa
    this.stopActiveSource();

    const thisGeneration = ++this.loadGeneration;
    this.currentFacingMode = facingMode;

    // Por defecto, si es cámara frontal (user), activar modo espejo para que se sienta natural
    this.isMirrored = (facingMode === 'user');
    this.canvasView.setMirrored(this.isMirrored);
    this.uiView.setMirrorMode(this.isMirrored);

    this.uiView.updateLoadingState(true, `Iniciando cámara ${facingMode === 'user' ? 'frontal' : 'trasera'}...`);

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60, max: 60 }
        }
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        console.warn("[JumpController] Falló getUserMedia con constraints ideales, usando básicos...", err);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: facingMode }
        });
      }

      if (this.loadGeneration !== thisGeneration) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      this.currentStream = stream;
      const videoEl = this.uiView.getVideoElement();

      // Limpiar listeners anteriores
      videoEl.onended = null;
      videoEl.onerror = null;
      videoEl.src = '';
      videoEl.removeAttribute('src');
      videoEl.srcObject = stream;
      videoEl.muted = true;
      videoEl.playsInline = true;

      await new Promise<void>((resolve) => {
        if (videoEl.readyState >= 1) {
          resolve();
        } else {
          videoEl.onloadedmetadata = () => resolve();
          setTimeout(resolve, 3000); // Timeout de seguridad
        }
      });

      if (this.loadGeneration !== thisGeneration) {
        this.stopActiveSource();
        return;
      }

      await videoEl.play().catch(e => console.warn("[JumpController] Autoplay de cámara:", e));

      if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        this.canvasView.resize(videoEl.videoWidth, videoEl.videoHeight);
        this.lastVideoWidth = videoEl.videoWidth;
        this.lastVideoHeight = videoEl.videoHeight;
      }

      this.activeSource = 'camera';
      this.jumpModel.setIsVideoMode(false);
      this.jumpModel.recalibrateBaseline();

      this.uiView.setSourceState('camera');
      this.uiView.updateLoadingState(false);
      this.uiView.showToast(`📸 Cámara ${facingMode === 'user' ? 'frontal' : 'trasera'} en vivo activa`, 'success');

      if (this.animationFrameId === null) {
        this.processLoop();
      }
    } catch (error: any) {
      console.error("[JumpController] Error al acceder a la cámara:", error);
      this.uiView.updateLoadingState(false);
      this.stopActiveSource();

      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        this.uiView.showToast("⚠️ Permiso de cámara denegado. Permite el acceso en tu navegador.", 'warning', 5000);
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        this.uiView.showToast("❌ No se encontró ninguna cámara en el dispositivo.", 'warning', 4000);
      } else {
        this.uiView.showToast("❌ No se pudo iniciar la cámara. Verifica los permisos del navegador.", 'warning', 4000);
      }
    }
  }

  /**
   * Alterna entre cámara trasera y frontal.
   */
  private switchCamera(): void {
    const nextMode: 'user' | 'environment' = this.currentFacingMode === 'user' ? 'environment' : 'user';
    this.startCamera(nextMode);
  }

  /**
   * Alterna el modo espejo (flip horizontal).
   */
  private toggleMirror(): void {
    this.isMirrored = !this.isMirrored;
    this.canvasView.setMirrored(this.isMirrored);
    this.uiView.setMirrorMode(this.isMirrored);
    this.uiView.showToast(this.isMirrored ? "🪞 Modo espejo activado" : "🪞 Modo espejo desactivado", 'info');
  }

  /**
   * Detiene la fuente activa (cámara o video).
   */
  private stopActiveSource(): void {
    if (this.videoStopTimeout) {
      window.clearTimeout(this.videoStopTimeout);
      this.videoStopTimeout = null;
    }

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }

    // Detener y liberar stream de cámara
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(track => {
        try { track.stop(); } catch (e) { console.warn("Error al detener track:", e); }
      });
      this.currentStream = null;
    }

    const videoEl = this.uiView.getVideoElement();
    videoEl.pause();
    videoEl.onended = null;
    videoEl.onloadedmetadata = null;
    videoEl.onerror = null;
    videoEl.srcObject = null;
    videoEl.removeAttribute('src');
    videoEl.load(); // Forzar liberación del recurso anterior

    // RESETS DE ESTADO DEL CONTROLADOR PARA NUEVO PROCESAMIENTO:
    this.lastLandmarks = null;
    this.lastInferenceMs = 0;
    this.lastVideoWidth = 0;
    this.lastVideoHeight = 0;
    this.lastAvgVisibility = 0;
    this.lastLandmarkSeenMs = 0;
    this.poseLostNotified = false;
    this.isInferringFrame = false;
    this.recordedFrames = [];

    // RESET COMPLETO DEL MODELO DE SALTO
    this.jumpModel.recalibrateBaseline();

    this.activeSource = 'none';
    this.uiView.setSourceState('none');
    this.canvasView.clear();
  }

  /**
   * Bucle de animación continuo (requestAnimationFrame)
   */
  private processLoop = (): void => {
    if (this.activeSource === 'none') return;

    try {
      const videoEl = this.uiView.getVideoElement();

      if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        // Solo redimensionar el canvas cuando cambian las dimensiones del video
        if (videoEl.videoWidth !== this.lastVideoWidth || videoEl.videoHeight !== this.lastVideoHeight) {
          this.canvasView.resize(videoEl.videoWidth, videoEl.videoHeight);
          this.lastVideoWidth = videoEl.videoWidth;
          this.lastVideoHeight = videoEl.videoHeight;
        }

        if (this.activeSource === 'camera') {
          // ── MODO CÁMARA EN TIEMPO REAL ──
          const now = performance.now();
          const timeSinceLast = now - this.lastInferenceMs;

          // Inferencia directa respetando el intervalo para asegurar fluidez
          if (timeSinceLast >= this.INFERENCE_INTERVAL_MS && !this.isInferringFrame && videoEl.readyState >= 2) {
            this.lastInferenceMs = now;
            this.isInferringFrame = true;

            try {
              const poseResult = this.poseModel.detectPose(videoEl, now);

              if (poseResult && poseResult.landmarks && poseResult.landmarks.length > 0) {
                const landmarks = poseResult.landmarks[0];
                const worldLandmarks = (poseResult.worldLandmarks && poseResult.worldLandmarks.length > 0)
                  ? poseResult.worldLandmarks[0]
                  : undefined;

                const keyIndices = [11, 12, 23, 24, 25, 26, 27, 28];
                const avgVisibility = keyIndices.reduce(
                  (s, i) => s + ((landmarks[i]?.visibility) ?? 0), 0
                ) / keyIndices.length;

                // Procesar a través de la física y máquina de estados de JumpModel
                this.jumpModel.processFrame(landmarks, videoEl.videoHeight, now, worldLandmarks);

                const state = this.jumpModel.getCurrentState();
                const currentJumpCm = this.jumpModel.getCurrentJumpCm();
                const peakHipY = this.jumpModel.getPeakHipY();
                const isBaselineLocked = this.jumpModel.getIsBaselineLocked();
                const baselineHipY = this.jumpModel.getBaselineHipY();
                const baselineAnkleY = this.jumpModel.getBaselineAnkleY();

                // Renderizar en el canvas en tiempo real
                this.canvasView.render(
                  landmarks,
                  baselineHipY,
                  baselineAnkleY,
                  isBaselineLocked,
                  peakHipY,
                  currentJumpCm,
                  state,
                  avgVisibility
                );

                // Actualizar telemetría y HUD en tiempo real
                this.uiView.updateMetrics(
                  currentJumpCm,
                  this.jumpModel.getMaxJumpCm(),
                  state,
                  isBaselineLocked,
                  this.jumpModel.getLastFlightTimeMs(),
                  this.jumpModel.getLastDisplacementHeightCm(),
                  avgVisibility
                );

                this.lastLandmarkSeenMs = now;
                this.poseLostNotified = false;
              } else {
                // Si no se detecta a la persona en este cuadro
                this.canvasView.render(null, null, null, false, Infinity, 0, 'IDLE', 0);
                this.uiView.updateSignalQuality(0, 'IDLE');

                if (now - this.lastLandmarkSeenMs > 3000 && !this.poseLostNotified && this.lastLandmarkSeenMs > 0) {
                  this.poseLostNotified = true;
                }
              }
            } finally {
              this.isInferringFrame = false;
            }
          }
        } else if (this.activeSource === 'video') {
          // ── MODO VIDEO SUBIDO (Offline Scanned Frames) ──
          const currentVideoTimeMs = videoEl.currentTime * 1000;
          const frame = this.findNearestFrame(currentVideoTimeMs);

          if (frame) {
            this.canvasView.render(
              frame.landmarks,
              frame.baselineHipY,
              frame.baselineAnkleY,
              frame.isBaselineLocked,
              frame.peakHipY,
              frame.currentJumpCm,
              frame.state,
              frame.avgVisibility
            );

            this.uiView.updateMetrics(
              frame.currentJumpCm,
              this.jumpModel.getMaxJumpCm(),
              frame.state,
              frame.isBaselineLocked,
              this.jumpModel.getLastFlightTimeMs(),
              this.jumpModel.getLastDisplacementHeightCm(),
              frame.avgVisibility
            );
          }
        }
      }
    } catch (err) {
      console.error('[processLoop] Error en frame, continuando...', err);
    }

    this.animationFrameId = requestAnimationFrame(this.processLoop);
  };

  /**
   * Detecta si el dispositivo es un teléfono o tablet.
   */
  private isMobile(): boolean {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      ('ontouchstart' in window && navigator.maxTouchPoints > 1);
  }

  /**
   * Escanea el video de forma offline fotograma a fotograma.
   */
  private async scanVideo(videoEl: HTMLVideoElement, thisGeneration: number): Promise<RecordedFrame[]> {
    const duration = videoEl.duration;
    const fps = 30; // 30 FPS estándar para el análisis
    const step = 1 / fps;
    const frames: RecordedFrame[] = [];
    
    videoEl.pause();
    
    const totalSteps = Math.ceil(duration / step);
    let currentStep = 0;
    
    for (let t = 0; t <= duration; t += step) {
      if (this.loadGeneration !== thisGeneration) break;
      
      videoEl.currentTime = t;
      
      await new Promise<void>((resolve) => {
        videoEl.onseeked = () => resolve();
      });
      
      const timestampMs = t * 1000;
      const poseResult = this.poseModel.detectPose(videoEl, timestampMs);
      
      if (poseResult && poseResult.landmarks && poseResult.landmarks.length > 0) {
        const landmarks = poseResult.landmarks[0];
        const worldLandmarks = (poseResult.worldLandmarks && poseResult.worldLandmarks.length > 0)
          ? poseResult.worldLandmarks[0]
          : undefined;
          
        const keyIndices = [11, 12, 23, 24, 25, 26, 27, 28];
        const avgVisibility = keyIndices.reduce(
          (s, i) => s + ((landmarks[i]?.visibility) ?? 0), 0
        ) / keyIndices.length;
        
        frames.push({
          timestampMs,
          landmarks,
          worldLandmarks,
          avgVisibility,
          state: 'IDLE',
          currentJumpCm: 0,
          peakHipY: Infinity,
          isBaselineLocked: false,
          baselineHipY: null,
          baselineAnkleY: null
        });
      }
      
      currentStep++;
      const percent = Math.min(100, Math.round((currentStep / totalSteps) * 100));
      this.uiView.updateLoadingState(true, `⏳ Analizando video... ${percent}% | Espera unos segundos...`);
    }
    
    return frames;
  }

  /**
   * Suaviza las coordenadas de los landmarks utilizando un filtro de mediana 3D de 3 frames.
   */
  private smoothLandmarks(frames: RecordedFrame[]): RecordedFrame[] {
    if (frames.length < 3) return frames;
    
    const smoothed: RecordedFrame[] = JSON.parse(JSON.stringify(frames));
    
    for (let i = 1; i < frames.length - 1; i++) {
      const prev = frames[i - 1].landmarks;
      const curr = frames[i].landmarks;
      const next = frames[i + 1].landmarks;
      
      const smoothedLandmarks = smoothed[i].landmarks;
      
      for (let j = 0; j < curr.length; j++) {
        if (prev[j] && curr[j] && next[j]) {
          smoothedLandmarks[j].x = this.median3(prev[j].x, curr[j].x, next[j].x);
          smoothedLandmarks[j].y = this.median3(prev[j].y, curr[j].y, next[j].y);
          smoothedLandmarks[j].z = this.median3(prev[j].z, curr[j].z, next[j].z);
          smoothedLandmarks[j].visibility = this.median3(
            prev[j].visibility ?? 0,
            curr[j].visibility ?? 0,
            next[j].visibility ?? 0
          );
        }
      }
      
      if (frames[i - 1].worldLandmarks && frames[i].worldLandmarks && frames[i + 1].worldLandmarks) {
        const wPrev = frames[i - 1].worldLandmarks!;
        const wCurr = frames[i].worldLandmarks!;
        const wNext = frames[i + 1].worldLandmarks!;
        const wSmoothed = smoothed[i].worldLandmarks!;
        
        for (let j = 0; j < wCurr.length; j++) {
          if (wPrev[j] && wCurr[j] && wNext[j]) {
            wSmoothed[j].x = this.median3(wPrev[j].x, wCurr[j].x, wNext[j].x);
            wSmoothed[j].y = this.median3(wPrev[j].y, wCurr[j].y, wNext[j].y);
            wSmoothed[j].z = this.median3(wPrev[j].z, wCurr[j].z, wNext[j].z);
            wSmoothed[j].visibility = this.median3(
              wPrev[j].visibility ?? 0,
              wCurr[j].visibility ?? 0,
              wNext[j].visibility ?? 0
            );
          }
        }
      }
    }
    
    return smoothed;
  }

  /**
   * Devuelve la mediana de 3 números de forma extremadamente rápida.
   */
  private median3(a: number, b: number, c: number): number {
    return a + b + c - Math.min(a, b, c) - Math.max(a, b, c);
  }

  /**
   * Búsqueda binaria para encontrar el frame precalculado más cercano a un tiempo dado.
   */
  private findNearestFrame(timestampMs: number): RecordedFrame | null {
    if (this.recordedFrames.length === 0) return null;
    
    let low = 0;
    let high = this.recordedFrames.length - 1;
    
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.recordedFrames[mid].timestampMs < timestampMs) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    
    if (low > 0) {
      const diffCurr = Math.abs(this.recordedFrames[low].timestampMs - timestampMs);
      const diffPrev = Math.abs(this.recordedFrames[low - 1].timestampMs - timestampMs);
      if (diffPrev < diffCurr) {
        return this.recordedFrames[low - 1];
      }
    }
    return this.recordedFrames[low];
  }

  /**
   * Reinicia el récord de salto máximo.
   */
  private resetRecord(): void {
    this.jumpModel.resetRecord();
  }
}
