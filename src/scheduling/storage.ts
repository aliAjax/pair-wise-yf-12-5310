import { addDaysToISODate, type SchedulingState, todayISODate } from "./rules";

export const STORAGE_KEY = "oil-gun-calibration-schedule-v1";
export const STORAGE_VERSION = 1;

export function createSeedState(): SchedulingState {
  const today = todayISODate();
  const due = (days: number) => addDaysToISODate(today, days);

  const stations = [
    {
      id: "station-east-1",
      name: "滨江东一站",
      area: "东区",
      address: "江湾大道 88 号",
      mapX: 148,
      mapY: 105
    },
    {
      id: "station-east-2",
      name: "云桥东站",
      area: "东区",
      address: "云桥路 216 号",
      mapX: 286,
      mapY: 176
    },
    {
      id: "station-west-1",
      name: "青枫西站",
      area: "西区",
      address: "青枫路 19 号",
      mapX: 515,
      mapY: 116
    },
    {
      id: "station-west-2",
      name: "临港西站",
      area: "西区",
      address: "临港大道 520 号",
      mapX: 632,
      mapY: 246
    },
    {
      id: "station-airport-1",
      name: "空港快线站",
      area: "机场线",
      address: "机场路 T2 连接线",
      mapX: 418,
      mapY: 350
    }
  ] as const;

  const guns = [
    { stationId: stations[0].id, gunNo: "01", fuelType: "92#汽油", status: "营业", offset: 3 },
    { stationId: stations[0].id, gunNo: "02", fuelType: "95#汽油", status: "营业", offset: 6 },
    { stationId: stations[0].id, gunNo: "03", fuelType: "0#柴油", status: "营业", offset: 96 },

    { stationId: stations[1].id, gunNo: "01", fuelType: "92#汽油", status: "营业", offset: 1 },
    { stationId: stations[1].id, gunNo: "02", fuelType: "98#汽油", status: "停用", offset: 4 },
    { stationId: stations[1].id, gunNo: "03", fuelType: "95#汽油", status: "营业", offset: 25 },

    { stationId: stations[2].id, gunNo: "01", fuelType: "95#汽油", status: "营业", offset: 0 },
    { stationId: stations[2].id, gunNo: "02", fuelType: "0#柴油", status: "营业", offset: 5 },
    { stationId: stations[2].id, gunNo: "03", fuelType: "92#汽油", status: "营业", offset: 72 },

    { stationId: stations[3].id, gunNo: "01", fuelType: "92#汽油", status: "营业", offset: 2 },
    { stationId: stations[3].id, gunNo: "02", fuelType: "95#汽油", status: "停用", offset: 3 },
    { stationId: stations[3].id, gunNo: "03", fuelType: "0#柴油", status: "营业", offset: 48 },

    { stationId: stations[4].id, gunNo: "01", fuelType: "95#汽油", status: "营业", offset: 7 },
    { stationId: stations[4].id, gunNo: "02", fuelType: "0#柴油", status: "营业", offset: 14 },
    { stationId: stations[4].id, gunNo: "03", fuelType: "92#汽油", status: "停用", offset: -6 }
  ] as const;

  return {
    stations: stations.map((station) => ({ ...station })),
    guns: guns.map((gun, index) => ({
      id: `gun-${String(index + 1).padStart(2, "0")}`,
      stationId: gun.stationId,
      gunNo: gun.gunNo,
      fuelType: gun.fuelType,
      status: gun.status,
      validUntil: due(gun.offset)
    })),
    batches: []
  };
}

function isState(value: unknown): value is SchedulingState & { version?: number } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SchedulingState>;
  return Array.isArray(candidate.stations) && Array.isArray(candidate.guns) && Array.isArray(candidate.batches);
}

export function loadState(): SchedulingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeedState();
    const parsed: unknown = JSON.parse(raw);
    if (isState(parsed)) {
      return {
        stations: parsed.stations,
        guns: parsed.guns,
        batches: parsed.batches
      };
    }
  } catch (error) {
    console.warn("无法读取本地检定排期数据，已恢复预置数据。", error);
  }
  return createSeedState();
}

export function saveState(state: SchedulingState) {
  const payload = {
    version: STORAGE_VERSION,
    savedAt: new Date().toISOString(),
    stations: state.stations,
    guns: state.guns,
    batches: state.batches
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function resetState(): SchedulingState {
  const seed = createSeedState();
  saveState(seed);
  return seed;
}
