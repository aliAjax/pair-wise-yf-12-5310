// 业务规则层：油站计量枪检定排期
// 纯函数 + 预置数据，不依赖 Vue，不读写 localStorage。

export type Area = "东区" | "南区" | "西区" | "北区" | "机场线";
export type GunStatus = "营业" | "停用" | "维修";
export type FuelType = "92#汽油" | "95#汽油" | "98#汽油" | "0#柴油";
export type BatchStatus = "进行中" | "已完成" | "已撤销";
export type WithdrawReason = "枪停用" | "改油品";
export type RejectCode = "COUNT" | "AREA" | "ACTIVE_BATCH" | "NOT_OPEN" | "DUE_SOON";

export const AREAS: Area[] = ["东区", "南区", "西区", "北区", "机场线"];
export const GUN_STATUSES: GunStatus[] = ["营业", "停用", "维修"];
export const FUEL_TYPES: FuelType[] = ["92#汽油", "95#汽油", "98#汽油", "0#柴油"];

export const MIN_GUNS = 2; // 单批次最少枪数
export const MAX_GUNS = 4; // 单批次最多枪数
export const REMAIN_LIMIT_DAYS = 7; // 检定剩余天数超过 7 天的枪不允许入批
export const EXTEND_DAYS = 180; // 完成后统一延期天数

export interface Station {
  id: string;
  name: string;
  area: Area;
  address: string;
  lat: number;
  lng: number;
}

export interface Gun {
  id: string; // 业务锁键：枪号（全站唯一）
  stationId: string;
  area: Area;
  fuel: FuelType;
  status: GunStatus;
  validUntil: string; // 当前检定有效期 YYYY-MM-DD
}

export interface BatchGun {
  gunId: string;
  lockedFuel: FuelType; // 建批时油品快照
  completedAt: string | null; // 单枪完成日
  withdrawnAt: string | null; // 撤出时间
  withdrawReason: WithdrawReason | null;
  restoredValidUntil: string | null; // 撤出后恢复到的有效期
}

export interface Batch {
  id: string;
  area: Area;
  createdAt: string;
  status: BatchStatus;
  finishedAt: string | null;
  guns: BatchGun[];
  rejectNote?: string | null;
}

export interface Dataset {
  stations: Station[];
  guns: Gun[];
  batches: Batch[];
}

export interface RejectItem {
  gunId: string;
  code: RejectCode;
  message: string;
}

// ---------- 日期工具 ----------

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function offsetISO(days: number, base: string = todayISO()): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** 检定剩余天数（有效期当天为 0，过期为负） */
export function daysUntil(dateISO: string, now: string = todayISO()): number {
  const a = new Date(`${dateISO}T00:00:00`).getTime();
  const b = new Date(`${now}T00:00:00`).getTime();
  return Math.round((a - b) / 86400000);
}

// ---------- 预置数据：五座油站 ----------

interface GunSeed {
  id: string;
  fuel: FuelType;
  status: GunStatus;
  offsetDays: number; // 检定有效期相对今天的偏移
}

interface StationSeed {
  id: string;
  name: string;
  area: Area;
  address: string;
  lat: number;
  lng: number;
  guns: GunSeed[];
}

// 以成都为地图中心，五座油站分布在五个区域
const STATION_SEEDS: StationSeed[] = [
  {
    id: "S1",
    name: "东区一号加油站",
    area: "东区",
    address: "成华区建材路 68 号",
    lat: 30.6598,
    lng: 104.1256,
    guns: [
      { id: "A1", fuel: "92#汽油", status: "营业", offsetDays: 3 },
      { id: "A2", fuel: "95#汽油", status: "营业", offsetDays: 5 },
      { id: "A3", fuel: "0#柴油", status: "营业", offsetDays: 12 },
      { id: "A4", fuel: "92#汽油", status: "维修", offsetDays: 2 },
      { id: "A5", fuel: "98#汽油", status: "营业", offsetDays: 4 },
    ],
  },
  {
    id: "S2",
    name: "南站枢纽加油站",
    area: "南区",
    address: "武侯区天府大道北段 12 号",
    lat: 30.6022,
    lng: 104.0686,
    guns: [
      { id: "B1", fuel: "92#汽油", status: "营业", offsetDays: -2 },
      { id: "B2", fuel: "95#汽油", status: "营业", offsetDays: 6 },
      { id: "B3", fuel: "0#柴油", status: "营业", offsetDays: 20 },
      { id: "B4", fuel: "92#汽油", status: "停用", offsetDays: 1 },
    ],
  },
  {
    id: "S3",
    name: "西环金沙加油站",
    area: "西区",
    address: "青羊区清江中路 219 号",
    lat: 30.6684,
    lng: 104.0152,
    guns: [
      { id: "C1", fuel: "95#汽油", status: "营业", offsetDays: 0 },
      { id: "C2", fuel: "95#汽油", status: "营业", offsetDays: 7 },
      { id: "C3", fuel: "98#汽油", status: "营业", offsetDays: 2 },
      { id: "C4", fuel: "0#柴油", status: "营业", offsetDays: 40 },
    ],
  },
  {
    id: "S4",
    name: "北区物流加油站",
    area: "北区",
    address: "新都区物流大道 7 号",
    lat: 30.7456,
    lng: 104.1578,
    guns: [
      { id: "D1", fuel: "0#柴油", status: "营业", offsetDays: 4 },
      { id: "D2", fuel: "0#柴油", status: "营业", offsetDays: 6 },
      { id: "D3", fuel: "92#汽油", status: "营业", offsetDays: 15 },
      { id: "D4", fuel: "95#汽油", status: "营业", offsetDays: 3 },
    ],
  },
  {
    id: "S5",
    name: "机场快线加油站",
    area: "机场线",
    address: "双流区机场高速辅道 3 号",
    lat: 30.5782,
    lng: 103.9688,
    guns: [
      { id: "E1", fuel: "95#汽油", status: "营业", offsetDays: 1 },
      { id: "E2", fuel: "98#汽油", status: "营业", offsetDays: 5 },
      { id: "E3", fuel: "92#汽油", status: "营业", offsetDays: 9 },
      { id: "E4", fuel: "0#柴油", status: "营业", offsetDays: -1 },
      { id: "E5", fuel: "92#汽油", status: "停用", offsetDays: 6 },
    ],
  },
];

