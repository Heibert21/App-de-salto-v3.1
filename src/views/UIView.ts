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
}

export class UIView {
  // Elementos HTML
  private liveHeightVal: HTMLElement;
  private maxJumpVal: HTMLElement;
  private jumpStateBadge: HTMLElement;
  private jumpStateText: HTMLElement;
  private flightTimeText: HTMLElement;
  private displacementText: HTMLElement;
  private baselineStatusText: HTMLElement;
  private lastJumpTimeText: HTMLElement;

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

  private userHeightInput: HTMLInputElement;
  private autoHeightBadge: HTMLElement;
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

  private athleteRosterView: HTMLElement | null = null;
  private athleteFormView: HTMLElement | null = null;
  private athleteRosterList: HTMLElement | null = null;
  private footerRoster: HTMLElement | null = null;
  private footerForm: HTMLElement | null = null;
  private rosterFooterHint: HTMLElement | null = null;

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

  // Pestañas y vista de resultados/ránking
  private tabBtnRoster: HTMLButtonElement | null = null;
  private tabBtnRanking: HTMLButtonElement | null = null;
  private athleteRankingView: HTMLElement | null = null;
  private athleteRankingList: HTMLElement | null = null;
  private athleteCountBadge: HTMLElement | null = null;
  private savedCallbacks: UIEventCallbacks | null = null;


  // Elementos de señal y toasts
  private signalBars: HTMLElement[];
  private signalLabel: HTMLElement;
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
    this.flightTimeText = this.getElement("flight-time-text");
    this.displacementText = this.getElement("displacement-text");
    this.baselineStatusText = this.getElement("baseline-status-text");
    this.lastJumpTimeText = this.getElement("last-jump-time");

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

    this.userHeightInput = this.getElement("user-height-input") as HTMLInputElement;
    this.autoHeightBadge = this.getElement("auto-height-badge");
    this.heightChips = Array.from(document.querySelectorAll<HTMLButtonElement>("#mobile-height-chips .chip-btn"));

    this.videoElement = this.getElement("video-player") as HTMLVideoElement;
    this.canvasElement = this.getElement("output-canvas") as HTMLCanvasElement;
    this.canvasWrapper = this.canvasElement?.closest('.canvas-wrapper') ?? null;

    // Indicador de calidad de señal
    this.signalBars = [
      this.getElement("signal-bar-1"),
      this.getElement("signal-bar-2"),
      this.getElement("signal-bar-3")
    ];
    this.signalLabel = this.getElement("signal-label");
    this.toastContainer = this.getElement("toast-container");

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

