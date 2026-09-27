/**
 * ============================================================================
 * VISTA: UIView.ts
 * Responsabilidad: Manejo y actualización de elementos del DOM de la interfaz,
 * superposición de métricas (cm en vivo), insignias de estado y controles.
 *
 * Mejoras v2:
 *  - Sistema de toasts apilables (showToast) con tipos success/warning/info.
 *  - Indicador de calidad de señal de pose (3 barras: Mala/Regular/Buena).
 *  - Toast automático de "¡Listo para saltar!" al detectar buena pose por primera vez.
 * ============================================================================
 */

import { JumpState } from "../models/JumpModel";
import { AthleteService, RemoteAthlete } from "../services/AthleteService";


export interface UIEventCallbacks {
  onSelectVideoFile: (file: File) => void;
  onStartCamera?: () => void;
  onStopCamera?: () => void;
  onSwitchCamera?: () => void;
  onToggleMirror?: () => void;
  onResetRecord: () => void;
  onChangeUserHeight: (heightCm: number) => void;
  onShowRoutine?: () => void;
  onOpenAthleteProfile?: () => void;
  onSaveAthleteProfile?: (profile: { name: string; weightKg: number; heightCm: number }) => void;
  onSelectAthleteRecord?: (recordCm: number) => void;
}

export interface AthleteStats {
  recordCm: number;
  lastJumpCm: number;
  totalJumps: number;
  lastJumpDate?: string;
  jumpHistory?: number[];
}

export class UIView {
  // Elementos HTML
  private liveHeightVal: HTMLElement;
  private maxJumpVal: HTMLElement;
  private jumpStateBadge: HTMLElement;
  private jumpStateText: HTMLElement;
  private flightTimeText: HTMLElement | null;
  private displacementText: HTMLElement | null;
  private baselineStatusText: HTMLElement | null;
  private lastJumpTimeText: HTMLElement | null;

  private loadingOverlay: HTMLElement;
  private loadingText: HTMLElement;

  // Botones de acción principales
  private btnStartCamera: HTMLButtonElement;
  private btnStartCameraText: HTMLElement;
  private btnUploadVideo: HTMLButtonElement;
  private btnUploadVideoText: HTMLElement;
  private videoFileInput: HTMLInputElement;
  private btnResetRecord: HTMLButtonElement;

  // Controles flotantes de cámara
  private cameraToolbar: HTMLElement;
  private btnSwitchCamera: HTMLButtonElement;
  private btnToggleMirror: HTMLButtonElement;
  private btnStopCamera: HTMLButtonElement;
  private canvasWrapper: HTMLElement | null;

  private userHeightInput: HTMLInputElement | null;
  private autoHeightBadge: HTMLElement | null;
  private heightChips: HTMLButtonElement[];
  private videoElement: HTMLVideoElement;
  private canvasElement: HTMLCanvasElement;
  // Elementos de rutina en modal de pantalla completa
  private resultsModal: HTMLElement;
  private modalJumpVal: HTMLElement;
  private modalRoutineLevel: HTMLElement;
  private modalRoutineDesc: HTMLElement;
  private modalRoutineExercises: HTMLElement;
  private btnCloseModal: HTMLElement;
  private btnModalDismiss: HTMLElement;
  private btnShowRoutine: HTMLButtonElement;

  // Modal de tips antes de subir video
  private videoTipsModal: HTMLElement;

  // Botones y panel móvil del atleta
  private btnOpenAthleteProfile: HTMLButtonElement | null = null;
  private btnOpenAthleteSheet: HTMLButtonElement | null = null;
  private headerAthleteAvatar: HTMLElement | null = null;
  private headerAthleteName: HTMLElement | null = null;

  private athleteProfileModal: HTMLElement | null = null;
  private athleteModalBackdrop: HTMLElement | null = null;
  private btnCloseAthleteModal: HTMLElement | null = null;
  private btnSaveAthleteProfile: HTMLButtonElement | null = null;
  private btnAddNewAthlete: HTMLButtonElement | null = null;
  private btnCancelAthleteForm: HTMLButtonElement | null = null;

  // Pestañas y vistas del panel del atleta
  private tabBtnBiopass: HTMLButtonElement | null = null;
  private tabBtnRoster: HTMLButtonElement | null = null;
  private tabBtnRanking: HTMLButtonElement | null = null;

  private athleteBiopassView: HTMLElement | null = null;
  private athleteRosterView: HTMLElement | null = null;
  private athleteRankingView: HTMLElement | null = null;
  private athleteFormView: HTMLElement | null = null;
  private athleteRosterList: HTMLElement | null = null;
  private athleteRankingList: HTMLElement | null = null;
  private athleteCountBadge: HTMLElement | null = null;

  private footerBiopass: HTMLElement | null = null;
  private footerRoster: HTMLElement | null = null;
  private footerForm: HTMLElement | null = null;
  private rosterFooterHint: HTMLElement | null = null;

  // Elementos de la Ficha Bio-Pass
  private biopassCodeBadge: HTMLElement | null = null;
  private biopassAvatar: HTMLElement | null = null;
  private biopassAvatarBadge: HTMLElement | null = null;
  private biopassRankTag: HTMLElement | null = null;
  private biopassName: HTMLElement | null = null;
  private biopassWeight: HTMLElement | null = null;
  private biopassHeight: HTMLElement | null = null;
  private biopassBmiTag: HTMLElement | null = null;
  private biopassStatusLabel: HTMLElement | null = null;
  private biopassScoreVal: HTMLElement | null = null;
  private biopassScoreStatus: HTMLElement | null = null;
  private biopassRecordVal: HTMLElement | null = null;
  private biopassRecordSub: HTMLElement | null = null;
  private biopassLastVal: HTMLElement | null = null;
  private biopassTotalJumps: HTMLElement | null = null;
  private biopassSparkline: HTMLElement | null = null;
  private biopassConsistencyBadge: HTMLElement | null = null;

  private btnBiopassShare: HTMLButtonElement | null = null;
  private btnBiopassEdit: HTMLButtonElement | null = null;
  private btnBiopassSwitchRoster: HTMLButtonElement | null = null;

  // Modal de Póster Nike
  private posterModal: HTMLElement | null = null;
  private posterModalBackdrop: HTMLElement | null = null;
  private btnClosePoster: HTMLElement | null = null;
  private btnDownloadPoster: HTMLButtonElement | null = null;
  private posterImgPreview: HTMLImageElement | null = null;
  private posterCanvas: HTMLCanvasElement | null = null;

  private formAvatarPreview: HTMLElement | null = null;
  private formHeaderNamePreview: HTMLElement | null = null;
  private athleteEditId: HTMLInputElement | null = null;

  private athleteNameInput: HTMLInputElement | null = null;
  private athleteWeightInput: HTMLInputElement | null = null;
  private athleteHeightModalInput: HTMLInputElement | null = null;
  private athleteWeightChips: HTMLButtonElement[] = [];
  private athleteHeightChips: HTMLButtonElement[] = [];

  // Roster local de atletas en memoria (sincronizado con MockAPI)
  private athleteRoster: RemoteAthlete[] = [];
  private activeAthleteId: string = '';
  private static readonly ACTIVE_KEY = 'youcanfly_active_athlete_id';
  private savedCallbacks: UIEventCallbacks | null = null;


  // Elementos de señal y toasts
  private signalBars: HTMLElement[];
  private signalLabel: HTMLElement | null;
  private toastContainer: HTMLElement;
  private confettiEffect: ConfettiEffect;
  private emptyState: HTMLElement | null;
  private athleteLevelBadge: HTMLElement | null;
  private levelProgressBar: HTMLElement | null;
  private levelProgressLabel: HTMLElement | null;

  // Cache de últimos valores para evitar escrituras redundantes al DOM (60fps)
  private lastLiveHeight: string = '';
  private lastMaxJump: string = '';
  private lastState: string = '';
  private lastBaselineStatus: string = '';
  private lastSignalLevel: number = -1;

  // Estado de notificación "Listo para saltar"
  private readyToastShown: boolean = false;
  private lastAvgVisibility: number = 0;

