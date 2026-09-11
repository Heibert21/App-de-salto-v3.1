/**
 * ============================================================================
 * VISTA: CanvasView.ts
 * Responsabilidad: Renderizado visual en tiempo real en el elemento <canvas>:
 * esqueleto de cadera/piernas, línea base del suelo, indicador de pico y regla.
 *
 * Mejoras v3 (Presentation Edition):
 *  - Anillos de carga pulsantes (PREPARING): energía acumulándose en la cadera.
 *  - Estela de partículas de energía (IN_AIR): partículas suben desde la cadera.
 *  - Barra lateral de altura en vivo (IN_AIR): muestra los cm subiendo en tiempo real.
 *  - Shockwave de impacto (LANDED): onda elíptica expandiéndose desde los pies.
 *  - Esqueleto dorado/cyan adaptado al estado biomecánico.
 * ============================================================================
 */

import { NormalizedLandmark } from "../models/PoseModel";
import { JumpState } from "../models/JumpModel";

export class CanvasView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private readonly mobile: boolean;

  // Animación de pulso para la línea baseline (PREPARING)
  private pulsePhase: number = 0;
  // Animación de borde verde (buena señal)
  private borderPhase: number = 0;
  // Modo espejo para cámara frontal
  private isMirrored: boolean = false;

  // ── Animación de partículas (IN_AIR) ──
  private particles: Array<{
    x: number; y: number;
    vx: number; vy: number;
    life: number;
    radius: number; hue: number;
  }> = [];

  // ── Animación de shockwave (LANDED) ──
  private shockwaves: Array<{
    x: number; y: number;
    radius: number; maxRadius: number;
    life: number;
  }> = [];

  // Seguimiento del estado anterior para disparar efectos en transiciones
  private lastState: JumpState = 'IDLE';

  constructor(canvasElement: HTMLCanvasElement, isMobile: boolean = false) {
    this.canvas = canvasElement;
    this.mobile = isMobile;
    const context = this.canvas.getContext("2d");
    if (!context) {
      throw new Error("No se pudo obtener el contexto 2D del Canvas");
    }
    this.ctx = context;
  }

  /**
   * Configura el modo espejo (para cámara frontal)
   */
  public setMirrored(mirrored: boolean): void {
    this.isMirrored = mirrored;
  }

  /**
   * Sincroniza el tamaño del canvas con el del video contenedor.
   */
  public resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /**
   * Limpia el contenido del canvas.
   */
  public clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Renderiza el marco visual completo: esqueleto, líneas de nivel y métricas.
   * @param avgVisibility Visibilidad promedio de los keypoints [0, 1]
   */
  public render(
    landmarks: NormalizedLandmark[] | null,
    baselineHipY: number | null,
    baselineAnkleY: number | null,
    isBaselineLocked: boolean,
    peakHipY: number,
    currentJumpCm: number,
    jumpState: JumpState,
    avgVisibility: number = 0
  ): void {
    this.clear();
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Avanzar fases de animación
    this.pulsePhase += 0.08;
    this.borderPhase += 0.05;

    // Detectar transición IN_AIR → LANDED para disparar shockwave
    if (this.lastState === 'IN_AIR' && jumpState === 'LANDED') {
      if (baselineAnkleY !== null) {
        this.shockwaves.push({
          x: width / 2,
          y: baselineAnkleY,
          radius: 0,
          maxRadius: width * 0.55,
          life: 1,
        });
      }
      this.particles = [];
    }
    this.lastState = jumpState;

    // 1. Si no hay landmarks, mostrar silueta fantasma de posicionamiento
    if (!landmarks || landmarks.length < 33) {
      this.drawPositioningOverlay(width, height);
      return;
    }

    // 2. Dibujar borde de estado (verde/rojo según visibilidad)
    this.drawStatusBorder(width, height, avgVisibility);

    // 3. Dibujar barra de confianza de pose (esquina superior derecha)
    this.drawConfidenceBar(width, avgVisibility);

    // Obtener posición del centro de cadera
    const getX = (normX: number) => (this.isMirrored ? (1 - normX) * width : normX * width);
    const lhip = landmarks[23];
    const rhip = landmarks[24];
    let hipCX = width / 2;
    let hipCY = height / 2;
    if (lhip && rhip) {
      hipCX = getX((lhip.x + rhip.x) / 2);
      hipCY = ((lhip.y + rhip.y) / 2) * height;
    }

    // 4. Efectos visuales animados según estado biomecánico
    if (jumpState === 'PREPARING') {
      this.drawChargingRings(hipCX, hipCY);
    }

    if (jumpState === 'IN_AIR') {
      this.emitParticles(hipCX, hipCY);
      this.drawLiveHeightBar(width, height, baselineHipY, hipCY, currentJumpCm);
    }

    this.updateAndDrawParticles();
    this.updateAndDrawShockwaves();

    // 5. Dibujar línea base del suelo (Baseline Cadera y Tobillos)
    if (baselineHipY !== null && baselineAnkleY !== null) {
      this.drawBaselineLines(width, baselineHipY, baselineAnkleY, jumpState, isBaselineLocked);
    }

    // 6. Dibujar línea del pico máximo de salto
    if (baselineHipY !== null && peakHipY < baselineHipY - 5) {
      this.drawPeakLine(width, peakHipY, currentJumpCm);
    }

    // 7. Dibujar esqueleto de la persona
    this.drawSkeleton(landmarks, width, height, jumpState);
  }

  // ── NUEVO: Anillos de carga (PREPARING) ─────────────────────────────────

  private drawChargingRings(cx: number, cy: number): void {
    const numRings = 3;
    this.ctx.save();
    for (let i = 0; i < numRings; i++) {
      const phase = (this.pulsePhase + i * (Math.PI * 2 / numRings)) % (Math.PI * 2);
      const t = (Math.sin(phase) + 1) / 2;

      const radius = 20 + t * 65;
      const alpha = (1 - t) * 0.65;

      const r = Math.round(t * 255);
      const g = Math.round(242 - t * 27);
      const b = Math.round(254 - t * 254);

      this.ctx.beginPath();
      this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      this.ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
      this.ctx.lineWidth = 2.5 - t * 1.5;
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  // ── NUEVO: Partículas de energía (IN_AIR) ───────────────────────────────

  private emitParticles(cx: number, cy: number): void {
    const maxParticles = this.mobile ? 18 : 35;
    if (this.particles.length >= maxParticles) return;

    const count = this.mobile ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
      const speed = 2.5 + Math.random() * 3;
      const hue = 170 + Math.random() * 60;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 20,
        y: cy,
        vx: Math.cos(angle) * speed * 0.4,
        vy: Math.sin(angle) * speed,
        life: 1,
        radius: 3 + Math.random() * 4,
        hue,
      });
    }
  }

  private updateAndDrawParticles(): void {
    if (this.particles.length === 0) return;
    this.ctx.save();
    this.particles = this.particles.filter(p => p.life > 0);
    for (const p of this.particles) {
      p.life -= 0.025;
      p.x += p.vx;
      p.y += p.vy;
      p.vy -= 0.04;
      p.vx *= 0.98;

      const alpha = p.life;
      const radius = p.radius * p.life;

      const grad = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      grad.addColorStop(0, `hsla(${p.hue}, 100%, 80%, ${alpha})`);
      grad.addColorStop(1, `hsla(${p.hue}, 100%, 50%, 0)`);
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      this.ctx.fillStyle = grad;
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  // ── NUEVO: Barra de altura en vivo (IN_AIR) ─────────────────────────────

  private drawLiveHeightBar(
    width: number,
    height: number,
    baselineHipY: number | null,
    currentHipY: number,
    currentCm: number
  ): void {
    if (baselineHipY === null) return;

    const barX = 10;
    const barW = 7;
    const barMaxH = height * 0.5;
    const barBottomY = baselineHipY;
    const barTopY = barBottomY - barMaxH;

    this.ctx.save();

    this.ctx.fillStyle = "rgba(0,0,0,0.35)";
    this.ctx.beginPath();
    this.ctx.roundRect(barX, barTopY, barW, barMaxH, 4);
    this.ctx.fill();

    const displacement = Math.max(0, baselineHipY - currentHipY);
    const fillH = Math.min(displacement, barMaxH);
    const fillY = barBottomY - fillH;

    const grad = this.ctx.createLinearGradient(0, fillY, 0, barBottomY);
    grad.addColorStop(0, "#FFD700");
    grad.addColorStop(0.5, "#00F2FE");
    grad.addColorStop(1, "rgba(0,242,254,0.2)");

    this.ctx.fillStyle = grad;
    this.ctx.beginPath();
    this.ctx.roundRect(barX, fillY, barW, fillH, 4);
    this.ctx.fill();

    this.ctx.fillStyle = "#FFD700";
    this.ctx.font = `bold ${this.mobile ? 11 : 13}px 'Space Mono', monospace`;
    this.ctx.textAlign = "left";
    this.ctx.fillText(`${currentCm.toFixed(1)}`, barX + barW + 5, fillY + 4);
    this.ctx.font = `${this.mobile ? 8 : 9}px 'Space Mono', monospace`;
    this.ctx.fillStyle = "rgba(255,215,0,0.7)";
    this.ctx.fillText("cm", barX + barW + 5, fillY + 15);

    this.ctx.restore();
  }

  // ── NUEVO: Shockwave de impacto (LANDED) ─────────────────────────────────

  private updateAndDrawShockwaves(): void {
    if (this.shockwaves.length === 0) return;
    this.ctx.save();
    this.shockwaves = this.shockwaves.filter(sw => sw.life > 0);
    for (const sw of this.shockwaves) {
      sw.radius += (sw.maxRadius - sw.radius) * 0.12;
      sw.life -= 0.04;

      const alpha = sw.life * 0.7;
      const lineW = sw.life * 4;

      this.ctx.beginPath();
      this.ctx.ellipse(sw.x, sw.y, sw.radius, sw.radius * 0.22, 0, 0, Math.PI * 2);
      this.ctx.strokeStyle = `rgba(0, 230, 118, ${alpha})`;
      this.ctx.lineWidth = lineW;
      this.ctx.stroke();

      if (sw.radius > 20) {
        this.ctx.beginPath();
        this.ctx.ellipse(sw.x, sw.y, sw.radius * 0.5, sw.radius * 0.5 * 0.22, 0, 0, Math.PI * 2);
        this.ctx.strokeStyle = `rgba(255, 215, 0, ${alpha * 0.55})`;
        this.ctx.lineWidth = lineW * 0.6;
        this.ctx.stroke();
      }
    }
    this.ctx.restore();
  }

  // ── Overlay de posicionamiento ──────────────────────────────────────────

  private drawPositioningOverlay(width: number, height: number): void {
    const cx = width / 2;
    const cy = height / 2;
    const alpha = 0.15 + 0.07 * Math.sin(this.pulsePhase);

    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.strokeStyle = "#00F2FE";
    this.ctx.lineWidth = 3;
    const scale = height * 0.55;
    const headR = scale * 0.065;
    const headCy = cy - scale * 0.38;
    this.ctx.beginPath();
    this.ctx.arc(cx, headCy, headR, 0, 2 * Math.PI);
    this.ctx.stroke();

    const shoulderY = headCy + headR + scale * 0.04;
    const hipY = shoulderY + scale * 0.28;
    this.ctx.beginPath();
    this.ctx.moveTo(cx, shoulderY);
    this.ctx.lineTo(cx, hipY);
    this.ctx.stroke();

    const shoulderW = scale * 0.15;
    this.ctx.beginPath();
    this.ctx.moveTo(cx - shoulderW, shoulderY);
    this.ctx.lineTo(cx + shoulderW, shoulderY);
    this.ctx.stroke();

    const elbowY = shoulderY + scale * 0.18;
    this.ctx.beginPath();
    this.ctx.moveTo(cx - shoulderW, shoulderY);
    this.ctx.lineTo(cx - shoulderW * 1.3, elbowY);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(cx + shoulderW, shoulderY);
    this.ctx.lineTo(cx + shoulderW * 1.3, elbowY);
    this.ctx.stroke();

    const hipW = scale * 0.1;
    const kneeY = hipY + scale * 0.22;
    const footY = kneeY + scale * 0.22;
    this.ctx.beginPath();
    this.ctx.moveTo(cx - hipW, hipY);
    this.ctx.lineTo(cx - hipW * 1.1, kneeY);
    this.ctx.lineTo(cx - hipW * 1.15, footY);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(cx + hipW, hipY);
    this.ctx.lineTo(cx + hipW * 1.1, kneeY);
    this.ctx.lineTo(cx + hipW * 1.15, footY);
    this.ctx.stroke();

    this.ctx.globalAlpha = 1;
    this.ctx.restore();

    this.ctx.save();
    const textAlpha = 0.6 + 0.3 * Math.sin(this.pulsePhase);
    this.ctx.globalAlpha = textAlpha;
    this.ctx.fillStyle = "#00F2FE";
    this.ctx.font = `bold ${Math.max(14, height * 0.022)}px 'Outfit', sans-serif`;
    this.ctx.textAlign = "center";
    this.ctx.fillText("El video debe mostrar el cuerpo completo", cx, cy + height * 0.33);
    this.ctx.font = `${Math.max(11, height * 0.017)}px 'Outfit', sans-serif`;
    this.ctx.fillStyle = "rgba(255,255,255,0.7)";
    this.ctx.fillText("De pies a cabeza para mejor precisión", cx, cy + height * 0.33 + height * 0.03);
    this.ctx.restore();
  }

  // ── Borde de estado ─────────────────────────────────────────────────────

  private drawStatusBorder(width: number, height: number, avgVisibility: number): void {
    if (avgVisibility >= 0.7) {
      const alpha = 0.25 + 0.2 * Math.abs(Math.sin(this.borderPhase));
      this.ctx.save();
      this.ctx.strokeStyle = `rgba(0, 230, 100, ${alpha})`;
      this.ctx.lineWidth = 8;
      this.ctx.strokeRect(4, 4, width - 8, height - 8);
      this.ctx.restore();
    } else if (avgVisibility < 0.4 && avgVisibility > 0) {
      this.ctx.save();
      this.ctx.strokeStyle = "rgba(255, 60, 60, 0.3)";
      this.ctx.lineWidth = 6;
      this.ctx.strokeRect(4, 4, width - 8, height - 8);
      this.ctx.restore();
    }
  }

  // ── Barra de confianza ──────────────────────────────────────────────────

  private drawConfidenceBar(width: number, avgVisibility: number): void {
    const segments = 5;
    const filled = Math.round(avgVisibility * segments);
    const barW = 16;
    const barH = 8;
    const gap = 3;
    const totalW = segments * barW + (segments - 1) * gap;
    const startX = width - totalW - 12;
    const startY = 12;

    this.ctx.save();
    this.ctx.fillStyle = "rgba(0,0,0,0.45)";
    this.ctx.beginPath();
    this.ctx.roundRect(startX - 6, startY - 4, totalW + 12, barH + 16, 4);
    this.ctx.fill();

    for (let i = 0; i < segments; i++) {
      const x = startX + i * (barW + gap);
      const ratio = i / (segments - 1);
      const r = Math.round(255 * (1 - ratio));
      const g = Math.round(200 * ratio + 55);
      const active = i < filled;
      this.ctx.fillStyle = active ? `rgb(${r}, ${g}, 50)` : "rgba(255,255,255,0.12)";
      this.ctx.beginPath();
      this.ctx.roundRect(x, startY, barW, barH, 2);
      this.ctx.fill();
    }

    this.ctx.fillStyle = "rgba(255,255,255,0.65)";
    this.ctx.font = `bold 9px 'Space Mono', monospace`;
    this.ctx.textAlign = "center";
    this.ctx.fillText("SEÑAL", startX + totalW / 2, startY + barH + 10);
    this.ctx.restore();
  }

  // ── Líneas baseline ─────────────────────────────────────────────────────

  private drawBaselineLines(
    width: number,
    hipY: number,
    ankleY: number,
    jumpState: JumpState,
    isLocked: boolean
  ): void {
    const isPreparing = jumpState === 'PREPARING';
    this.ctx.save();

    this.ctx.beginPath();
    const ankleAlpha = isLocked ? 0.9 : (0.4 + 0.4 * Math.abs(Math.sin(this.pulsePhase * 2)));
    this.ctx.strokeStyle = isLocked ? "rgba(0, 230, 118, 0.85)" : `rgba(255, 215, 0, ${ankleAlpha})`;
    this.ctx.lineWidth = isLocked ? 2.5 : 2;
    this.ctx.setLineDash(isLocked ? [] : [6, 4]);
    this.ctx.moveTo(0, ankleY);
    this.ctx.lineTo(width, ankleY);
    this.ctx.stroke();

    this.ctx.fillStyle = isLocked ? "#00E676" : "#FFD700";
    this.ctx.font = "bold 11px 'Space Mono', monospace";
    this.ctx.textAlign = "left";
    this.ctx.fillText(
      isLocked ? "--- 🔒 SUELO FIJADO ---" : "--- ⏳ CALIBRANDO SUELO (Quedate quieto) ---",
      16, ankleY - 6
    );

    this.ctx.beginPath();
    this.ctx.strokeStyle = `rgba(0, 242, 254, ${isPreparing ? 0.9 : 0.45})`;
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([8, 6]);
    this.ctx.moveTo(0, hipY);
    this.ctx.lineTo(width, hipY);
    this.ctx.stroke();

    this.ctx.fillStyle = "rgba(0, 242, 254, 0.7)";
    this.ctx.fillText(
      isPreparing ? "--- FLEXIONANDO ---" : "--- REF. CADERA ---",
      16, hipY - 6
    );

    this.ctx.restore();
  }

  // ── Línea de pico ───────────────────────────────────────────────────────

  private drawPeakLine(width: number, y: number, currentCm: number): void {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.strokeStyle = "rgba(255, 215, 0, 0.9)";
    this.ctx.lineWidth = 3;
    if (!this.mobile) {
      this.ctx.shadowColor = "#FFD700";
      this.ctx.shadowBlur = 10;
    }
    this.ctx.moveTo(0, y);
    this.ctx.lineTo(width, y);
    this.ctx.stroke();

    this.ctx.fillStyle = "#FFD700";
    this.ctx.font = "bold 14px 'Outfit', sans-serif";
    this.ctx.textAlign = "right";
    this.ctx.fillText(`▲ PICO: ${currentCm.toFixed(1)} cm`, width - 12, y - 8);
    this.ctx.restore();
  }

  // ── Esqueleto ───────────────────────────────────────────────────────────

  private drawSkeleton(
    landmarks: NormalizedLandmark[],
    width: number,
    height: number,
    state: JumpState
  ): void {
    const connections = [
      [23, 24], [23, 25], [25, 27], [27, 29], [27, 31],
      [24, 26], [26, 28], [28, 30], [28, 32],
      [11, 23], [12, 24],
    ];

    const isAir = state === 'IN_AIR';
    const isPreparing = state === 'PREPARING';
    const strokeColor = isAir ? "#00F2FE" : isPreparing ? "#FFD700" : "rgba(255,255,255,0.85)";
    const glowColor   = isAir ? "#00F2FE" : isPreparing ? "#FFD700" : "rgba(79,172,254,0.5)";

    this.ctx.save();
    this.ctx.lineWidth = isAir ? 4 : 3;
    this.ctx.strokeStyle = strokeColor;
    if (!this.mobile) {
      this.ctx.shadowColor = glowColor;
      this.ctx.shadowBlur = isAir ? 14 : isPreparing ? 10 : 6;
    }

    const getX = (normX: number) => (this.isMirrored ? (1 - normX) * width : normX * width);

    connections.forEach(([i, j]) => {
      const p1 = landmarks[i];
      const p2 = landmarks[j];
      if (p1 && p2 && (p1.visibility ?? 1) > 0.4 && (p2.visibility ?? 1) > 0.4) {
        this.ctx.beginPath();
        this.ctx.moveTo(getX(p1.x), p1.y * height);
        this.ctx.lineTo(getX(p2.x), p2.y * height);
        this.ctx.stroke();
      }
    });

    const keypointIndices = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
    keypointIndices.forEach((idx) => {
      const lm = landmarks[idx];
      if (lm && (lm.visibility ?? 1) > 0.4) {
        const x = getX(lm.x);
        const y = lm.y * height;
        this.ctx.beginPath();
        this.ctx.arc(x, y, isAir ? 6 : 5, 0, 2 * Math.PI);
        this.ctx.fillStyle = (idx === 23 || idx === 24) ? "#FFD700" : "#00F2FE";
        this.ctx.fill();
        this.ctx.strokeStyle = "#FFFFFF";
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
      }
    });

    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    if (leftHip && rightHip) {
      const hipCenterY = ((leftHip.y + rightHip.y) / 2) * height;

      this.ctx.beginPath();
      this.ctx.arc(hipCenterX, hipCenterY, 8, 0, 2 * Math.PI);
      this.ctx.fillStyle = "#FF007F"; // Rosa Neón para el centro de cadera
      this.ctx.fill();
      this.ctx.strokeStyle = "#FFFFFF";
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
    }

    this.ctx.restore();
  }
}