/** 生成预置数据；activeBatchSeeds 引用的枪会处于已有未结束批次状态 */
export function buildSeed(now: string = todayISO()): Dataset {
  const stations: Station[] = STATION_SEEDS.map((s) => ({
    id: s.id,
    name: s.name,
    area: s.area,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
  }));

  const guns: Gun[] = STATION_SEEDS.flatMap((s) =>
    s.guns.map((g) => ({
      id: g.id,
      stationId: s.id,
      area: s.area,
      fuel: g.fuel,
      status: g.status,
      validUntil: offsetISO(g.offsetDays, now),
    }))
  );

  // 预置一个北区进行中的批次（D1/D4 被占用，演示「已有未结束批次整单拒绝」）
  const batches: Batch[] = [
    {
      id: seedBatchId(1),
      area: "北区",
      createdAt: offsetISO(-2, now),
      status: "进行中",
      finishedAt: null,
      rejectNote: null,
      guns: [
        {
          gunId: "D1",
          lockedFuel: "0#柴油",
          completedAt: null,
          withdrawnAt: null,
          withdrawReason: null,
          restoredValidUntil: null,
        },
        {
          gunId: "D4",
          lockedFuel: "95#汽油",
          completedAt: null,
          withdrawnAt: null,
          withdrawReason: null,
          restoredValidUntil: null,
        },
      ],
    },
  ];

  return { stations, guns, batches };
}

// ---------- 查询辅助 ----------

export function activeBatchesOf(data: Dataset): Batch[] {
  return data.batches.filter((b) => b.status === "进行中");
}

/** 枪号是否已被未结束批次锁定（撤出的枪不算锁定） */
export function gunLockedInBatch(data: Dataset, gunId: string): boolean {
  return activeBatchesOf(data).some(
    (b) => b.status === "进行中" && b.guns.some((g) => g.gunId === gunId && !g.withdrawnAt)
  );
}

export function batchOfGun(data: Dataset, gunId: string): Batch | undefined {
  return activeBatchesOf(data).find((b) =>
    b.guns.some((g) => g.gunId === gunId && !g.withdrawnAt)
  );
}

export function batchEntry(batch: Batch, gunId: string): BatchGun | undefined {
  return batch.guns.find((g) => g.gunId === gunId && !g.withdrawnAt);
}

/** 枪是否满足单枪入批前提（数量与同区另由整单校验处理） */
export function gunBlockers(data: Dataset, gun: Gun, now: string = todayISO()): RejectCode[] {
  const codes: RejectCode[] = [];
  if (gunLockedInBatch(data, gun.id)) codes.push("ACTIVE_BATCH");
  if (gun.status !== "营业") codes.push("NOT_OPEN");
  if (daysUntil(gun.validUntil, now) > REMAIN_LIMIT_DAYS) codes.push("DUE_SOON");
  return codes;
}

export function isGunSelectable(data: Dataset, gun: Gun, now: string = todayISO()): boolean {
  return gunBlockers(data, gun, now).length === 0;
}

export function rejectMessage(code: RejectCode): string {
  switch (code) {
    case "COUNT":
      return `同区域需选择 ${MIN_GUNS}-${MAX_GUNS} 把枪`;
    case "AREA":
      return "所选油枪不属于同一区域";
    case "ACTIVE_BATCH":
      return "该枪已有未结束批次";
    case "NOT_OPEN":
      return "枪状态非营业";
    case "DUE_SOON":
      return `检定剩余超过 ${REMAIN_LIMIT_DAYS} 天`;
  }
}

