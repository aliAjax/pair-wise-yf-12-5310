export type Area = "东区" | "西区" | "机场线";

export type GunStatus = "营业" | "停用";

export type FuelType = "92#汽油" | "95#汽油" | "98#汽油" | "0#柴油";

export type BatchStatus = "进行中" | "已完成" | "已撤出";

export interface Station {
  id: string;
  name: string;
  area: Area;
  address: string;
  mapX: number;
  mapY: number;
}

export interface FuelGun {
  id: string;
  stationId: string;
  gunNo: string;
  fuelType: FuelType;
  status: GunStatus;
  validUntil: string;
}

export interface BatchGun {
  gunId: string;
  stationId: string;
  gunNo: string;
  fuelType: FuelType;
  previousValidUntil: string;
  withdrawn: boolean;
  withdrawReason?: string;
  withdrawnAt?: string;
  completedAt?: string;
}

export interface CalibrationBatch {
  id: string;
  area: Area;
  status: BatchStatus;
  createdAt: string;
  completedAt?: string;
  extendedUntil?: string;
  guns: BatchGun[];
}

export interface SchedulingState {
  stations: Station[];
  guns: FuelGun[];
  batches: CalibrationBatch[];
}

export const REMAINING_LIMIT_DAYS = 7;
export const EXTENSION_DAYS = 180;

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; message: string; reasons: string[] };

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function toISODate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISODate() {
  return toISODate(new Date());
}