  constructor() {
    // Obtener referencias de elementos del DOM
    this.liveHeightVal = this.getElement("live-height-val");
    this.maxJumpVal = this.getElement("max-jump-val");
    this.jumpStateBadge = this.getElement("jump-state-badge");
    this.jumpStateText = this.getElement("jump-state-text");
    this.flightTimeText = document.getElementById("flight-time-text");
    this.displacementText = document.getElementById("displacement-text");
    this.baselineStatusText = document.getElementById("baseline-status-text");
    this.lastJumpTimeText = document.getElementById("last-jump-time");

    this.loadingOverlay = this.getElement("loading-overlay");
    this.loadingText = this.getElement("loading-text");

    this.btnUploadVideo = this.getElement("btn-upload-video") as HTMLButtonElement;
    this.btnUploadVideoText = this.getElement("btn-upload-video-text");
    this.videoFileInput = this.getElement("video-file-input") as HTMLInputElement;

    this.btnStartCamera = this.getElement("btn-start-camera") as HTMLButtonElement;
    this.btnStartCameraText = this.getElement("btn-start-camera-text");

    this.cameraToolbar = this.getElement("camera-toolbar");
    this.btnSwitchCamera = this.getElement("btn-switch-camera") as HTMLButtonElement;
    this.btnToggleMirror = this.getElement("btn-toggle-mirror") as HTMLButtonElement;
    this.btnStopCamera = this.getElement("btn-stop-camera") as HTMLButtonElement;

    this.btnResetRecord = this.getElement("btn-reset-record") as HTMLButtonElement;

    this.userHeightInput = document.getElementById("user-height-input") as HTMLInputElement | null;
    this.autoHeightBadge = document.getElementById("auto-height-badge");
    this.heightChips = Array.from(document.querySelectorAll<HTMLButtonElement>("#mobile-height-chips .chip-btn"));

    this.videoElement = this.getElement("video-player") as HTMLVideoElement;
    this.canvasElement = this.getElement("output-canvas") as HTMLCanvasElement;
    this.canvasWrapper = this.canvasElement?.closest('.canvas-wrapper') ?? null;

    // Indicador de calidad de señal
    this.signalBars = [
      document.getElementById("signal-bar-1"),
      document.getElementById("signal-bar-2"),
      document.getElementById("signal-bar-3")
    ].filter((el): el is HTMLElement => el !== null);
    this.signalLabel = document.getElementById("signal-label");
    this.toastContainer = this.getElement("toast-container");

    // Sincronizar salida de pantalla completa con tecla Esc en PC
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement && document.body.classList.contains("camera-fullscreen")) {
        document.body.classList.remove("camera-fullscreen");
      }
    });

    // Elementos de rutina en modal de pantalla completa
    this.resultsModal = this.getElement("results-modal");
    this.modalJumpVal = this.getElement("modal-jump-val");
    this.modalRoutineLevel = this.getElement("modal-routine-level");
    this.modalRoutineDesc = this.getElement("modal-routine-desc");
    this.modalRoutineExercises = this.getElement("modal-routine-exercises");
    this.btnCloseModal = this.getElement("btn-close-modal");
    this.btnModalDismiss = this.getElement("btn-modal-dismiss");
    this.btnShowRoutine = this.getElement("btn-show-routine") as HTMLButtonElement;



    // Configurar cierres nativos del modal
    const closeModal = () => {
      this.resultsModal.style.display = "none";
    };
    this.btnCloseModal.addEventListener("click", closeModal);
    this.btnModalDismiss.addEventListener("click", closeModal);

    const confettiCanvas = this.getElement("confetti-canvas") as HTMLCanvasElement;
    this.confettiEffect = new ConfettiEffect(confettiCanvas);

    // Modal de tips de grabación
    this.videoTipsModal = this.getElement("video-tips-modal");
    const closeTipsModal = () => { this.videoTipsModal.style.display = "none"; };
    const btnCloseTips = document.getElementById("btn-close-tips");
    const btnTipsCancel = document.getElementById("btn-tips-cancel");
    const btnTipsConfirm = document.getElementById("btn-tips-confirm");
    if (btnCloseTips)  btnCloseTips.addEventListener("click", closeTipsModal);
    if (btnTipsCancel) btnTipsCancel.addEventListener("click", closeTipsModal);
    // Al hacer clic en el backdrop también se cierra
    this.videoTipsModal.addEventListener("click", (e) => {
      if (e.target === this.videoTipsModal ||
          (e.target as HTMLElement).classList.contains("video-tips-backdrop")) {
        closeTipsModal();
      }
    });
    if (btnTipsConfirm) {
      btnTipsConfirm.addEventListener("click", () => {
        closeTipsModal();
        this.videoFileInput.value = "";
        this.videoFileInput.click();
      });
    }

    // Elementos opcionales (nuevas mejoras de diseño)
    this.emptyState = document.getElementById('empty-state');
    this.athleteLevelBadge = document.getElementById('athlete-level-badge');
    this.levelProgressBar = document.getElementById('level-progress-bar');
    this.levelProgressLabel = document.getElementById('level-progress-label');

    // Elementos del perfil de atleta (panel móvil y header)
    this.btnOpenAthleteProfile = document.getElementById("btn-open-athlete-profile") as HTMLButtonElement | null;
    this.btnOpenAthleteSheet = document.getElementById("btn-open-athlete-sheet") as HTMLButtonElement | null;
    this.headerAthleteAvatar = document.getElementById("header-athlete-avatar");
    this.headerAthleteName = document.getElementById("header-athlete-name");

    this.athleteProfileModal = document.getElementById("athlete-profile-modal");
    this.athleteModalBackdrop = document.getElementById("athlete-modal-backdrop");
    this.btnCloseAthleteModal = document.getElementById("btn-close-athlete-modal");
    this.btnSaveAthleteProfile = document.getElementById("btn-save-athlete-profile") as HTMLButtonElement | null;
    this.btnAddNewAthlete = document.getElementById("btn-add-new-athlete") as HTMLButtonElement | null;
    this.btnCancelAthleteForm = document.getElementById("btn-cancel-athlete-form") as HTMLButtonElement | null;

    this.tabBtnBiopass = document.getElementById("tab-btn-biopass") as HTMLButtonElement | null;
    this.tabBtnRoster = document.getElementById("tab-btn-roster") as HTMLButtonElement | null;
    this.tabBtnRanking = document.getElementById("tab-btn-ranking") as HTMLButtonElement | null;

    this.athleteBiopassView = document.getElementById("athlete-biopass-view");
    this.athleteRosterView = document.getElementById("athlete-roster-view");
    this.athleteRankingView = document.getElementById("athlete-ranking-view");
    this.athleteFormView = document.getElementById("athlete-form-view");
    this.athleteRosterList = document.getElementById("athlete-roster-list");
    this.athleteRankingList = document.getElementById("athlete-ranking-list");
    this.athleteCountBadge = document.getElementById("athlete-count-badge");

    this.footerBiopass = document.getElementById("athlete-modal-footer-biopass");
    this.footerRoster = document.getElementById("athlete-modal-footer-roster");
    this.footerForm = document.getElementById("athlete-modal-footer-form");
    this.rosterFooterHint = document.getElementById("roster-footer-hint");

    // Ficha Bio-Pass
    this.biopassCodeBadge = document.getElementById("biopass-code-badge");
    this.biopassAvatar = document.getElementById("biopass-avatar");
    this.biopassAvatarBadge = document.getElementById("biopass-avatar-badge");
    this.biopassRankTag = document.getElementById("biopass-rank-tag");
    this.biopassName = document.getElementById("biopass-name");
    this.biopassWeight = document.getElementById("biopass-weight");
    this.biopassHeight = document.getElementById("biopass-height");
    this.biopassBmiTag = document.getElementById("biopass-bmi-tag");
    this.biopassStatusLabel = document.getElementById("biopass-status-label");
    this.biopassScoreVal = document.getElementById("biopass-score-val");
    this.biopassScoreStatus = document.getElementById("biopass-score-status");
    this.biopassRecordVal = document.getElementById("biopass-record-val");
    this.biopassRecordSub = document.getElementById("biopass-record-sub");
    this.biopassLastVal = document.getElementById("biopass-last-val");
    this.biopassTotalJumps = document.getElementById("biopass-total-jumps");
    this.biopassSparkline = document.getElementById("biopass-sparkline");
    this.biopassConsistencyBadge = document.getElementById("biopass-consistency-badge");

    this.btnBiopassShare = document.getElementById("btn-biopass-share") as HTMLButtonElement | null;
    this.btnBiopassEdit = document.getElementById("btn-biopass-edit") as HTMLButtonElement | null;
    this.btnBiopassSwitchRoster = document.getElementById("btn-biopass-switch-roster") as HTMLButtonElement | null;

    // Modal de Póster Nike
    this.posterModal = document.getElementById("poster-modal");
    this.posterModalBackdrop = document.getElementById("poster-modal-backdrop");
    this.btnClosePoster = document.getElementById("btn-close-poster");
    this.btnDownloadPoster = document.getElementById("btn-download-poster") as HTMLButtonElement | null;
    this.posterImgPreview = document.getElementById("poster-img-preview") as HTMLImageElement | null;
    this.posterCanvas = document.getElementById("poster-render-canvas") as HTMLCanvasElement | null;

    this.formAvatarPreview = document.getElementById("form-avatar-preview");
    this.formHeaderNamePreview = document.getElementById("form-header-name-preview");
    this.athleteEditId = document.getElementById("athlete-edit-id") as HTMLInputElement | null;

    this.athleteNameInput = document.getElementById("athlete-name-input") as HTMLInputElement | null;
    this.athleteWeightInput = document.getElementById("athlete-weight-input") as HTMLInputElement | null;
    this.athleteHeightModalInput = document.getElementById("athlete-height-modal-input") as HTMLInputElement | null;
    this.athleteWeightChips = Array.from(document.querySelectorAll<HTMLButtonElement>("#athlete-weight-chips .chip-btn"));
    this.athleteHeightChips = Array.from(document.querySelectorAll<HTMLButtonElement>("#athlete-height-chips .chip-btn"));

    // Cargar roster desde localStorage
    this.loadRosterFromStorage();
  }

  private getElement(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) {
      throw new Error(`Elemento no encontrado en el DOM: #${id}`);
    }
    return el;
  }

  public getVideoElement(): HTMLVideoElement {
    return this.videoElement;
  }

  public getCanvasElement(): HTMLCanvasElement {
    return this.canvasElement;
  }

  public setInitialValues(userHeightCm: number): void {
    if (this.userHeightInput) {
      this.userHeightInput.value = String(userHeightCm);
    }
    this.highlightActiveChip(userHeightCm);
  }

  /**
   * Actualiza el valor de estatura en la interfaz (ej. cuando la IA la estima automáticamente o se cambia por chip)
   */
  public updateUserHeightInput(heightCm: number, isAutoEstimated: boolean = true): void {
    if (this.userHeightInput) {
      this.userHeightInput.value = String(heightCm);
    }
    this.highlightActiveChip(heightCm);
    this.setAutoHeightBadgeVisible(isAutoEstimated);
  }

  /**
   * Resalta el chip de estatura correspondiente al valor actual
   */
  public highlightActiveChip(heightCm: number): void {
    this.heightChips.forEach((chip) => {
      const h = parseFloat(chip.getAttribute("data-height") ?? "0");
      if (Math.abs(h - heightCm) <= 4) {
        chip.classList.add("active");
      } else {
        chip.classList.remove("active");
      }
    });
  }

  /**
   * Muestra u oculta el badge indicador "Estimado por IA"
   */
  public setAutoHeightBadgeVisible(visible: boolean): void {
    if (this.autoHeightBadge) {
      this.autoHeightBadge.style.display = visible ? "inline-block" : "none";
    }
  }

  /**
   * Vincula los controladores de eventos de usuario a los callbacks.
   */
  public bindEvents(callbacks: UIEventCallbacks): void {
    // Botón de iniciar/detener cámara en vivo
    this.btnStartCamera.addEventListener("click", () => {
      if (callbacks.onStartCamera) {
        callbacks.onStartCamera();
      }
    });

    // Botones de la barra flotante de cámara
    this.btnSwitchCamera.addEventListener("click", () => {
      if (callbacks.onSwitchCamera) {
        callbacks.onSwitchCamera();
      }
    });

    this.btnToggleMirror.addEventListener("click", () => {
      if (callbacks.onToggleMirror) {
        callbacks.onToggleMirror();
      }
    });

    this.btnStopCamera.addEventListener("click", () => {
      if (callbacks.onStopCamera) {
        callbacks.onStopCamera();
      }
    });

    // Botón de subir video -> muestra modal de tips primero
    this.btnUploadVideo.addEventListener("click", () => {
      this.videoTipsModal.style.display = "flex";
    });

    this.videoFileInput.addEventListener("change", () => {
      const files = this.videoFileInput.files;
      if (files && files.length > 0) {
        callbacks.onSelectVideoFile(files[0]);
      }
    });

    this.btnResetRecord.addEventListener("click", () => callbacks.onResetRecord());

    // Eventos para chips táctiles de estatura (1-Tap para móvil) si existen
    this.heightChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        const val = parseFloat(chip.getAttribute("data-height") ?? "172");
        if (this.userHeightInput) {
          this.userHeightInput.value = String(val);
        }
        this.highlightActiveChip(val);
        this.setAutoHeightBadgeVisible(false); // Selección manual desactiva badge de IA
        callbacks.onChangeUserHeight(val);
      });
    });

    if (this.userHeightInput) {
      this.userHeightInput.addEventListener("change", () => {
        const val = parseFloat(this.userHeightInput!.value);
        if (!isNaN(val) && val >= 120 && val <= 230) {
          this.highlightActiveChip(val);
          this.setAutoHeightBadgeVisible(false); // Ajuste manual desactiva badge de IA
          callbacks.onChangeUserHeight(val);
        }
      });
    }

    this.btnShowRoutine.addEventListener("click", () => {
      if (callbacks.onShowRoutine) {
        callbacks.onShowRoutine();
      }
    });

    // ── Bindings para el Panel Móvil de Atleta y Ficha Bio-Pass ──
    this.savedCallbacks = callbacks;

    if (this.tabBtnBiopass) {
      this.tabBtnBiopass.addEventListener("click", () => this.switchAthleteTab('biopass'));
    }
    if (this.tabBtnRoster) {
      this.tabBtnRoster.addEventListener("click", () => this.switchAthleteTab('roster'));
    }
    if (this.tabBtnRanking) {
      this.tabBtnRanking.addEventListener("click", () => this.switchAthleteTab('ranking'));
    }

    // Acciones directas dentro de la Ficha Bio-Pass
    if (this.btnBiopassShare) {
      this.btnBiopassShare.addEventListener("click", () => this.openPosterModal());
    }
    if (this.btnBiopassEdit) {
      this.btnBiopassEdit.addEventListener("click", () => {
        const active = this.athleteRoster.find(a => a.id === this.activeAthleteId) ?? (this.athleteRoster[0] ?? null);
        this.showAthleteForm(active);
      });
    }
    if (this.btnBiopassSwitchRoster) {
      this.btnBiopassSwitchRoster.addEventListener("click", () => this.switchAthleteTab('roster'));
    }

    // Acciones del modal Póster Nike
    if (this.btnClosePoster) {
      this.btnClosePoster.addEventListener("click", () => this.closePosterModal());
    }
    if (this.posterModalBackdrop) {
      this.posterModalBackdrop.addEventListener("click", () => this.closePosterModal());
    }
    if (this.btnDownloadPoster) {
      this.btnDownloadPoster.addEventListener("click", () => this.downloadPoster());
    }

    const openAthleteModalHandler = () => {
      this.openAthleteModal();
    };

    if (this.btnOpenAthleteProfile) {
      this.btnOpenAthleteProfile.addEventListener("click", openAthleteModalHandler);
    }

    if (this.btnOpenAthleteSheet) {
      this.btnOpenAthleteSheet.addEventListener("click", openAthleteModalHandler);
    }

    const closeAthleteModalHandler = () => {
      this.closeAthleteModal();
    };

    if (this.btnCloseAthleteModal) {
      this.btnCloseAthleteModal.addEventListener("click", closeAthleteModalHandler);
    }

    if (this.athleteModalBackdrop) {
      this.athleteModalBackdrop.addEventListener("click", closeAthleteModalHandler);
    }

    // Botón: agregar nuevo atleta → mostrar formulario vacío
    if (this.btnAddNewAthlete) {
      this.btnAddNewAthlete.addEventListener("click", () => {
        this.showAthleteForm(null);
      });
    }

    // Botón: cancelar formulario → volver a la ficha o lista
    if (this.btnCancelAthleteForm) {
      this.btnCancelAthleteForm.addEventListener("click", () => {
        if (this.athleteRoster.length > 0) {
          this.switchAthleteTab('biopass');
        } else {
          this.switchAthleteTab('roster');
        }
      });
    }

    // Chips táctiles de peso (1-tap móvil)
    this.athleteWeightChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        const w = parseFloat(chip.getAttribute("data-weight") ?? "70");
        if (this.athleteWeightInput) {
          this.athleteWeightInput.value = String(w);
        }
        this.highlightActiveWeightChip(w);
        this.updateFormAvatarPreview();
      });
    });

    // Chips táctiles de estatura en el modal (1-tap móvil)
    this.athleteHeightChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        const h = parseFloat(chip.getAttribute("data-height") ?? "172");
        if (this.athleteHeightModalInput) {
          this.athleteHeightModalInput.value = String(h);
        }
        this.highlightActiveHeightModalChip(h);
      });
    });

    // Input nombre: actualiza preview en vivo
    if (this.athleteNameInput) {
      this.athleteNameInput.addEventListener("input", () => {
        this.updateFormAvatarPreview();
      });
    }

    // Guardar atleta (crear o editar)
    if (this.btnSaveAthleteProfile) {
      this.btnSaveAthleteProfile.addEventListener("click", () => {
        const name = this.athleteNameInput ? (this.athleteNameInput.value.trim() || "Atleta") : "Atleta";
        const weightKg = this.athleteWeightInput ? (parseFloat(this.athleteWeightInput.value) || 70) : 70;
        const heightCm = this.athleteHeightModalInput ? (parseFloat(this.athleteHeightModalInput.value) || 172) : 172;
        const editId = this.athleteEditId ? this.athleteEditId.value : "";

        if (editId) {
          // Editar existente en la API
          this.showToast("💾 Guardando...", 'info');
          AthleteService.update(editId, { name, weightKg, heightCm })
            .then(updated => {
              const idx = this.athleteRoster.findIndex(a => a.id === editId);
              if (idx >= 0) this.athleteRoster[idx] = updated;
              this.applyActiveAthlete(callbacks);
              this.renderRosterList(callbacks);
              this.switchAthleteTab('biopass');
              this.showToast("✅ Ficha actualizada", 'success');
            })
            .catch(() => this.showToast("❌ Error al guardar. Revisa tu conexión.", 'warning'));
        } else {
          // Crear nuevo en la API
          this.showToast("💾 Guardando...", 'info');
          AthleteService.create({ name, weightKg, heightCm })
            .then(created => {
              this.athleteRoster.push(created);
              this.activeAthleteId = created.id;
              this.saveActiveId();
              this.applyActiveAthlete(callbacks);
              this.renderRosterList(callbacks);
              this.switchAthleteTab('biopass');
              this.showToast("✅ Ficha Bio-Pass creada", 'success');
            })
            .catch(() => this.showToast("❌ Error al guardar. Revisa tu conexión.", 'warning'));
        }
      });
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  ROSTER: persistencia (MockAPI + localStorage para activeId)
  // ─────────────────────────────────────────────────────────────

  /** Solo carga el id activo desde localStorage (sin datos de atletas) */
  private loadRosterFromStorage(): void {
    this.activeAthleteId = localStorage.getItem(UIView.ACTIVE_KEY) ?? '';
  }

  /** Guarda solo el ID del atleta activo en localStorage */
  private saveActiveId(): void {
    localStorage.setItem(UIView.ACTIVE_KEY, this.activeAthleteId);
  }

  // ─────────────────────────────────────────────────────────────
  //  STATS POR ATLETA (Persistencia local por ID)
  // ─────────────────────────────────────────────────────────────
  public static getAthleteStats(athleteId: string): AthleteStats {
    try {
      const raw = localStorage.getItem(`youcanfly_stats_${athleteId}`);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { recordCm: 0, lastJumpCm: 0, totalJumps: 0 };
  }

  public static saveAthleteStats(athleteId: string, stats: AthleteStats): void {
    try {
      localStorage.setItem(`youcanfly_stats_${athleteId}`, JSON.stringify(stats));
    } catch (_) {}
  }

  public static getLevelInfo(jumpHeightCm: number): { label: string; class: string } {
    if (jumpHeightCm >= 60) return { label: 'Élite', class: 'elite' };
    if (jumpHeightCm >= 45) return { label: 'Avanzado', class: 'advanced' };
    if (jumpHeightCm >= 30) return { label: 'Intermedio', class: 'intermediate' };
    return { label: 'Principiante', class: 'beginner' };
  }

  public getActiveAthleteId(): string {
    return this.activeAthleteId;
  }

  /**
   * Registra el resultado del salto en el perfil del atleta activo
   */
  public recordJumpForActiveAthlete(jumpCm: number): void {
    if (!this.activeAthleteId) return;
    const stats = UIView.getAthleteStats(this.activeAthleteId);
    stats.lastJumpCm = jumpCm;
    if (jumpCm > stats.recordCm) {
      stats.recordCm = jumpCm;
    }
    stats.totalJumps = (stats.totalJumps || 0) + 1;
    stats.lastJumpDate = new Date().toLocaleDateString();
    if (!stats.jumpHistory) stats.jumpHistory = [];
    stats.jumpHistory.push(jumpCm);
    if (stats.jumpHistory.length > 10) stats.jumpHistory.shift();
    UIView.saveAthleteStats(this.activeAthleteId, stats);

    // Actualizar visualizaciones si hay callbacks guardados
    if (this.savedCallbacks) {
      this.renderRosterList(this.savedCallbacks);
      this.renderRankingList(this.savedCallbacks);
    }
    this.renderBiopass();
  }

  /**
   * Actualiza el valor del récord en la pantalla principal
   */
  public updateMaxJumpDisplay(maxJumpCm: number): void {
    const maxStr = maxJumpCm.toFixed(1);
    this.maxJumpVal.textContent = maxStr;
    this.lastMaxJump = maxStr;
    this.updateLevelBadgeAndProgress(maxJumpCm);
  }

  // ─────────────────────────────────────────────────────────────
  //  ROSTER: renderizado de lista
  // ─────────────────────────────────────────────────────────────
  private renderRosterList(callbacks: Parameters<UIView['bindEvents']>[0]): void {
    if (!this.athleteRosterList) return;
    this.athleteRosterList.innerHTML = '';

    if (this.athleteCountBadge) {
      this.athleteCountBadge.textContent = String(this.athleteRoster.length);
    }

    if (this.athleteRoster.length === 0) {
      this.athleteRosterList.innerHTML = `
        <div style="text-align:center;padding:24px 0;color:var(--text-muted);font-size:0.82rem;">
          No hay atletas registrados. Agrega el primero con el botón abajo 👇
        </div>`;
      return;
    }

    this.athleteRoster.forEach((athlete) => {
      const isActive = athlete.id === this.activeAthleteId;
      const initials = this.getInitials(athlete.name);
      const stats = UIView.getAthleteStats(athlete.id);
      const levelInfo = UIView.getLevelInfo(stats.recordCm);

      const card = document.createElement('div');
      card.className = `athlete-roster-card${isActive ? ' roster-active' : ''}`;
      card.dataset.athleteId = athlete.id;
      card.innerHTML = `
        <div class="roster-card-avatar">${initials}</div>
        <div class="roster-card-info">
          <div class="roster-card-name-row">
            <span class="roster-card-name">${athlete.name}</span>
            ${stats.recordCm > 0 ? `<span class="roster-card-badge ${levelInfo.class}">${levelInfo.label}</span>` : ''}
          </div>
          <span class="roster-card-meta">${athlete.weightKg} kg · ${athlete.heightCm} cm</span>
          <div class="roster-card-stats-row">
            ${stats.recordCm > 0
              ? `<span class="roster-stat-pill record">🏆 Récord: ${stats.recordCm.toFixed(1)} cm</span>
                 <span class="roster-stat-pill last">⚡ Último: ${stats.lastJumpCm.toFixed(1)} cm</span>`
              : `<span class="roster-stat-pill empty">Sin saltos aún (0.0 cm)</span>`
            }
          </div>
        </div>
        <span class="roster-card-active-badge">Activo</span>
        <div class="roster-card-actions">
          <button class="roster-action-btn roster-view-biopass" title="Ver Ficha Bio-Pass" aria-label="Ver Ficha Bio-Pass">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2.5"/><line x1="15" y1="8" x2="19" y2="8"/><line x1="15" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button class="roster-action-btn roster-edit" title="Editar" aria-label="Editar atleta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="roster-action-btn roster-delete" title="Eliminar" aria-label="Eliminar atleta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>`;

      // Tap en la tarjeta = activar atleta y ver su ficha
      card.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.roster-action-btn')) return;
        this.activeAthleteId = athlete.id;
        this.saveActiveId();
        this.applyActiveAthlete(callbacks);
        this.renderRosterList(callbacks);
        this.renderRankingList(callbacks);
        this.showToast(`✅ ${athlete.name} activado`, 'success');
        this.switchAthleteTab('biopass');
      });

      // Botón ver ficha
      card.querySelector('.roster-view-biopass')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activeAthleteId = athlete.id;
        this.saveActiveId();
        this.applyActiveAthlete(callbacks);
        this.renderRosterList(callbacks);
        this.renderRankingList(callbacks);
        this.switchAthleteTab('biopass');
      });

      // Botón editar
      card.querySelector('.roster-edit')!.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showAthleteForm(athlete);
      });

      // Botón eliminar
      card.querySelector('.roster-delete')!.addEventListener('click', (e) => {
        e.stopPropagation();
        AthleteService.delete(athlete.id)
          .then(() => {
            this.athleteRoster = this.athleteRoster.filter(a => a.id !== athlete.id);
            if (this.activeAthleteId === athlete.id) {
              this.activeAthleteId = this.athleteRoster[0]?.id ?? '';
              this.saveActiveId();
              this.applyActiveAthlete(callbacks);
            }
            this.renderRosterList(callbacks);
            this.renderRankingList(callbacks);
            this.showToast(`🗑️ Atleta eliminado`, 'info');
          })
          .catch(() => this.showToast('❌ Error al eliminar. Revisa tu conexión.', 'warning'));
      });

      this.athleteRosterList!.appendChild(card);
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  ROSTER: renderizado de Tabla de Resultados / Ránking
  // ─────────────────────────────────────────────────────────────
  private renderRankingList(callbacks: Parameters<UIView['bindEvents']>[0]): void {
    if (!this.athleteRankingList) return;
    this.athleteRankingList.innerHTML = '';

    if (this.athleteRoster.length === 0) {
      this.athleteRankingList.innerHTML = `
        <div style="text-align:center;padding:24px 0;color:var(--text-muted);font-size:0.82rem;">
          No hay atletas registrados todavía.
        </div>`;
      return;
    }

    // Ordenar atletas por mejor salto (de mayor a menor)
    const sorted = [...this.athleteRoster].map(athlete => {
      const stats = UIView.getAthleteStats(athlete.id);
      const watts = stats.recordCm > 0
        ? Math.max(0, Math.round(60.7 * stats.recordCm + 45.3 * athlete.weightKg - 2055))
        : 0;
      return { athlete, stats, watts };
    }).sort((a, b) => b.stats.recordCm - a.stats.recordCm);

    sorted.forEach((item, index) => {
      const pos = index + 1;
      let posEmoji = `#${pos}`;
      let rankClass = '';
      if (pos === 1 && item.stats.recordCm > 0) { posEmoji = '🥇'; rankClass = 'rank-1'; }
      else if (pos === 2 && item.stats.recordCm > 0) { posEmoji = '🥈'; rankClass = 'rank-2'; }
      else if (pos === 3 && item.stats.recordCm > 0) { posEmoji = '🥉'; rankClass = 'rank-3'; }

      const isActive = item.athlete.id === this.activeAthleteId;
      const initials = this.getInitials(item.athlete.name);
      const levelInfo = UIView.getLevelInfo(item.stats.recordCm);

      const card = document.createElement('div');
      card.className = `ranking-card ${rankClass}`;
      card.innerHTML = `
        <div class="ranking-pos">${posEmoji}</div>
        <div class="ranking-avatar">${initials}</div>
        <div class="ranking-info">
          <span class="ranking-name">${item.athlete.name}</span>
          <div class="ranking-meta">
            <span>${item.athlete.weightKg} kg · ${item.athlete.heightCm} cm</span>
            <span>•</span>
            <span class="roster-card-badge ${levelInfo.class}">${levelInfo.label}</span>
          </div>
        </div>
        <div class="ranking-score-group">
          <div>
            <span class="ranking-jump-val">${item.stats.recordCm > 0 ? item.stats.recordCm.toFixed(1) : '0.0'}</span>
            <span class="ranking-jump-unit">cm</span>
          </div>
          ${item.watts > 0 ? `<span class="ranking-watts">⚡ ${item.watts} W</span>` : ''}
        </div>
        <button type="button" class="btn-activate-ranking ${isActive ? 'active-btn' : ''}">
          ${isActive ? 'Activo' : 'Elegir'}
        </button>
      `;

      card.addEventListener('click', () => {
        if (this.activeAthleteId !== item.athlete.id) {
          this.activeAthleteId = item.athlete.id;
          this.saveActiveId();
          this.applyActiveAthlete(callbacks);
          this.renderRosterList(callbacks);
          this.renderRankingList(callbacks);
          this.showToast(`✅ ${item.athlete.name} seleccionado`, 'success');
        }
        this.switchAthleteTab('biopass');
      });

      this.athleteRankingList!.appendChild(card);
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  ROSTER: cambio entre pestañas (Ficha vs Atletas vs Ránking)
  // ─────────────────────────────────────────────────────────────
  private switchAthleteTab(tab: 'biopass' | 'roster' | 'ranking'): void {
    if (tab === 'biopass') {
      if (this.tabBtnBiopass) this.tabBtnBiopass.classList.add('active');
      if (this.tabBtnRoster) this.tabBtnRoster.classList.remove('active');
      if (this.tabBtnRanking) this.tabBtnRanking.classList.remove('active');
      if (this.athleteBiopassView) this.athleteBiopassView.style.display = '';
      if (this.athleteRosterView) this.athleteRosterView.style.display = 'none';
      if (this.athleteRankingView) this.athleteRankingView.style.display = 'none';
      if (this.athleteFormView) this.athleteFormView.style.display = 'none';
      if (this.footerBiopass) this.footerBiopass.style.display = '';
      if (this.footerRoster) this.footerRoster.style.display = 'none';
      if (this.footerForm) this.footerForm.style.display = 'none';
      this.renderBiopass();
    } else if (tab === 'roster') {
      if (this.tabBtnBiopass) this.tabBtnBiopass.classList.remove('active');
      if (this.tabBtnRoster) this.tabBtnRoster.classList.add('active');
      if (this.tabBtnRanking) this.tabBtnRanking.classList.remove('active');
      if (this.athleteBiopassView) this.athleteBiopassView.style.display = 'none';
      if (this.athleteRosterView) this.athleteRosterView.style.display = '';
      if (this.athleteRankingView) this.athleteRankingView.style.display = 'none';
      if (this.athleteFormView) this.athleteFormView.style.display = 'none';
      if (this.footerBiopass) this.footerBiopass.style.display = 'none';
      if (this.footerRoster) this.footerRoster.style.display = '';
      if (this.footerForm) this.footerForm.style.display = 'none';
      if (this.rosterFooterHint) this.rosterFooterHint.textContent = 'Toca un atleta para ver su ficha y activarlo';
      if (this.savedCallbacks) this.renderRosterList(this.savedCallbacks);
    } else {
      if (this.tabBtnBiopass) this.tabBtnBiopass.classList.remove('active');
      if (this.tabBtnRoster) this.tabBtnRoster.classList.remove('active');
      if (this.tabBtnRanking) this.tabBtnRanking.classList.add('active');
      if (this.athleteBiopassView) this.athleteBiopassView.style.display = 'none';
      if (this.athleteRosterView) this.athleteRosterView.style.display = 'none';
      if (this.athleteRankingView) this.athleteRankingView.style.display = '';
      if (this.athleteFormView) this.athleteFormView.style.display = 'none';
      if (this.footerBiopass) this.footerBiopass.style.display = 'none';
      if (this.footerRoster) this.footerRoster.style.display = '';
      if (this.footerForm) this.footerForm.style.display = 'none';
      if (this.rosterFooterHint) this.rosterFooterHint.textContent = 'Toca un atleta para ver su ficha y activarlo';
      if (this.savedCallbacks) this.renderRankingList(this.savedCallbacks);
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  ROSTER: navegación entre vistas (lista ↔ formulario)
  // ─────────────────────────────────────────────────────────────
  private showAthleteRoster(): void {
    this.switchAthleteTab('roster');
  }

  private showAthleteForm(athlete: { id: string; name: string; weightKg: number; heightCm: number } | null): void {
    if (this.athleteBiopassView) this.athleteBiopassView.style.display = 'none';
    if (this.athleteRosterView) this.athleteRosterView.style.display = 'none';
    if (this.athleteRankingView) this.athleteRankingView.style.display = 'none';
    if (this.athleteFormView) this.athleteFormView.style.display = '';
    if (this.footerBiopass) this.footerBiopass.style.display = 'none';
    if (this.footerRoster) this.footerRoster.style.display = 'none';
    if (this.footerForm) this.footerForm.style.display = '';

    if (this.tabBtnBiopass) this.tabBtnBiopass.classList.remove('active');
    if (this.tabBtnRoster) this.tabBtnRoster.classList.remove('active');
    if (this.tabBtnRanking) this.tabBtnRanking.classList.remove('active');

    // Pre-poblar formulario
    if (this.athleteEditId) this.athleteEditId.value = athlete ? athlete.id : '';
    if (this.athleteNameInput) this.athleteNameInput.value = athlete ? athlete.name : '';
    if (this.athleteWeightInput) this.athleteWeightInput.value = athlete ? String(athlete.weightKg) : '';
    if (this.athleteHeightModalInput) this.athleteHeightModalInput.value = athlete ? String(athlete.heightCm) : '';

    if (athlete) {
      this.highlightActiveWeightChip(athlete.weightKg);
      this.highlightActiveHeightModalChip(athlete.heightCm);
    } else {
      this.athleteWeightChips.forEach(c => c.classList.remove('active'));
      this.athleteHeightChips.forEach(c => c.classList.remove('active'));
    }

    this.updateFormAvatarPreview();
  }

  // ─────────────────────────────────────────────────────────────
  //  ROSTER: aplicar atleta activo al header y al modelo
  // ─────────────────────────────────────────────────────────────
  private applyActiveAthlete(callbacks: Parameters<UIView['bindEvents']>[0]): void {
    const active = this.athleteRoster.find(a => a.id === this.activeAthleteId);
    if (!active) {
      if (this.headerAthleteName) this.headerAthleteName.textContent = 'Atleta';
      if (this.headerAthleteAvatar) this.headerAthleteAvatar.textContent = 'AT';
      return;
    }
    this.updateAthleteHeader(active.name);
    if (callbacks.onSaveAthleteProfile) {
      callbacks.onSaveAthleteProfile({ name: active.name, weightKg: active.weightKg, heightCm: active.heightCm });
    }
    if (callbacks.onChangeUserHeight) {
      callbacks.onChangeUserHeight(active.heightCm);
    }

    // Sincronizar estadísticas del atleta activo con la pantalla y el modelo
    const stats = UIView.getAthleteStats(active.id);
    if (callbacks.onSelectAthleteRecord) {
      callbacks.onSelectAthleteRecord(stats.recordCm);
    }
    this.updateMaxJumpDisplay(stats.recordCm);
    if (stats.lastJumpCm > 0 && this.lastJumpTimeText) {
      this.lastJumpTimeText.textContent = `Último salto: ${stats.lastJumpCm.toFixed(1)} cm`;
    }
    this.renderBiopass();
  }

  // ─────────────────────────────────────────────────────────────
  //  HELPERS
  // ─────────────────────────────────────────────────────────────
  private updateFormAvatarPreview(): void {
    const name = this.athleteNameInput ? this.athleteNameInput.value.trim() : '';
    const initials = name ? this.getInitials(name) : 'AT';
    if (this.formAvatarPreview) this.formAvatarPreview.textContent = initials;
    if (this.formHeaderNamePreview) {
      if (name) {
        this.formHeaderNamePreview.textContent = name;
        this.formHeaderNamePreview.classList.remove('is-placeholder');
      } else {
        this.formHeaderNamePreview.textContent = 'Escribe el nombre abajo...';
        this.formHeaderNamePreview.classList.add('is-placeholder');
      }
    }
  }

  /**
   * Obtiene las iniciales de 2 letras para el avatar circular
   */
  public getInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "AT";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  /**
   * Actualiza el avatar e indicador del atleta en el header principal
   */
  public updateAthleteHeader(name: string): void {
    const initials = this.getInitials(name);
    if (this.headerAthleteAvatar) {
      this.headerAthleteAvatar.textContent = initials;
    }
    if (this.headerAthleteName) {
      this.headerAthleteName.textContent = name;
    }
  }

  /**
   * Abre el panel de móvil del atleta
   */
  public openAthleteModal(): void {
    if (!this.athleteProfileModal) return;
    this.athleteProfileModal.style.display = "flex";
    this.athleteProfileModal.setAttribute("aria-hidden", "false");

    if (this.savedCallbacks) {
      this.renderRosterList(this.savedCallbacks);
      this.renderRankingList(this.savedCallbacks);
    }

    if (this.athleteRoster.length > 0) {
      this.switchAthleteTab('biopass');
    } else {
      this.switchAthleteTab('roster');
    }

    const active = this.athleteRoster.find(a => a.id === this.activeAthleteId);
    if (active) this.updateAthleteHeader(active.name);
  }

  /**
   * Cierra el panel de móvil del atleta
   */
  public closeAthleteModal(): void {
    if (!this.athleteProfileModal) return;
    this.athleteProfileModal.style.display = "none";
    this.athleteProfileModal.setAttribute("aria-hidden", "true");
  }

  /**
   * Renderiza todos los datos holográficos y telemetría de la Ficha Bio-Pass
   */
  public renderBiopass(): void {
    if (!this.athleteBiopassView) return;

    let athlete = this.athleteRoster.find(a => a.id === this.activeAthleteId);
    if (!athlete && this.athleteRoster.length > 0) {
      athlete = this.athleteRoster[0];
      this.activeAthleteId = athlete.id;
      this.saveActiveId();
    }

    if (!athlete) {
      if (this.biopassName) this.biopassName.textContent = "Sin atleta";
      if (this.biopassAvatar) this.biopassAvatar.textContent = "AT";
      if (this.biopassWeight) this.biopassWeight.textContent = "--";
      if (this.biopassHeight) this.biopassHeight.textContent = "--";
      if (this.biopassBmiTag) this.biopassBmiTag.textContent = "BMI --";
      if (this.biopassRecordVal) this.biopassRecordVal.textContent = "0.0";
      if (this.biopassLastVal) this.biopassLastVal.textContent = "0.0";
      if (this.biopassScoreVal) this.biopassScoreVal.textContent = "--";
      if (this.biopassSparkline) {
        this.biopassSparkline.innerHTML = '<div class="telemetry-empty-hint">Agrega un atleta para ver su telemetría</div>';
      }
      return;
    }

    const initials = this.getInitials(athlete.name);
    const stats = UIView.getAthleteStats(athlete.id);
    const weightKg = athlete.weightKg;
    const heightCm = athlete.heightCm;
    const heightM = heightCm / 100;
    const bmi = heightM > 0 ? (weightKg / (heightM * heightM)).toFixed(1) : "--";

    // Flight Score (0 a 99)
    let score = 0;
    let scoreLabel = "EVALUACIÓN NIKE";
    if (stats.recordCm > 0) {
      const heightPart = Math.min(80, (stats.recordCm / 75) * 80);
      const jumpsPart = Math.min(19, (stats.totalJumps || 1) * 2);
      score = Math.round(Math.min(99, heightPart + jumpsPart));

      if (score >= 90) scoreLabel = "ÉLITE AIR JORDAN 👑";
      else if (score >= 75) scoreLabel = "ALTO RENDIMIENTO ⚡";
      else if (score >= 60) scoreLabel = "NIVEL PRO 🎯";
      else scoreLabel = "PROSPECTO EN ALZA 🚀";
    }

    // Nivel & Rank
    const levelInfo = UIView.getLevelInfo(stats.recordCm);
    let rankTagText = "RANK: ROOKIE // PRINCIPIANTE";
    let rankClass = "rank-beginner";
    let avatarBadgeText = "🌱";

    if (levelInfo.class === 'elite') {
      rankTagText = "RANK: SKYWALKER // ÉLITE";
      rankClass = "rank-elite";
      avatarBadgeText = "👑";
    } else if (levelInfo.class === 'advanced') {
      rankTagText = "RANK: PRO // AVANZADO";
      rankClass = "rank-advanced";
      avatarBadgeText = "⚡";
    } else if (levelInfo.class === 'intermediate') {
      rankTagText = "RANK: RISING // INTERMEDIO";
      rankClass = "rank-intermediate";
      avatarBadgeText = "🔥";
    }

    // Actualizar elementos DOM de la Ficha
    if (this.biopassCodeBadge) {
      const codeId = athlete.id.slice(-4).toUpperCase();
      this.biopassCodeBadge.textContent = `#AT-${codeId} // ACTIVO`;
    }
    if (this.biopassAvatar) this.biopassAvatar.textContent = initials;
    if (this.biopassAvatarBadge) this.biopassAvatarBadge.textContent = avatarBadgeText;
    if (this.biopassRankTag) {
      this.biopassRankTag.textContent = rankTagText;
      this.biopassRankTag.className = `biopass-rank-tag ${rankClass}`;
    }
    if (this.biopassName) this.biopassName.textContent = athlete.name;
    if (this.biopassWeight) this.biopassWeight.textContent = String(weightKg);
    if (this.biopassHeight) this.biopassHeight.textContent = String(heightCm);
    if (this.biopassBmiTag) this.biopassBmiTag.textContent = `BMI ${bmi}`;

    if (this.biopassScoreVal) this.biopassScoreVal.textContent = score > 0 ? String(score) : "--";
    if (this.biopassScoreStatus) this.biopassScoreStatus.textContent = scoreLabel;

    if (this.biopassRecordVal) this.biopassRecordVal.textContent = stats.recordCm > 0 ? stats.recordCm.toFixed(1) : "0.0";
    if (this.biopassRecordSub) {
      this.biopassRecordSub.textContent = stats.recordCm > 0 ? "Marca personal histórica" : "Sin récord registrado";
    }

    if (this.biopassLastVal) this.biopassLastVal.textContent = stats.lastJumpCm > 0 ? stats.lastJumpCm.toFixed(1) : "0.0";
    if (this.biopassTotalJumps) {
      this.biopassTotalJumps.textContent = `Total: ${stats.totalJumps || 0} saltos`;
    }

    // Sparkline de saltos recientes
    if (this.biopassSparkline) {
      const history = (stats.jumpHistory && stats.jumpHistory.length > 0)
        ? stats.jumpHistory
        : (stats.recordCm > 0 ? [stats.recordCm] : []);

      if (history.length === 0) {
        this.biopassSparkline.innerHTML = `<div class="telemetry-empty-hint">Aún no hay saltos grabados en esta sesión</div>`;
      } else {
        const recent = history.slice(-7);
        const maxVal = Math.max(...recent, 1);
        const peakVal = Math.max(...recent);
        this.biopassSparkline.innerHTML = "";

        recent.forEach((val, idx) => {
          const isPeak = val === peakVal;
          const col = document.createElement("div");
          col.className = `telemetry-bar-col${isPeak ? " is-peak" : ""}`;
          const heightPct = Math.max(14, Math.round((val / maxVal) * 100));

          col.innerHTML = `
            <span class="telemetry-bar-val">${val.toFixed(1)}</span>
            <div class="telemetry-bar-fill" style="height: ${heightPct}%;"></div>
            <span class="telemetry-bar-idx">#${idx + 1}</span>
          `;
          this.biopassSparkline!.appendChild(col);
        });
      }
    }
  }

  /**
   * Abre el modal del póster y genera la imagen HD
   */
  public openPosterModal(): void {
    if (!this.posterModal) return;

    let athlete = this.athleteRoster.find(a => a.id === this.activeAthleteId);
    if (!athlete && this.athleteRoster.length > 0) {
      athlete = this.athleteRoster[0];
    }
    if (!athlete) {
      this.showToast("⚠️ Primero registra un atleta para generar su póster", 'warning');
      return;
    }

    const stats = UIView.getAthleteStats(athlete.id);
    this.renderNikePoster(athlete, stats);
    this.posterModal.style.display = "flex";
    this.posterModal.setAttribute("aria-hidden", "false");
  }

  /**
   * Cierra el modal del póster
   */
  public closePosterModal(): void {
    if (!this.posterModal) return;
    this.posterModal.style.display = "none";
    this.posterModal.setAttribute("aria-hidden", "true");
  }

  /**
   * Renderiza el póster Nike / Cyberpunk de alta definición en el canvas
   */
  public renderNikePoster(athlete: RemoteAthlete, stats: AthleteStats): void {
    const canvas = (this.posterCanvas ?? document.getElementById("poster-render-canvas")) as HTMLCanvasElement | null;
    if (!canvas) return;

    const W = 1080;
    const H = 1350;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const drawRoundRect = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    };

    const initials = this.getInitials(athlete.name);
    const weightKg = athlete.weightKg;
    const heightCm = athlete.heightCm;
    const heightM = heightCm / 100;
    const bmi = heightM > 0 ? (weightKg / (heightM * heightM)).toFixed(1) : "--";
    const levelInfo = UIView.getLevelInfo(stats.recordCm);

    let score = 0;
    let scoreLabel = "PROSPECTO";
    if (stats.recordCm > 0) {
      const heightPart = Math.min(80, (stats.recordCm / 75) * 80);
      const jumpsPart = Math.min(19, (stats.totalJumps || 1) * 2);
      score = Math.round(Math.min(99, heightPart + jumpsPart));
      if (score >= 90) scoreLabel = "ÉLITE AIR JORDAN";
      else if (score >= 75) scoreLabel = "ALTO RENDIMIENTO";
      else if (score >= 60) scoreLabel = "NIVEL PRO";
      else scoreLabel = "PROSPECTO EN ALZA";
    }

    // 1. Fondo degradado Cyber / Nike
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, "#050811");
    bgGrad.addColorStop(0.35, "#0B152B");
    bgGrad.addColorStop(0.7, "#080F1F");
    bgGrad.addColorStop(1, "#03060C");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Resplandor radial cian arriba
    const cyanGlow = ctx.createRadialGradient(240, 180, 20, 240, 180, 420);
    cyanGlow.addColorStop(0, "rgba(0, 242, 254, 0.22)");
    cyanGlow.addColorStop(1, "rgba(0, 242, 254, 0)");
    ctx.fillStyle = cyanGlow;
    ctx.fillRect(0, 0, W, H);

    // Resplandor radial volt en el centro-derecha
    const voltGlow = ctx.createRadialGradient(880, 680, 30, 880, 680, 480);
    voltGlow.addColorStop(0, "rgba(206, 255, 0, 0.16)");
    voltGlow.addColorStop(1, "rgba(206, 255, 0, 0)");
    ctx.fillStyle = voltGlow;
    ctx.fillRect(0, 0, W, H);

    // Cuadrícula cyberpunk sutil
    ctx.strokeStyle = "rgba(0, 242, 254, 0.04)";
    ctx.lineWidth = 1;
    for (let x = 60; x < W; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 60; y < H; y += 60) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Marca de agua Jumpman en el fondo si está disponible
    const logoImg = document.querySelector<HTMLImageElement>(".logo-img") ?? document.querySelector<HTMLImageElement>(".biopass-watermark-img");
    if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.drawImage(logoImg, W - 480, 280, 440, 440);
      ctx.restore();
    }

    // Marco exterior con esquinas tecnológicas
    const m = 44;
    ctx.strokeStyle = "rgba(0, 242, 254, 0.28)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(m, m, W - m * 2, H - m * 2);

    // Esquinas neón volt
    const cLen = 42;
    ctx.strokeStyle = "#CEFF00";
    ctx.lineWidth = 4;
    // Top-left
    ctx.beginPath(); ctx.moveTo(m - 2, m + cLen); ctx.lineTo(m - 2, m - 2); ctx.lineTo(m + cLen, m - 2); ctx.stroke();
    // Top-right
    ctx.beginPath(); ctx.moveTo(W - m - cLen, m - 2); ctx.lineTo(W - m + 2, m - 2); ctx.lineTo(W - m + 2, m + cLen); ctx.stroke();
    // Bottom-left
    ctx.beginPath(); ctx.moveTo(m - 2, H - m - cLen); ctx.lineTo(m - 2, H - m + 2); ctx.lineTo(m + cLen, H - m + 2); ctx.stroke();
    // Bottom-right
    ctx.beginPath(); ctx.moveTo(W - m - cLen, H - m + 2); ctx.lineTo(W - m + 2, H - m + 2); ctx.lineTo(W - m + 2, H - m - cLen); ctx.stroke();

    // Franja neón superior
    const barGrad = ctx.createLinearGradient(m, m, W - m, m);
    barGrad.addColorStop(0, "#00F2FE");
    barGrad.addColorStop(0.5, "#CEFF00");
    barGrad.addColorStop(1, "#8B5CF6");
    ctx.fillStyle = barGrad;
    ctx.fillRect(m, m, W - m * 2, 6);

    // Encabezado marca
    ctx.font = "900 24px 'Montserrat', sans-serif";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText("YOU CAN FLY", 84, 114);

    ctx.font = "700 14px 'Space Grotesk', monospace";
    ctx.fillStyle = "#00F2FE";
    ctx.fillText("// FLIGHT LAB  •  BIO-PASS REPORT", 84, 140);

    // Badge código atleta (top right)
    ctx.fillStyle = "rgba(0, 242, 254, 0.12)";
    ctx.fillRect(W - 270, 88, 186, 36);
    ctx.strokeStyle = "rgba(0, 242, 254, 0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(W - 270, 88, 186, 36);
    ctx.font = "700 14px 'Space Grotesk', monospace";
    ctx.fillStyle = "#00F2FE";
    ctx.textAlign = "center";
    ctx.fillText(`#AT-${athlete.id.slice(-4).toUpperCase()} // VERIFIED`, W - 177, 112);
    ctx.textAlign = "left";

    // Separador sutil
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.beginPath();
    ctx.moveTo(84, 175);
    ctx.lineTo(W - 84, 175);
    ctx.stroke();

    // Avatar circular del atleta
    const avX = 140;
    const avY = 250;
    const avR = 48;
    const avGrad = ctx.createLinearGradient(avX - avR, avY - avR, avX + avR, avY + avR);
    avGrad.addColorStop(0, "#00F2FE");
    avGrad.addColorStop(0.5, "#4FACFE");
    avGrad.addColorStop(1, "#8B5CF6");
    ctx.beginPath();
    ctx.arc(avX, avY, avR, 0, Math.PI * 2);
    ctx.fillStyle = avGrad;
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.font = "900 36px 'Space Grotesk', monospace";
    ctx.fillStyle = "#070B14";
    ctx.textAlign = "center";
    ctx.fillText(initials, avX, avY + 13);
    ctx.textAlign = "left";

    // Nombre del Atleta
    ctx.font = "900 48px 'Montserrat', sans-serif";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(athlete.name, 215, 242);

    // Tag de Nivel / Rank
    ctx.font = "800 16px 'Space Grotesk', monospace";
    ctx.fillStyle = levelInfo.class === 'elite' ? "#CEFF00" : (levelInfo.class === 'advanced' ? "#FFD700" : "#00F2FE");
    ctx.fillText(`★ RANK: ${levelInfo.label.toUpperCase()} // ${scoreLabel}`, 215, 274);

    // Pills métricas (peso, estatura, BMI)
    ctx.font = "600 18px 'Space Grotesk', monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
    ctx.fillText(`${weightKg} KG   •   ${heightCm} CM   •   BMI ${bmi}`, 215, 304);

    // CAJA HERO CENTRAL: RÉCORD MÁXIMO
    const boxY = 345;
    const boxH = 340;
    ctx.fillStyle = "rgba(10, 18, 38, 0.75)";
    drawRoundRect(84, boxY, W - 168, boxH, 20);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 215, 0, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = "800 18px 'Space Grotesk', monospace";
    ctx.fillStyle = "#FFD700";
    ctx.fillText("🏆 RÉCORD DE ELEVACIÓN VERTICAL (PEAK)", 118, boxY + 48);

    // Gran número de salto
    ctx.font = "900 136px 'Space Grotesk', monospace";
    ctx.fillStyle = "#FFD700";
    const jumpStr = stats.recordCm > 0 ? stats.recordCm.toFixed(1) : "0.0";
    ctx.fillText(jumpStr, 116, boxY + 188);

    const jumpWidth = ctx.measureText(jumpStr).width;
    ctx.font = "800 44px 'Space Grotesk', monospace";
    ctx.fillStyle = "rgba(255, 215, 0, 0.85)";
    ctx.fillText("CM", 126 + jumpWidth, boxY + 188);

    // Frase / barra de progreso
    ctx.font = "600 17px 'Space Grotesk', monospace";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(`Telemetría cinemática de salto con contramovimiento (CMJ)`, 118, boxY + 242);
    ctx.font = "500 15px 'Space Grotesk', monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.fillText(`Calibración por visión por computadora y fijado automático de suelo`, 118, boxY + 274);

    // Barra de energía neón horizontal
    const pBarW = W - 236;
    const pBarY = boxY + 300;
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    ctx.fillRect(118, pBarY, pBarW, 8);
    const progressFill = Math.min(pBarW, Math.round((stats.recordCm / 75) * pBarW));
    const fillGrad = ctx.createLinearGradient(118, pBarY, 118 + progressFill, pBarY);
    fillGrad.addColorStop(0, "#00F2FE");
    fillGrad.addColorStop(0.5, "#CEFF00");
    fillGrad.addColorStop(1, "#FFD700");
    ctx.fillStyle = fillGrad;
    ctx.fillRect(118, pBarY, Math.max(12, progressFill), 8);

    // 3 CAJAS INFERIORES DE TELEMETRÍA (GRID)
    const cardY = 720;
    const cardW = (W - 168 - 36) / 3;
    const cardH = 220;

    // Caja 1: Último Salto
    const lastJumpStr = stats.lastJumpCm > 0 ? stats.lastJumpCm.toFixed(1) : "0.0";
    ctx.fillStyle = "rgba(10, 18, 38, 0.65)";
    drawRoundRect(84, cardY, cardW, cardH, 16); ctx.fill();
    ctx.strokeStyle = "rgba(0, 242, 254, 0.28)"; ctx.stroke();
    ctx.font = "700 14px 'Space Grotesk', monospace"; ctx.fillStyle = "#00F2FE";
    ctx.fillText("🎯 ÚLTIMO SALTO", 104, cardY + 38);
    ctx.font = "900 44px 'Space Grotesk', monospace"; ctx.fillStyle = "#00F2FE";
    ctx.fillText(lastJumpStr, 104, cardY + 98);
    ctx.font = "700 18px 'Space Grotesk', monospace"; ctx.fillStyle = "rgba(0, 242, 254, 0.7)";
    ctx.fillText("CM", 104 + ctx.measureText(lastJumpStr).width + 8, cardY + 98);
    ctx.font = "600 14px 'Space Grotesk', monospace"; ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fillText("Sesión activa", 104, cardY + 138);
    ctx.fillText("Telemetría en vivo", 104, cardY + 164);

    // Caja 2: Flight Score
    const c2X = 84 + cardW + 18;
    ctx.fillStyle = "rgba(10, 18, 38, 0.65)";
    drawRoundRect(c2X, cardY, cardW, cardH, 16); ctx.fill();
    ctx.strokeStyle = "rgba(139, 92, 246, 0.35)"; ctx.stroke();
    ctx.font = "700 14px 'Space Grotesk', monospace"; ctx.fillStyle = "#A78BFA";
    ctx.fillText("🏆 FLIGHT SCORE", c2X + 20, cardY + 38);
    ctx.font = "900 44px 'Space Grotesk', monospace"; ctx.fillStyle = "#CEFF00";
    const scoreStr = score > 0 ? `${score}` : "--";
    ctx.fillText(scoreStr, c2X + 20, cardY + 98);
    ctx.font = "700 18px 'Space Grotesk', monospace"; ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.fillText("/100", c2X + 20 + ctx.measureText(scoreStr).width + 6, cardY + 98);
    ctx.font = "600 13px 'Space Grotesk', monospace"; ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fillText(scoreLabel, c2X + 20, cardY + 138);
    ctx.fillText("Índice de elevación", c2X + 20, cardY + 164);

    // Caja 3: Total Saltos
    const c3X = c2X + cardW + 18;
    const jumpsStr = `${stats.totalJumps || 0}`;
    ctx.fillStyle = "rgba(10, 18, 38, 0.65)";
    drawRoundRect(c3X, cardY, cardW, cardH, 16); ctx.fill();
    ctx.strokeStyle = "rgba(255, 215, 0, 0.28)"; ctx.stroke();
    ctx.font = "700 14px 'Space Grotesk', monospace"; ctx.fillStyle = "#FFD700";
    ctx.fillText("📊 TOTAL SALTOS", c3X + 20, cardY + 38);
    ctx.font = "900 44px 'Space Grotesk', monospace"; ctx.fillStyle = "#FFD700";
    ctx.fillText(jumpsStr, c3X + 20, cardY + 98);
    ctx.font = "700 18px 'Space Grotesk', monospace"; ctx.fillStyle = "rgba(255, 215, 0, 0.7)";
    ctx.fillText("SALTOS", c3X + 20 + ctx.measureText(jumpsStr).width + 8, cardY + 98);
    ctx.font = "600 13px 'Space Grotesk', monospace"; ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fillText("Historial acumulado", c3X + 20, cardY + 138);
    ctx.fillText("Volumen de saltos", c3X + 20, cardY + 164);

    // SECCIÓN DE TELEMETRÍA INFERIOR / CÓDIGO DE BARRAS
    const footerY = 980;
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    drawRoundRect(84, footerY, W - 168, 140, 16);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.stroke();

    // Dibujar falso código de barras elegante
    const bcX = 114;
    const bcY = footerY + 22;
    const bcH = 50;
    let currX = bcX;
    const barWidths = [3, 1, 4, 2, 1, 5, 2, 4, 1, 3, 2, 6, 1, 3, 2, 4, 1, 5, 2, 3, 4, 1, 2, 5, 3, 1, 4, 2];
    ctx.fillStyle = "rgba(0, 242, 254, 0.8)";
    barWidths.forEach((bw, i) => {
      ctx.fillRect(currX, bcY, bw, bcH);
      currX += bw + (i % 2 === 0 ? 3 : 2);
    });

    ctx.font = "700 11px 'Space Grotesk', monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.fillText(`ID-HASH: ${athlete.id}-${Date.now().toString(36).toUpperCase()}`, bcX, bcY + 66);

    // Meta datos fecha y certificación
    ctx.font = "700 14px 'Space Grotesk', monospace";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(`CERTIFICACIÓN YOU CAN FLY FLIGHT LAB`, 390, footerY + 44);
    ctx.font = "500 13px 'Space Grotesk', monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fillText(`Fecha de Registro: ${stats.lastJumpDate || new Date().toLocaleDateString()}`, 390, footerY + 68);
    ctx.fillText(`Cinemática de Pose mediante IA en dispositivo local`, 390, footerY + 90);

    // PIE DE PÓSTER
    ctx.font = "700 13px 'Space Grotesk', monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.textAlign = "center";
    ctx.fillText("POWERED BY YOU CAN FLY AI  •  DESIGNED FOR JESICA DE SÃO JOÃO", W / 2, 1260);
    ctx.textAlign = "left";

    // Pasar resultado a imagen de previsualización
    if (this.posterImgPreview) {
      this.posterImgPreview.src = canvas.toDataURL("image/png");
    }
  }

  /**
   * Descarga la imagen HD del póster
   */
  public downloadPoster(): void {
    const canvas = (this.posterCanvas ?? document.getElementById("poster-render-canvas")) as HTMLCanvasElement | null;
    if (!canvas) return;

    let athlete = this.athleteRoster.find(a => a.id === this.activeAthleteId);
    const athleteName = athlete ? athlete.name.toLowerCase().replace(/[^a-z0-9]/gi, "-") : "atleta";
    const filename = `you-can-fly-${athleteName}-record.png`;

    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
    this.showToast("📸 Póster descargado con éxito", 'success');
  }

  /** @deprecated No se usa con el nuevo sistema roster */
  public updateAthleteDisplay(_profile: { name: string; weightKg: number; heightCm: number }, _maxJumpCm: number): void {
    // Mantenido por compatibilidad con JumpController (será ignorado)
  }

  /**
   * Resalta el chip de peso activo en el modal
   */
  public highlightActiveWeightChip(weightKg: number): void {
    this.athleteWeightChips.forEach((chip) => {
      const w = parseFloat(chip.getAttribute("data-weight") ?? "0");
      if (Math.abs(w - weightKg) <= 3) {
        chip.classList.add("active");
      } else {
        chip.classList.remove("active");
      }
    });
  }

  /**
   * Resalta el chip de estatura activo en el modal
   */
  public highlightActiveHeightModalChip(heightCm: number): void {
    this.athleteHeightChips.forEach((chip) => {
      const h = parseFloat(chip.getAttribute("data-height") ?? "0");
      if (Math.abs(h - heightCm) <= 3) {
        chip.classList.add("active");
      } else {
        chip.classList.remove("active");
      }
    });
  }

  /** Inicializa el roster cargando los atletas desde MockAPI al arrancar la app */
  public initAthleteHeaderFromRoster(callbacks: Parameters<UIView['bindEvents']>[0]): void {
    this.savedCallbacks = callbacks;

    // Cargar atletas desde la API en segundo plano
    if (this.athleteRosterList) {
      this.athleteRosterList.innerHTML = `
        <div style="text-align:center;padding:24px 0;color:var(--text-muted);font-size:0.82rem;">
          ⏳ Cargando atletas...
        </div>`;
    }

    AthleteService.getAll()
      .then(athletes => {
        this.athleteRoster = athletes;

        if (this.athleteCountBadge) {
          this.athleteCountBadge.textContent = String(athletes.length);
        }

        // Si el ID activo ya no existe en la lista, tomar el primero
        if (this.activeAthleteId && !athletes.find(a => a.id === this.activeAthleteId)) {
          this.activeAthleteId = athletes[0]?.id ?? '';
          this.saveActiveId();
        }

        const active = athletes.find(a => a.id === this.activeAthleteId) ?? athletes[0];
        if (active) {
          this.activeAthleteId = active.id;
          this.saveActiveId();
          this.updateAthleteHeader(active.name);
          if (callbacks.onSaveAthleteProfile) {
            callbacks.onSaveAthleteProfile({ name: active.name, weightKg: active.weightKg, heightCm: active.heightCm });
          }
          if (callbacks.onChangeUserHeight) {
            callbacks.onChangeUserHeight(active.heightCm);
          }

          // Sincronizar estadísticas del atleta inicial
          const stats = UIView.getAthleteStats(active.id);
          if (callbacks.onSelectAthleteRecord) {
            callbacks.onSelectAthleteRecord(stats.recordCm);
          }
          this.updateMaxJumpDisplay(stats.recordCm);
          if (stats.lastJumpCm > 0 && this.lastJumpTimeText) {
            this.lastJumpTimeText.textContent = `Último salto: ${stats.lastJumpCm.toFixed(1)} cm`;
          }
        }

        this.renderRosterList(callbacks);
        this.renderRankingList(callbacks);
        this.renderBiopass();
      })
      .catch(() => {
        // Fallo silencioso al arrancar — el usuario verá el error si abre el panel
        console.warn('[UIView] No se pudo cargar el roster desde MockAPI. Modo offline.');
      });
  }


  public updateLoadingState(isLoading: boolean, message: string = ""): void {
    if (isLoading) {
      this.loadingOverlay.style.opacity = "1";
      this.loadingOverlay.style.pointerEvents = "all";
      if (message) {
        // Separar mensaje principal y subtítulo con '|'
        const parts = message.split('|');
        const main = parts[0].trim();
        const sub  = parts[1] ? parts[1].trim() : '';
        this.loadingText.innerHTML = sub
          ? `${main}<br><span class="loading-sub">${sub}</span>`
          : main;
      }
    } else {
      this.loadingOverlay.style.opacity = "0";
      this.loadingOverlay.style.pointerEvents = "none";
    }
  }

  /**
   * Actualiza las lecturas de salto en la interfaz
   */
  public updateMetrics(
    currentJumpCm: number,
    maxJumpCm: number,
    state: JumpState,
    isBaselineLocked: boolean,
    flightTimeMs: number,
    displacementCm: number = 0,
    avgVisibility: number = 0
  ): void {
    // 1. Altura en tiempo real (solo actualizar si cambia)
    const liveStr = currentJumpCm.toFixed(1);
    if (liveStr !== this.lastLiveHeight) {
      this.liveHeightVal.textContent = liveStr;
      this.lastLiveHeight = liveStr;
    }

    // 2. Récord máximo (solo actualizar si cambia)
    const maxStr = maxJumpCm.toFixed(1);
    if (maxStr !== this.lastMaxJump) {
      this.maxJumpVal.textContent = maxStr;
      this.lastMaxJump = maxStr;
    }

    // 3. Insignia de estado (solo actualizar si cambia)
    if (state !== this.lastState) {
      this.updateStateBadge(state);
      this.lastState = state;
    }

    // 4. Tiempo de vuelo actual
    if (flightTimeMs > 0) {
      if (this.flightTimeText) {
        this.flightTimeText.textContent = `${(flightTimeMs / 1000).toFixed(2)} s`;
      }
      if (this.lastJumpTimeText) {
        this.lastJumpTimeText.textContent = `Último vuelo: ${(flightTimeMs / 1000).toFixed(2)}s`;
      }
    }

    // 5. Desplazamiento
    if (displacementCm > 0 && this.displacementText) {
      this.displacementText.textContent = `${displacementCm.toFixed(1)} cm`;
    }

    // 6. Estado Baseline Suelo
    const baselineStatusStr = isBaselineLocked ? '🔒 Fijado' : '⏳ Calibrando';
    if (baselineStatusStr !== this.lastBaselineStatus) {
      if (this.baselineStatusText) {
        this.baselineStatusText.textContent = baselineStatusStr;
        this.baselineStatusText.className = isBaselineLocked ? 'status-locked' : 'status-calibrating';
      }
      this.lastBaselineStatus = baselineStatusStr;
    }

    // 7. Indicador de calidad de señal
    this.updateSignalQuality(avgVisibility, state);

    // 8. Toast "Listo para saltar" cuando la señal pasa de mala a buena por primera vez
    if (!this.readyToastShown && this.lastAvgVisibility < 0.5 && avgVisibility >= 0.7) {
      this.showToast("🎯 ¡Listo para saltar!", 'success', 3000);
      this.readyToastShown = true;
    }
    // Resetear si la señal cae por debajo de 0.4 para permitir re-notificación
    if (avgVisibility < 0.4) {
      this.readyToastShown = false;
    }

    this.lastAvgVisibility = avgVisibility;
  }

  /**
   * Actualiza el indicador visual de calidad de señal de pose.
   * Niveles: 0 = Mala (<0.4), 1 = Regular (0.4-0.7), 2 = Buena (>0.7)
   */
  public updateSignalQuality(avgVisibility: number, _state: JumpState = 'IDLE'): void {
    let level: number;
    let label: string;
    let colorClass: string;

    if (avgVisibility >= 0.7) {
      level = 3; // Buena
      label = "Buena";
      colorClass = "signal-good";
    } else if (avgVisibility >= 0.4) {
      level = 2; // Regular
      label = "Regular";
      colorClass = "signal-medium";
    } else {
      level = 1; // Mala
      label = "Mala";
      colorClass = "signal-bad";
    }

    // Solo actualizar DOM si el nivel cambió
    if (level !== this.lastSignalLevel) {
      this.lastSignalLevel = level;

      // Actualizar barras
      this.signalBars.forEach((bar, idx) => {
        bar.className = "signal-bar";
        if (idx < level) {
          bar.classList.add(colorClass, "signal-bar-active");
        }
      });

      // Actualizar etiqueta
      if (this.signalLabel) {
        this.signalLabel.textContent = label;
        this.signalLabel.className = "signal-text " + colorClass;
      }
    }
  }

  /**
   * Dispara una animación visual de celebración cuando el usuario bate su récord personal.
   */
  public triggerRecordCelebration(peakCm: number): void {
    const recordCard = this.maxJumpVal.closest('.card');
    if (recordCard) {
      recordCard.classList.remove('record-celebration');
      // Forzar reflow para reiniciar la animación si se bate récord varias veces
      void (recordCard as HTMLElement).offsetHeight;
      recordCard.classList.add('record-celebration');

      setTimeout(() => {
        recordCard.classList.remove('record-celebration');
      }, 3500);
    }

    this.maxJumpVal.classList.remove('celebrate-text');
    void this.maxJumpVal.offsetHeight;
    this.maxJumpVal.classList.add('celebrate-text');
    setTimeout(() => {
      this.maxJumpVal.classList.remove('celebrate-text');
    }, 1500);

    this.showToast(`🏆 ¡NUEVO RÉCORD! ${peakCm.toFixed(1)} cm`, 'success', 4000);
    this.confettiEffect.start();
  }

  /**
   * Muestra un toast flotante con mensaje y tipo.
   * Máximo 3 toasts simultáneos (el más antiguo se descarta si se supera el límite).
   */
  public showToast(message: string, type: 'success' | 'warning' | 'info', durationMs: number = 3000): void {
    // Limitar a 3 toasts simultáneos
    const existingToasts = this.toastContainer.querySelectorAll('.toast');
    if (existingToasts.length >= 3) {
      existingToasts[0].remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    this.toastContainer.appendChild(toast);

    // Forzar reflow para que la animación de entrada funcione
    void toast.offsetHeight;
    toast.classList.add('toast-visible');

    // Auto-eliminar tras la duración
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      toast.classList.add('toast-hiding');
      setTimeout(() => toast.remove(), 400);
    }, durationMs);
  }

  /**
   * Cambia el diseño visual de la insignia de estado del salto
   */
  private updateStateBadge(state: JumpState): void {
    this.jumpStateBadge.className = "state-indicator";

    switch (state) {
      case "IDLE":
        this.jumpStateBadge.classList.add("state-idle");
        this.jumpStateText.textContent = "Reposo / En suelo";
        break;
      case "PREPARING":
        this.jumpStateBadge.classList.add("state-preparing");
        this.jumpStateText.textContent = "Flexionando / Preparando";
        break;
      case "IN_AIR":
        this.jumpStateBadge.classList.add("state-in-air");
        this.jumpStateText.textContent = "¡EN EL AIRE!";
        break;
      case "LANDED":
        this.jumpStateBadge.classList.add("state-landed");
        this.jumpStateText.textContent = "¡Aterrizaje Registrado!";
        break;
    }
  }

  /**
   * Activa el modo pantalla completa para la cámara en tiempo real
   */
  public enterCameraFullscreen(): void {
    document.body.classList.add("camera-fullscreen");
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } catch {
      // Ignorar si el navegador no permite Fullscreen API
    }
  }

  /**
   * Sale del modo pantalla completa de la cámara
   */
  public exitCameraFullscreen(): void {
    document.body.classList.remove("camera-fullscreen");
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    } catch {
      // Ignorar
    }
  }

  /**
   * Actualiza la interfaz según la fuente activa (Cámara vs Video vs Inactivo)
   */
  public setSourceState(mode: 'camera' | 'video' | 'none', label?: string): void {
    // Resetear el toast de "Listo" al cambiar fuente
    this.readyToastShown = false;
    this.lastAvgVisibility = 0;
    this.lastSignalLevel = -1;

    if (mode === 'camera') {
      this.enterCameraFullscreen();
      if (this.emptyState) this.emptyState.style.display = 'none';
      this.cameraToolbar.style.display = "flex";
      this.canvasWrapper?.classList.add('has-video');

      this.btnStartCameraText.textContent = "Detener Cámara";
      this.btnStartCamera.classList.add("camera-active");

      this.btnUploadVideoText.textContent = "Subir Video";
      this.btnResetRecord.disabled = false;
    } else if (mode === 'video') {
      this.exitCameraFullscreen();
      if (this.emptyState) this.emptyState.style.display = 'none';
      this.cameraToolbar.style.display = "none";
      this.canvasWrapper?.classList.add('has-video');

      this.btnStartCameraText.textContent = "Medir con Cámara";
      this.btnStartCamera.classList.remove("camera-active");

      this.btnUploadVideoText.textContent = label ? `Video: ${label.substring(0, 10)}...` : "Cambiar Video";
      this.btnResetRecord.disabled = false;
    } else {
      this.exitCameraFullscreen();
      if (this.emptyState) this.emptyState.style.display = '';
      this.cameraToolbar.style.display = "none";
      this.canvasWrapper?.classList.remove('has-video');

      this.btnStartCameraText.textContent = "Medir con Cámara";
      this.btnStartCamera.classList.remove("camera-active");

      this.btnUploadVideoText.textContent = "Subir Video";
      this.btnResetRecord.disabled = true;

      // Resetear indicador de señal
      this.signalBars.forEach(bar => { bar.className = "signal-bar"; });
      if (this.signalLabel) {
        this.signalLabel.textContent = "—";
      }
    }
  }

  /**
   * Activa o desactiva el modo espejo en la vista
   */
  public setMirrorMode(isMirrored: boolean): void {
    if (this.canvasWrapper) {
      if (isMirrored) {
        this.canvasWrapper.classList.add('mirror-mode');
      } else {
        this.canvasWrapper.classList.remove('mirror-mode');
      }
    }
    if (this.btnToggleMirror) {
      if (isMirrored) {
        this.btnToggleMirror.classList.add('active');
      } else {
        this.btnToggleMirror.classList.remove('active');
      }
    }
  }

  /**
   * Actualiza y muestra la recomendación de rutina de entrenamiento en un modal full-screen sin comparar saltos.
   */
  public updateRoutineAndProgress(currentJump: number): void {
    // Mostrar modal
    this.resultsModal.style.display = "flex";

    // Contador animado: sube de 0 al valor real en ~800ms
    const targetVal = currentJump;
    const duration = 900;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Easing out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      this.modalJumpVal.textContent = (targetVal * eased).toFixed(1);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);

    // Actualizar badge de nivel dinámico en la tarjeta de Récord
    this.updateLevelBadgeAndProgress(currentJump);

    // 2. Generar rutina basada en el nivel del salto actual
    let title = "";
    let levelClass = "";
    let exercises: string[] = [];

    if (currentJump < 30) {
      title = "Principiante (Fuerza Base)";
      levelClass = "routine-level-badge beginner";
      exercises = [
        "Sentadillas con salto explosivo - 3 series x 8 repeticiones",
        "Saltos de tobillo rápidos (rebotes continuos) - 3 series x 15 segundos",
        "Puentes de glúteo a una pierna - 3 series x 10 repeticiones por pierna",
        "Saltos a cajón bajo - 3 series x 6 repeticiones (foco en caída suave)"
      ];
    } else if (currentJump >= 30 && currentJump <= 45) {
      title = "Intermedio (Fuerza Explosiva)";
      levelClass = "routine-level-badge intermediate";
      exercises = [
        "Saltos desde caída (dejarse caer desde 30cm y saltar inmediatamente hacia arriba) - 3 series x 5 repeticiones",
        "Saltos horizontales explosivos continuos - 3 series x 6 repeticiones",
        "Saltos agrupados con rodillas al pecho - 3 series x 8 repeticiones",
        "Zancadas alternas explosivas con salto - 3 series x 10 repeticiones"
      ];
    } else if (currentJump > 45 && currentJump <= 65) {
      title = "Avanzado (Reactividad Pliométrica)";
      levelClass = "routine-level-badge advanced";
      exercises = [
        "Saltos desde caída alta (desde 45cm) con salto vertical máximo reactivo - 4 series x 4 repeticiones",
        "Saltos verticales a una pierna (foco en altura máxima) - 3 series x 5 repeticiones por pierna",
        "Saltos con contramovimiento resistidos (usando banda elástica o peso ligero) - 4 series x 5 repeticiones",
        "Saltos de tobillo reactivos rápidos sobre mini vallas - 3 series x 20 segundos"
      ];
    } else {
      title = "Élite (Pliometría Extrema y Potencia)";
      levelClass = "routine-level-badge elite";
      exercises = [
        "Saltos desde caída extrema (desde 60cm) con rebote vertical instantáneo - 4 series x 3 repeticiones",
        "Saltos verticales a una pierna asistidos (con banda para mayor aceleración) - 3 series x 6 repeticiones",
        "Saltos con contramovimiento cargados (mancuerna o barra ligera) - 4 series x 4 repeticiones",
        "Saltos de tobillo reactivos sobre obstáculos altos a un pie - 3 series x 15 segundos"
      ];
    }

    this.modalRoutineDesc.textContent = `A continuación, te sugerimos esta rutina personalizada para tu nivel de potencia:`;
    this.modalRoutineLevel.textContent = title;
    this.modalRoutineLevel.className = levelClass;
    
    this.modalRoutineExercises.innerHTML = "";
    exercises.forEach(ex => {
      const li = document.createElement("li");
      li.textContent = ex;
      this.modalRoutineExercises.appendChild(li);
    });
  }

  /**
   * Actualiza el badge de nivel del atleta y la barra de progreso al siguiente nivel.
   */
  private updateLevelBadgeAndProgress(jumpCm: number): void {
    if (!this.athleteLevelBadge || !this.levelProgressBar || !this.levelProgressLabel) return;

    const levels = [
      { label: 'Principiante', cls: 'beginner',     min: 0,  max: 30  },
      { label: 'Intermedio',   cls: 'intermediate', min: 30, max: 45  },
      { label: 'Avanzado',     cls: 'advanced',     min: 45, max: 65  },
      { label: 'Élite',        cls: 'elite',        min: 65, max: 100 },
    ];

    const currentLevel = levels.find((l, i) =>
      jumpCm < l.max || i === levels.length - 1
    )!;

    // Badge
    this.athleteLevelBadge.textContent = currentLevel.label;
    this.athleteLevelBadge.className = `athlete-level-badge ${currentLevel.cls}`;

    // Progress bar
    const progress = Math.min(
      ((jumpCm - currentLevel.min) / (currentLevel.max - currentLevel.min)) * 100,
      100
    );
    this.levelProgressBar.style.width = `${progress.toFixed(0)}%`;

    if (currentLevel.cls === 'elite') {
      this.levelProgressLabel.textContent = `¡Nivel élite alcanzado! 👑`;
    } else {
      const nextLevel = levels[levels.indexOf(currentLevel) + 1];
      const remaining = (currentLevel.max - jumpCm).toFixed(1);
      this.levelProgressLabel.textContent = `${remaining} cm para ${nextLevel.label}`;
    }
  }
}

