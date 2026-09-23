// 存储层：响应式数据、localStorage 持久化、业务动作编排。
// 界面只调用本文件的 action，不直接读写 localStorage。

import { computed, reactive } from "vue";
import {
  type Batch,
  type Dataset,
  type FuelType,
  type Gun,
  type GunStatus,
  type RejectItem,
  type WithdrawReason,
  batchOfGun,
  buildSeed,
  canFinish,
  finishResult,
  isGunSelectable,
  makeBatch,
  todayISO,
  validateCreate,
  withdrawGun,
} from "./rules";

const STORAGE_KEY = "gas-gun-calendar-v1";

interface State extends Dataset {
  loaded: boolean;
}

function defaultState(): State {
  return { ...buildSeed(), loaded: false };
}

function load(): State {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const data = JSON.parse(raw) as Dataset;
      if (Array.isArray(data.stations) && Array.isArray(data.guns) && Array.isArray(data.batches)) {
        return { ...data, loaded: true };
      }
    } catch {
      // 数据损坏时回落到预置数据
    }
  }
  return defaultState();
}

const state = reactive<State>(load());

function persist(): void {
  const data: Dataset = {
    stations: state.stations,
    guns: state.guns,
    batches: state.batches,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ---------- 查询 ----------

const gunsById = computed(() => new Map(state.guns.map((g) => [g.id, g])));
const stationsById = computed(() => new Map(state.stations.map((s) => [s.id, s])));

function getGun(id: string): Gun | undefined {
  return gunsById.value.get(id);
}

function activeBatchCount(): number {
  return state.batches.filter((b) => b.status === "进行中").length;
}

function lockedGunCount(): number {
  const ids = new Set<string>();
  for (const batch of state.batches) {
    if (batch.status !== "进行中") continue;
    for (const g of batch.guns) if (!g.withdrawnAt) ids.add(g.gunId);
  }
  return ids.size;
}

// ---------- 动作 ----------

export interface CreateResult {
  ok: boolean;
  batchId?: string;
  rejects: RejectItem[];
}

/** 建批：任一枪不满足规则则整单拒绝，原批次与任何标记都不变 */
function createBatch(gunIdsInput: string[]): CreateResult {
  const now = todayISO();
  const gunIds = [...new Set(gunIdsInput)];
  const result = validateCreate(state, gunIds, now);
  if (!result.ok) {
    return { ok: false, rejects: result.items };
  }
  const seq = state.batches.length + 1;
  const batch: Batch = makeBatch(state, gunIds, seq, now);
  state.batches.unshift(batch);
  persist();
  return { ok: true, batchId: batch.id, rejects: [] };
}

/** 标记单枪完成日（仅在批且未撤出的枪可标记） */
function markCompleted(batchId: string, gunId: string, dateISO: string): boolean {
  const batch = state.batches.find((b) => b.id === batchId);
  const entry = batch?.guns.find((g) => g.gunId === gunId && !g.withdrawnAt);
  if (!entry || !dateISO) return false;
  entry.completedAt = dateISO;
  persist();
  return true;
}

/**
 * 完成批次：最晚单枪完成日 + 180 天，统一延期所有未撤出枪；
 * 撤出枪的标记与恢复有效期保持不变。
 */
function completeBatch(batchId: string): boolean {
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch || !canFinish(batch)) return false;
  const now = todayISO();
  const result = finishResult(batch, now);
  if (!result) return false;
  for (const entry of batch.guns) {
    if (entry.withdrawnAt) continue;
    const gun = getGun(entry.gunId);
    if (gun) gun.validUntil = result.newValidUntil;
  }
  batch.status = "已完成";
  batch.finishedAt = result.finishedAt;
  persist();
  return true;
}

/**
 * 改枪状态。在批枪一旦从「营业」变为停用/维修：自动撤出未结束批次，
 * 有效期恢复为入批前值（在批期间从未改写，即当前值）。
 */
function setGunStatus(gunId: string, status: GunStatus): void {
  const gun = getGun(gunId);
  if (!gun || gun.status === status) return;
  gun.status = status;
  if (status !== "营业") {
    autoWithdraw(gunId, "枪停用", gun.validUntil);
  }
  persist();
}

/**
 * 改油品。在批枪改油品即脱离批次锁定：自动撤出并恢复原有效期。
 */
function setGunFuel(gunId: string, fuel: FuelType): void {
  const gun = getGun(gunId);
  if (!gun || gun.fuel === fuel) return;
  gun.fuel = fuel;
  autoWithdraw(gunId, "改油品", gun.validUntil);
  persist();
}

function autoWithdraw(gunId: string, reason: WithdrawReason, restoreValidUntil: string): void {
  const now = todayISO();
  const batch = batchOfGun(state, gunId);
  if (batch) withdrawGun(batch, gunId, reason, restoreValidUntil, now);
}

/** 恢复预置数据（清空浏览器内的排期记录） */
function resetAll(): void {
  const seed: State = { ...buildSeed(), loaded: true };
  state.stations = seed.stations;
  state.guns = seed.guns;
  state.batches = seed.batches;
  persist();
}

// ---------- 导出 ----------

export function useStore() {
  return {
    state,
    // 查询
    getGun,
    getStation: (id: string) => stationsById.value.get(id),
    isSelectable: (gun: Gun) => isGunSelectable(state, gun),
    batchOfGun: (gunId: string) => batchOfGun(state, gunId),
    activeBatchCount,
    lockedGunCount,
    // 动作
    createBatch,
    markCompleted,
    completeBatch,
    setGunStatus,
    setGunFuel,
    resetAll,
  };
}