    this.athleteRosterView = document.getElementById("athlete-roster-view");
    this.athleteFormView = document.getElementById("athlete-form-view");
    this.athleteRosterList = document.getElementById("athlete-roster-list");
    this.athleteRankingView = document.getElementById("athlete-ranking-view");
    this.athleteRankingList = document.getElementById("athlete-ranking-list");
    this.tabBtnRoster = document.getElementById("tab-btn-roster") as HTMLButtonElement | null;
    this.tabBtnRanking = document.getElementById("tab-btn-ranking") as HTMLButtonElement | null;
    this.athleteCountBadge = document.getElementById("athlete-count-badge");
    this.footerRoster = document.getElementById("athlete-modal-footer-roster");
    this.footerForm = document.getElementById("athlete-modal-footer-form");
    this.rosterFooterHint = document.getElementById("roster-footer-hint");

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
    this.userHeightInput.value = String(userHeightCm);
    this.highlightActiveChip(userHeightCm);
  }

  /**
   * Actualiza el valor de estatura en la interfaz (ej. cuando la IA la estima automáticamente o se cambia por chip)
   */
  public updateUserHeightInput(heightCm: number, isAutoEstimated: boolean = true): void {
    this.userHeightInput.value = String(heightCm);
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

    // Eventos para chips táctiles de estatura (1-Tap para móvil)
    this.heightChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        const val = parseFloat(chip.getAttribute("data-height") ?? "172");
        this.userHeightInput.value = String(val);
        this.highlightActiveChip(val);
        this.setAutoHeightBadgeVisible(false); // Selección manual desactiva badge de IA
        callbacks.onChangeUserHeight(val);
      });
    });

    this.userHeightInput.addEventListener("change", () => {
      const val = parseFloat(this.userHeightInput.value);
      if (!isNaN(val) && val >= 120 && val <= 230) {
        this.highlightActiveChip(val);
        this.setAutoHeightBadgeVisible(false); // Ajuste manual desactiva badge de IA
        callbacks.onChangeUserHeight(val);
      }
    });

    this.btnShowRoutine.addEventListener("click", () => {
      if (callbacks.onShowRoutine) {
        callbacks.onShowRoutine();
      }
    });

    // ── Bindings para el Panel Móvil de Atleta ──
    this.savedCallbacks = callbacks;

    if (this.tabBtnRoster) {
      this.tabBtnRoster.addEventListener("click", () => this.switchAthleteTab('roster'));
    }
    if (this.tabBtnRanking) {
      this.tabBtnRanking.addEventListener("click", () => this.switchAthleteTab('ranking'));
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

    // Botón: cancelar formulario → volver a la lista
    if (this.btnCancelAthleteForm) {
      this.btnCancelAthleteForm.addEventListener("click", () => {
        this.showAthleteRoster();
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
              this.showAthleteRoster();
              this.renderRosterList(callbacks);
              this.showToast("✅ Atleta actualizado", 'success');
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
              this.showAthleteRoster();
              this.renderRosterList(callbacks);
              this.showToast("✅ Atleta guardado", 'success');
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
    UIView.saveAthleteStats(this.activeAthleteId, stats);

    // Actualizar visualizaciones si hay callbacks guardados
    if (this.savedCallbacks) {
      this.renderRosterList(this.savedCallbacks);
      this.renderRankingList(this.savedCallbacks);
    }
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
          <button class="roster-action-btn roster-edit" title="Editar" aria-label="Editar atleta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="roster-action-btn roster-delete" title="Eliminar" aria-label="Eliminar atleta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>`;

      // Tap en la tarjeta = activar atleta
      card.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.roster-action-btn')) return;
        this.activeAthleteId = athlete.id;
        this.saveActiveId();
        this.applyActiveAthlete(callbacks);
        this.renderRosterList(callbacks);
        this.renderRankingList(callbacks);
        this.showToast(`✅ ${athlete.name} activado`, 'success');
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
      });

      this.athleteRankingList!.appendChild(card);
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  ROSTER: cambio entre pestañas (Atletas vs Resultados)
  // ─────────────────────────────────────────────────────────────
  private switchAthleteTab(tab: 'roster' | 'ranking'): void {
    if (tab === 'roster') {
      if (this.tabBtnRoster) this.tabBtnRoster.classList.add('active');
      if (this.tabBtnRanking) this.tabBtnRanking.classList.remove('active');
      if (this.athleteRosterView) this.athleteRosterView.style.display = '';
      if (this.athleteRankingView) this.athleteRankingView.style.display = 'none';
      if (this.athleteFormView) this.athleteFormView.style.display = 'none';
      if (this.footerRoster) this.footerRoster.style.display = '';
      if (this.footerForm) this.footerForm.style.display = 'none';
      if (this.rosterFooterHint) this.rosterFooterHint.textContent = 'Toca un atleta para activarlo';
    } else {
      if (this.tabBtnRoster) this.tabBtnRoster.classList.remove('active');
      if (this.tabBtnRanking) this.tabBtnRanking.classList.add('active');
      if (this.athleteRosterView) this.athleteRosterView.style.display = 'none';
      if (this.athleteRankingView) this.athleteRankingView.style.display = '';
      if (this.athleteFormView) this.athleteFormView.style.display = 'none';
      if (this.footerRoster) this.footerRoster.style.display = '';
      if (this.footerForm) this.footerForm.style.display = 'none';
      if (this.rosterFooterHint) this.rosterFooterHint.textContent = 'Toca un atleta para activarlo';
      if (this.savedCallbacks) this.renderRankingList(this.savedCallbacks);
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  ROSTER: navegación entre vistas (lista ↔ formulario)
  // ─────────────────────────────────────────────────────────────
  private showAthleteRoster(): void {
    if (this.athleteRosterView) this.athleteRosterView.style.display = '';
    if (this.athleteRankingView) this.athleteRankingView.style.display = 'none';
    if (this.athleteFormView) this.athleteFormView.style.display = 'none';
    if (this.footerRoster) this.footerRoster.style.display = '';
    if (this.footerForm) this.footerForm.style.display = 'none';
    if (this.tabBtnRoster) this.tabBtnRoster.classList.add('active');
    if (this.tabBtnRanking) this.tabBtnRanking.classList.remove('active');
  }

  private showAthleteForm(athlete: { id: string; name: string; weightKg: number; heightCm: number } | null): void {
    if (this.athleteRosterView) this.athleteRosterView.style.display = 'none';
    if (this.athleteRankingView) this.athleteRankingView.style.display = 'none';
    if (this.athleteFormView) this.athleteFormView.style.display = '';
    if (this.footerRoster) this.footerRoster.style.display = 'none';
    if (this.footerForm) this.footerForm.style.display = '';

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
    // Mostrar vista de lista y renderizarla
    this.showAthleteRoster();
    // Necesitamos callbacks para renderizar la lista → diferido al bindEvents
    this.athleteProfileModal.style.display = "flex";
    this.athleteProfileModal.setAttribute("aria-hidden", "false");
    // Inicializar header si hay atleta activo
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
    this.showAthleteRoster(); // reset a lista para próxima apertura
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
    // Sobrescribir openAthleteModal para pasar callbacks al render
    const origOpen = this.openAthleteModal.bind(this);
    this.openAthleteModal = () => {
      origOpen();
      this.renderRosterList(callbacks);
      this.renderRankingList(callbacks);
    };

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
      this.flightTimeText.textContent = `${(flightTimeMs / 1000).toFixed(2)} s`;
      this.lastJumpTimeText.textContent = `Último vuelo: ${(flightTimeMs / 1000).toFixed(2)}s`;
    }

    // 5. Desplazamiento
    if (displacementCm > 0) {
      this.displacementText.textContent = `${displacementCm.toFixed(1)} cm`;
    }

    // 6. Estado Baseline Suelo
    const baselineStatusStr = isBaselineLocked ? '🔒 Fijado' : '⏳ Calibrando';
    if (baselineStatusStr !== this.lastBaselineStatus) {
      this.baselineStatusText.textContent = baselineStatusStr;
      this.baselineStatusText.className = isBaselineLocked ? 'status-locked' : 'status-calibrating';
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
      this.signalLabel.textContent = label;
      this.signalLabel.className = "signal-text " + colorClass;
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
   * Actualiza la interfaz según la fuente activa (Cámara vs Video vs Inactivo)
   */
  public setSourceState(mode: 'camera' | 'video' | 'none', label?: string): void {
    // Resetear el toast de "Listo" al cambiar fuente
    this.readyToastShown = false;
    this.lastAvgVisibility = 0;
    this.lastSignalLevel = -1;

    if (mode === 'camera') {
      this.cameraToolbar.style.display = "flex";
      this.canvasWrapper?.classList.add('has-video');

      this.btnStartCameraText.textContent = "Detener Cámara";
      this.btnStartCamera.classList.add("camera-active");

      this.btnUploadVideoText.textContent = "Subir Video";
      this.btnResetRecord.disabled = false;
    } else if (mode === 'video') {
      this.cameraToolbar.style.display = "none";
      this.canvasWrapper?.classList.add('has-video');

      this.btnStartCameraText.textContent = "Medir con Cámara";
      this.btnStartCamera.classList.remove("camera-active");

      this.btnUploadVideoText.textContent = label ? `Video: ${label.substring(0, 10)}...` : "Cambiar Video";
      this.btnResetRecord.disabled = false;
    } else {
      this.cameraToolbar.style.display = "none";
      this.canvasWrapper?.classList.remove('has-video');

      this.btnStartCameraText.textContent = "Medir con Cámara";
      this.btnStartCamera.classList.remove("camera-active");

      this.btnUploadVideoText.textContent = "Subir Video";
      this.btnResetRecord.disabled = true;

      // Resetear indicador de señal
      this.signalBars.forEach(bar => { bar.className = "signal-bar"; });
      this.signalLabel.textContent = "—";
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