class ConfettiEffect {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles: Array<{
    x: number;
    y: number;
    size: number;
    color: string;
    speedX: number;
    speedY: number;
    rotation: number;
    rotationSpeed: number;
  }> = [];
  private active: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  public start() {
    this.canvas.style.display = "block";
    this.active = true;
    this.particles = [];
    const colors = ["#ff007f", "#00f2fe", "#4facfe", "#f9d423", "#ff4e50", "#f9d423", "#70e1f5"];
    
    for (let i = 0; i < 150; i++) {
      const fromLeft = Math.random() > 0.5;
      this.particles.push({
        x: fromLeft ? 0 : this.canvas.width,
        y: this.canvas.height * 0.8,
        size: Math.random() * 8 + 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        speedX: (fromLeft ? 1 : -1) * (Math.random() * 15 + 10),
        speedY: -(Math.random() * 20 + 15),
        rotation: Math.random() * 360,
        rotationSpeed: Math.random() * 10 - 5
      });
    }

    this.animate();
    setTimeout(() => {
      this.active = false;
      this.canvas.style.display = "none";
    }, 4000);
  }

  private animate() {
    if (!this.active) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    let activeParticles = 0;

    this.particles.forEach((p) => {
      this.ctx.save();
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate((p.rotation * Math.PI) / 180);
      this.ctx.fillStyle = p.color;
      this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      this.ctx.restore();

      p.x += p.speedX;
      p.y += p.speedY;
      p.speedY += 0.5;
      p.speedX *= 0.98;
      p.rotation += p.rotationSpeed;

      if (p.y < this.canvas.height) {
        activeParticles++;
      }
    });

    if (activeParticles > 0 && this.active) {
      requestAnimationFrame(() => this.animate());
    }
  }
}