export function parseISODate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDaysToISODate(value: string, days: number) {
  const date = parseISODate(value);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function daysUntilDate(value: string, today: string = todayISODate()) {
  const ms = parseISODate(value).getTime() - parseISODate(today).getTime();
  return Math.round(ms / 86_400_000);
}

export function maxISODate(first: string, ...rest: string[]) {
  return [first, ...rest].sort((a, b) => parseISODate(b).getTime() - parseISODate(a).getTime())[0];
}

export function findOpenBatchForGun(state: SchedulingState, gunId: string) {
  return state.batches.find(
    (batch) =>
      batch.status === "进行中" &&
      batch.guns.some((item) => item.gunId === gunId && !item.withdrawn)
  );
}

export function findStation(state: SchedulingState, stationId: string) {
  return state.stations.find((station) => station.id === stationId);
}

export function getGunArea(state: SchedulingState, gun: FuelGun) {
  return findStation(state, gun.stationId)?.area;
}

export function gunDisplayName(state: SchedulingState, gun: FuelGun) {
  const station = findStation(state, gun.stationId);
  return `${station?.name ?? "未知油站"} ${gun.gunNo}`;
}

export type BatchCheck =
  | { ok: true; area: Area; gunIds: string[] }
  | { ok: false; message: string; reasons: string[] };

export function validateBatchCreation(
  state: SchedulingState,
  selectedGunIds: string[],
  today: string = todayISODate()
): BatchCheck {
  const reasons: string[] = [];
  const gunIds = Array.from(new Set(selectedGunIds));

  if (gunIds.length < 2) reasons.push("一个检定批次至少选择 2 把加油枪。");
  if (gunIds.length > 4) reasons.push("一个检定批次最多选择 4 把加油枪。");

  const guns = gunIds.map((id) => state.guns.find((gun) => gun.id === id));
  if (guns.some((gun) => !gun)) reasons.push("所选枪号中包含已不存在的加油枪。");

  const existingGuns = guns.filter((gun): gun is FuelGun => Boolean(gun));
  const areas = new Set(
    existingGuns
      .map((gun) => findStation(state, gun.stationId)?.area)
      .filter((area): area is Area => Boolean(area))
  );

  if (areas.size > 1) {
    reasons.push(`所选加油枪必须属于同一区域，当前跨 ${Array.from(areas).join("、")}。`);
  }

  for (const gun of existingGuns) {
    const name = gunDisplayName(state, gun);
    const openBatch = findOpenBatchForGun(state, gun.id);
    if (openBatch) reasons.push(`${name} 已在未结束批次 ${openBatch.id} 中。`);
    if (gun.status !== "营业") reasons.push(`${name} 当前状态为“${gun.status}”，不是营业状态。`);

    const remaining = daysUntilDate(gun.validUntil, today);
    if (remaining > REMAINING_LIMIT_DAYS) {
      reasons.push(`${name} 检定剩余 ${remaining} 天，超过 ${REMAINING_LIMIT_DAYS} 天受理上限。`);
    }
  }

  if (reasons.length > 0) {
    return {
      ok: false,
      message: "整单已拒绝：未创建批次，原批次和枪号标记均未改变。",
      reasons
    };
  }

  return {
    ok: true,
    area: Array.from(areas)[0],
    gunIds
  };
}

function createBatchId(state: SchedulingState, createdAt: string) {
  const dayPart = createdAt.split("-").join("");
  const serial = state.batches.filter((batch) => batch.createdAt === createdAt).length + 1;
  return `JD${dayPart}-${String(serial).padStart(2, "0")}`;
}

export function createBatch(
  state: SchedulingState,
  selectedGunIds: string[],
  today: string = todayISODate()
): ActionResult<{ batchId: string }> {
  const check = validateBatchCreation(state, selectedGunIds, today);
  if (!check.ok) return check;

  const batch: CalibrationBatch = {
    id: createBatchId(state, today),
    area: check.area,
    status: "进行中",
    createdAt: today,
    guns: check.gunIds.map((gunId) => {
      const gun = state.guns.find((item) => item.id === gunId);
      if (!gun) throw new Error(`Missing gun: ${gunId}`);
      return {
        gunId: gun.id,
        stationId: gun.stationId,
        gunNo: gun.gunNo,
        fuelType: gun.fuelType,
        previousValidUntil: gun.validUntil,
        withdrawn: false
      };
    })
  };

  state.batches.unshift(batch);
  return { ok: true, data: { batchId: batch.id } };
}

export function completeBatch(
  state: SchedulingState,
  batchId: string,
  completionDates: Record<string, string>
): ActionResult<{ extendedUntil: string }> {
  const batch = state.batches.find((item) => item.id === batchId);
  if (!batch || batch.status !== "进行中") {
    return { ok: false, message: "批次不存在或已结束。", reasons: [] };
  }

  const activeItems = batch.guns.filter((item) => !item.withdrawn);
  if (activeItems.length === 0) {
    return { ok: false, message: "批次内已无在册枪号，不能按检定完成处理。", reasons: [] };
  }

  const missingDates = activeItems
    .filter((item) => !completionDates[item.gunId])
    .map((item) => item.gunNo);
  if (missingDates.length > 0) {
    return {
      ok: false,
      message: "请补全每把在册枪号的检定完成日期。",
      reasons: [`缺少完成日期：${missingDates.join("、")}`]
    };
  }

  const latestCompletion = maxISODate(
    completionDates[activeItems[0].gunId],
    ...activeItems.slice(1).map((item) => completionDates[item.gunId])
  );
  const extendedUntil = addDaysToISODate(latestCompletion, EXTENSION_DAYS);

  for (const item of activeItems) {
    item.completedAt = completionDates[item.gunId];
    const gun = state.guns.find((candidate) => candidate.id === item.gunId);
    if (gun) gun.validUntil = extendedUntil;
  }

  batch.status = "已完成";
  batch.completedAt = latestCompletion;
  batch.extendedUntil = extendedUntil;

  return { ok: true, data: { extendedUntil } };
}

export interface WithdrawResult {
  batchId: string;
  batchEnded: boolean;
}

export function withdrawGunFromActiveBatch(
  state: SchedulingState,
  gunId: string,
  reason: string,
  today: string = todayISODate()
): WithdrawResult | undefined {
  const batch = findOpenBatchForGun(state, gunId);
  if (!batch) return undefined;

  const item = batch.guns.find((candidate) => candidate.gunId === gunId && !candidate.withdrawn);
  if (!item) return undefined;

  const gun = state.guns.find((candidate) => candidate.id === gunId);
  item.withdrawn = true;
  item.withdrawReason = reason;
  item.withdrawnAt = today;
  if (gun) gun.validUntil = item.previousValidUntil;

  const stillActive = batch.guns.some((candidate) => !candidate.withdrawn);
  let batchEnded = false;
  if (!stillActive) {
    batch.status = "已撤出";
    batchEnded = true;
  }

  return { batchId: batch.id, batchEnded };
}