// ---------- 建批：整单校验（任一枪不满足则整单拒绝，原数据不变） ----------

/**
 * 校验建批请求。
 * 规则：
 * 1) 必须选择 2-4 把枪；
 * 2) 全部枪必须同区域；
 * 3) 任一枪已有未结束批次 / 状态非营业 / 检定剩余超过 7 天，整单拒绝。
 */
export function validateCreate(
  data: Dataset,
  gunIds: string[],
  now: string = todayISO()
): { ok: true } | { ok: false; items: RejectItem[] } {
  const items: RejectItem[] = [];
  const ids = [...new Set(gunIds)];

  if (ids.length < MIN_GUNS || ids.length > MAX_GUNS) {
    return { ok: false, items: [{ gunId: "-", code: "COUNT", message: rejectMessage("COUNT") }] };
  }

  const guns = ids
    .map((id) => data.guns.find((g) => g.id === id))
    .filter((g): g is Gun => Boolean(g));

  if (guns.length !== ids.length || new Set(guns.map((g) => g.area)).size !== 1) {
    return { ok: false, items: [{ gunId: "-", code: "AREA", message: rejectMessage("AREA") }] };
  }

  for (const gun of guns) {
    for (const code of gunBlockers(data, gun, now)) {
      items.push({ gunId: gun.id, code, message: rejectMessage(code) });
    }
  }

  return items.length === 0 ? { ok: true } : { ok: false, items };
}

/** 由校验通过的枪号构造进行中批次（锁定枪号与建批油品） */
export function makeBatch(
  data: Dataset,
  gunIds: string[],
  seq: number,
  now: string = todayISO()
): Batch {
  return {
    id: batchId(now, seq),
    area: data.guns.find((g) => g.id === gunIds[0])!.area,
    createdAt: now,
    status: "进行中",
    finishedAt: null,
    rejectNote: null,
    guns: gunIds.map((gunId) => {
      const gun = data.guns.find((g) => g.id === gunId)!;
      return {
        gunId,
        lockedFuel: gun.fuel,
        completedAt: null,
        withdrawnAt: null,
        withdrawReason: null,
        restoredValidUntil: null,
      } satisfies BatchGun;
    }),
  };
}

// ---------- 撤出：枪停用或改油品 ----------

/**
 * 把枪从进行中批次撤出，并记录恢复到的有效期。
 * 恢复值由存储层传入：在批期间枪有效期从未被改写，即枪当前的 validUntil
 * （未参加批次时的原始值 / 上一次完成时延期后的值）。
 * 剩余枪全部撤出后批次自动撤销。
 */
export function withdrawGun(
  batch: Batch,
  gunId: string,
  reason: WithdrawReason,
  restoreValidUntil: string,
  now: string
): void {
  const entry = batch.guns.find((g) => g.gunId === gunId && !g.withdrawnAt);
  if (!entry) return;
  entry.withdrawnAt = now;
  entry.withdrawReason = reason;
  entry.restoredValidUntil = restoreValidUntil;
  if (remainingGunIds(batch).length === 0) {
    batch.status = "已撤销";
    batch.finishedAt = now;
  }
}

export function remainingGunIds(batch: Batch): string[] {
  return batch.guns.filter((g) => !g.withdrawnAt).map((g) => g.gunId);
}

export function remainingEntries(batch: Batch): BatchGun[] {
  return batch.guns.filter((g) => !g.withdrawnAt);
}

// ---------- 完成：按最晚完成日统一延期 180 天 ----------

export function canFinish(batch: Batch): boolean {
  if (batch.status !== "进行中") return false;
  const rest = remainingEntries(batch);
  return rest.length > 0 && rest.every((g) => g.completedAt);
}

/**
 * 完成批次：所有未撤出枪的有效期统一调整为「最晚单枪完成日 + 180 天」。
 * 返回新有效期；存储层负责写回各枪。
 */
export function finishResult(
  batch: Batch,
  now: string = todayISO()
): { finishedAt: string; newValidUntil: string } | null {
  if (!canFinish(batch)) return null;
  const dates = remainingEntries(batch).map((g) => g.completedAt as string).sort();
  const latest = dates[dates.length - 1];
  return { finishedAt: now, newValidUntil: offsetISO(EXTEND_DAYS, latest) };
}

// ---------- ID ----------

export function batchId(now: string, seq: number): string {
  return `B${now.replace(/-/g, "")}-${String(seq).padStart(3, "0")}`;
}

function seedBatchId(seq: number): string {
  return `BSEED-${String(seq).padStart(3, "0")}`;
}
