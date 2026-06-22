import Matter from "matter-js";
import { getMultipliers, riskMeta } from "../config/game";
import type { BoardParticle, DropRequest, DropResult, RiskLevel } from "../types";

const BALL_CATEGORY = 0x0001;
const STATIC_CATEGORY = 0x0002;
const SLOT_CATEGORY = 0x0004;

export interface BoardSize {
  width: number;
  height: number;
}

export interface VisualBall {
  id: string;
  body: Matter.Body;
  risk: RiskLevel;
  wager: number;
  color: string;
  settled: boolean;
  rows: number;
  targetSlot?: number;
  trail: { x: number; y: number }[];
  createdAt: number;
}

export interface PegPulse {
  x: number;
  y: number;
  life: number;
}

interface EngineEvents {
  onPegHit: (x: number, y: number, risk: RiskLevel) => void;
  onSettle: (result: DropResult) => void;
}

export class PlinkoPhysics {
  readonly engine = Matter.Engine.create({
    gravity: {
      x: 0,
      y: 1.18
    }
  });

  readonly world = this.engine.world;
  pegs: Matter.Body[] = [];
  dividers: Matter.Body[] = [];
  slots: Matter.Body[] = [];
  balls: VisualBall[] = [];
  particles: BoardParticle[] = [];
  pulses: PegPulse[] = [];
  size: BoardSize = { width: 900, height: 620 };
  rows = 14;
  private slotCount = 15;
  private lastUpdate = performance.now();
  private particleId = 1;
  private events: EngineEvents;

  constructor(events: EngineEvents) {
    this.events = events;
    Matter.Events.on(this.engine, "collisionStart", (event) => this.handleCollision(event));
  }

  rebuild(size: BoardSize, rows: number) {
    this.size = size;
    this.rows = rows;
    this.slotCount = rows + 1;
    Matter.Composite.clear(this.world, false, true);
    this.pegs = [];
    this.dividers = [];
    this.slots = [];
    this.balls = [];
    this.particles = [];
    this.pulses = [];

    this.buildPegs();
    this.buildWallsAndSlots();
  }

  hasActiveBalls() {
    return this.balls.some((ball) => !ball.settled);
  }

  drop(request: DropRequest, offset: number) {
    const metrics = this.metrics();
    const radius = Math.max(10, Math.min(13.5, metrics.pegGap * 0.25));
    const slotBias =
      request.targetSlot === undefined
        ? 0
        : (request.targetSlot - (this.slotCount - 1) / 2) / Math.max(1, (this.slotCount - 1) / 2);
    const x = metrics.centerX + offset * metrics.pegGap * 0.08 + slotBias * metrics.pegGap * 0.04;
    const y = Math.max(radius + 10, metrics.top - metrics.rowGap * 2.1);
    const body = Matter.Bodies.circle(x, y, radius, {
      restitution: request.turbo ? 0.6 : 0.68,
      friction: 0.001,
      frictionAir: request.turbo ? 0.006 : 0.01,
      density: 0.0011,
      label: `ball:${request.id}`,
      collisionFilter: {
        category: BALL_CATEGORY,
        mask: STATIC_CATEGORY
      },
      plugin: {
        drop: request
      }
    });

    Matter.Body.setVelocity(body, {
      x: offset * 0.045 + slotBias * 0.075,
      y: request.turbo ? 0.16 : 0.06
    });

    Matter.World.add(this.world, body);
    this.balls.push({
      id: request.id,
      body,
      risk: request.risk,
      wager: request.wager,
      color: riskMeta[request.risk].color,
      settled: false,
      rows: request.rows,
      targetSlot: request.targetSlot,
      trail: [],
      createdAt: performance.now()
    });
  }

  update(now: number, turbo: boolean) {
    const delta = Math.min(32, now - this.lastUpdate || 16.67);
    this.lastUpdate = now;
    Matter.Engine.update(this.engine, delta * (turbo ? 1.12 : 1));
    const metrics = this.metrics();
    const maxSpeed = turbo ? 10.5 : 8.2;

    this.balls.forEach((ball) => {
      if (ball.settled) return;
      ball.trail.push({ x: ball.body.position.x, y: ball.body.position.y });
      if (ball.trail.length > 8) ball.trail.shift();

      const velocity = ball.body.velocity;
      const speed = Math.hypot(velocity.x, velocity.y);
      const age = now - ball.createdAt;
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        Matter.Body.setVelocity(ball.body, { x: velocity.x * scale, y: velocity.y * scale });
      }

      this.keepBallInsideBoard(ball, metrics);
      this.guideBallToWeightedLane(ball, metrics);

      if (age > 900 && speed < 0.16) {
        Matter.Body.setVelocity(ball.body, {
          x: ball.body.position.x < metrics.centerX ? 0.75 : -0.75,
          y: 2.15
        });
      }

      if (ball.body.position.y > metrics.slotTop + metrics.pocketHeight * 0.42 || ball.body.position.y > this.size.height - 18) {
        this.settleBall(ball, ball.targetSlot ?? this.nearestSlot(ball.body.position.x));
      }
    });

    this.particles = this.particles
      .map((particle) => ({
        ...particle,
        x: particle.x + particle.vx * delta,
        y: particle.y + particle.vy * delta,
        vy: particle.vy + 0.00055 * delta,
        life: particle.life - delta / 420
      }))
      .filter((particle) => particle.life > 0);

    this.pulses = this.pulses
      .map((pulse) => ({ ...pulse, life: pulse.life - delta / 280 }))
      .filter((pulse) => pulse.life > 0);
  }

  private metrics() {
    const minSide = Math.min(this.size.width, this.size.height);
    const chromeTopClearance = Math.max(66, Math.min(96, this.size.height * 0.11));
    const multiplierReserve = this.size.width < 680 ? 94 : 112;
    const slotFactor = 0.42 + (this.rows - 1) * 0.78 + 0.78 * 0.05 + 0.5;
    const heightFitWidth = ((this.size.height - chromeTopClearance - multiplierReserve) * this.rows) / slotFactor;
    const maxBoardWidth = Math.min(this.size.width * 0.72, heightFitWidth, 780);
    const boardWidth = Math.max(Math.min(this.size.width * 0.86, 420), maxBoardWidth);
    const centerX = this.size.width / 2;
    const pegGap = boardWidth / this.rows;
    const rowGap = pegGap * 0.78;
    const top = chromeTopClearance + pegGap * 0.42;
    const lastPegY = top + (this.rows - 1) * rowGap;
    const slotTop = lastPegY + rowGap * 0.05;
    const pocketHeight = Math.max(28, Math.min(36, pegGap * 0.5));
    const left = centerX - boardWidth / 2;

    return {
      minSide,
      top,
      lastPegY,
      boardWidth,
      left,
      centerX,
      pegGap,
      rowGap,
      slotTop,
      pocketHeight,
      slotBottom: Math.min(this.size.height - multiplierReserve, slotTop + pocketHeight),
      slotCount: this.slotCount
    };
  }

  private buildPegs() {
    const metrics = this.metrics();
    const pegRadius = Math.max(3.2, Math.min(5.1, metrics.pegGap * 0.11));

    for (let row = 0; row < this.rows; row += 1) {
      const count = row + 2;
      const y = metrics.top + row * metrics.rowGap;
      const startX = metrics.centerX - ((count - 1) * metrics.pegGap) / 2;

      for (let index = 0; index < count; index += 1) {
        const peg = Matter.Bodies.circle(startX + index * metrics.pegGap, y, pegRadius, {
          isStatic: true,
          restitution: 0.86,
          friction: 0.02,
          label: "peg",
          collisionFilter: {
            category: STATIC_CATEGORY,
            mask: BALL_CATEGORY
          }
        });
        this.pegs.push(peg);
      }
    }

    Matter.World.add(this.world, this.pegs);
  }

  private buildWallsAndSlots() {
    const metrics = this.metrics();
    const wallOptions = {
      isStatic: true,
      restitution: 0.18,
      friction: 0,
      collisionFilter: {
        category: STATIC_CATEGORY,
        mask: BALL_CATEGORY
      }
    };
    const wallThickness = 14;
    const slotWidth = metrics.boardWidth / this.slotCount;
    const wallHeight = metrics.slotBottom - metrics.slotTop;
    const floor = Matter.Bodies.rectangle(metrics.centerX, this.size.height + wallThickness / 2, this.size.width, wallThickness, {
      ...wallOptions,
      label: "floor"
    });

    this.dividers = Array.from({ length: this.slotCount + 1 }, (_, index) =>
      Matter.Bodies.rectangle(metrics.left + index * slotWidth, metrics.slotTop + wallHeight / 2, 4, wallHeight, {
        ...wallOptions,
        label: "divider"
      })
    );

    this.slots = Array.from({ length: this.slotCount }, (_, index) =>
      Matter.Bodies.rectangle(metrics.left + slotWidth * (index + 0.5), metrics.slotBottom - 6, slotWidth * 0.9, 12, {
        isStatic: true,
        isSensor: true,
        label: `slot:${index}`,
        collisionFilter: {
          category: SLOT_CATEGORY,
          mask: BALL_CATEGORY
        }
      })
    );

    Matter.World.add(this.world, [floor]);
  }

  private wallBetween(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    thickness: number,
    options: Matter.IChamferableBodyDefinition
  ) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    return Matter.Bodies.rectangle((x1 + x2) / 2, (y1 + y2) / 2, length, thickness, {
      ...options,
      angle: Math.atan2(dy, dx),
      label: "wall"
    });
  }

  private handleCollision(event: Matter.IEventCollision<Matter.Engine>) {
    event.pairs.forEach((pair) => {
      const bodies = [pair.bodyA, pair.bodyB];
      const ballBody = bodies.find((body) => body.label.startsWith("ball:"));
      if (!ballBody) return;

      const ball = this.balls.find((candidate) => candidate.body.id === ballBody.id);
      if (!ball || ball.settled) return;

      const peg = bodies.find((body) => body.label === "peg");
      if (peg) {
        this.hitPeg(peg.position.x, peg.position.y, ball.risk);
      }

      const slot = bodies.find((body) => body.label.startsWith("slot:"));
      if (slot) {
        this.settleBall(ball, Number(slot.label.split(":")[1]));
      }
    });
  }

  private hitPeg(x: number, y: number, risk: RiskLevel) {
    const color = riskMeta[risk].color;
    this.pulses.push({ x, y, life: 1 });
    for (let index = 0; index < 5; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.045 + Math.random() * 0.075;
      this.particles.push({
        id: this.particleId++,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        color
      });
    }
    this.events.onPegHit(x, y, risk);
  }

  private settleBall(ball: VisualBall, slotIndex: number) {
    if (ball.settled) return;

    ball.settled = true;
    Matter.World.remove(this.world, ball.body);
    const multipliers = getMultipliers(ball.rows, ball.risk);
    const payoutSlot = Math.max(0, Math.min(multipliers.length - 1, slotIndex));
    const multiplier = multipliers[payoutSlot] ?? 0;
    const payout = Math.round(ball.wager * multiplier * 100) / 100;
    const drop = ball.body.plugin.drop as DropRequest;

    this.events.onSettle({
      id: ball.id,
      roundId: drop.roundId,
      roundSize: drop.roundSize,
      roundStake: drop.roundStake,
      risk: ball.risk,
      wager: ball.wager,
      rows: ball.rows,
      multiplier,
      payout,
      slotIndex: payoutSlot
    });
  }

  private nearestSlot(x: number) {
    const metrics = this.metrics();
    const slotWidth = metrics.boardWidth / this.slotCount;
    return Math.max(0, Math.min(this.slotCount - 1, Math.floor((x - metrics.left) / slotWidth)));
  }

  private keepBallInsideBoard(ball: VisualBall, metrics: ReturnType<PlinkoPhysics["metrics"]>) {
    const radius = (ball.body as Matter.Body & { circleRadius: number }).circleRadius;
    const minX = metrics.left - metrics.pegGap * 0.16;
    const maxX = metrics.left + metrics.boardWidth + metrics.pegGap * 0.16;

    if (ball.body.position.x < minX) {
      Matter.Body.setPosition(ball.body, { x: minX + radius, y: ball.body.position.y });
      Matter.Body.setVelocity(ball.body, { x: Math.abs(ball.body.velocity.x) * 0.35, y: ball.body.velocity.y });
    }

    if (ball.body.position.x > maxX) {
      Matter.Body.setPosition(ball.body, { x: maxX - radius, y: ball.body.position.y });
      Matter.Body.setVelocity(ball.body, { x: -Math.abs(ball.body.velocity.x) * 0.35, y: ball.body.velocity.y });
    }
  }

  private guideBallToWeightedLane(ball: VisualBall, metrics: ReturnType<PlinkoPhysics["metrics"]>) {
    if (ball.targetSlot === undefined) return;

    const slotWidth = metrics.boardWidth / this.slotCount;
    const targetX = metrics.left + slotWidth * (ball.targetSlot + 0.5);
    const startY = metrics.top - metrics.rowGap * 1.6;
    const endY = metrics.slotTop + metrics.pocketHeight * 0.5;
    const progress = Math.max(0, Math.min(1, (ball.body.position.y - startY) / Math.max(1, endY - startY)));
    const smoothProgress = progress * progress * (3 - 2 * progress);
    const laneX = metrics.centerX + (targetX - metrics.centerX) * smoothProgress;
    const dx = laneX - ball.body.position.x;
    const maxForce = 0.00011 + smoothProgress * 0.00034;
    const xForce = Math.max(-maxForce, Math.min(maxForce, dx * 0.0000026));

    Matter.Body.applyForce(ball.body, ball.body.position, { x: xForce, y: 0 });
    Matter.Body.setVelocity(ball.body, {
      x: ball.body.velocity.x * (0.92 - smoothProgress * 0.16) + Math.max(-0.55, Math.min(0.55, dx * 0.018)),
      y: ball.body.velocity.y
    });

    if (progress > 0.84) {
      const allowedOffset = slotWidth * 0.36;
      const clampedX = targetX + Math.max(-allowedOffset, Math.min(allowedOffset, ball.body.position.x - targetX));
      if (Math.abs(clampedX - ball.body.position.x) > 0.01) {
        Matter.Body.setPosition(ball.body, { x: clampedX, y: ball.body.position.y });
      }
    }

    if (progress > 0.93) {
      Matter.Body.setVelocity(ball.body, {
        x: ball.body.velocity.x * 0.62 + (targetX - ball.body.position.x) * 0.025,
        y: Math.max(ball.body.velocity.y, 1.25)
      });
    }
  }
}

