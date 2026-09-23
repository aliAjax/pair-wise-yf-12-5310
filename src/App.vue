<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import {
  EXTENSION_DAYS,
  REMAINING_LIMIT_DAYS,
  completeBatch,
  createBatch,
  daysUntilDate,
  findOpenBatchForGun,
  findStation,
  gunDisplayName,
  todayISODate,
  validateBatchCreation,
  withdrawGunFromActiveBatch,
  type Area,
  type CalibrationBatch,
  type FuelGun,
  type FuelType,
  type GunStatus,
  type SchedulingState
} from "./scheduling/rules";
import { loadState, resetState, saveState } from "./scheduling/storage";
import { createStationMap, type StationMap } from "./scheduling/mapBoard";

type AreaFilter = "全部区域" | Area;
type NoticeType = "success" | "error" | "info";
interface Notice {
  type: NoticeType;
  title: string;
  details: string[];
}

const state = ref<SchedulingState>(loadState());
const today = ref(todayISODate());
const areaFilter = ref<AreaFilter>("全部区域");
const selectedStationId = ref<string>("all");
const selectedGunIds = ref<string[]>([]);
const completionDates: Record<string, string> = {};
const notice = ref<Notice | null>(null);
const mapElement = ref<HTMLElement | null>(null);

let stationMap: StationMap | null = null;

const areas: Area[] = ["东区", "西区", "机场线"];
const fuelTypes: FuelType[] = ["92#汽油", "95#汽油", "98#汽油", "0#柴油"];
const gunStatuses: GunStatus[] = ["营业", "停用"];

const stations = computed(() => state.value.stations);

const stationById = computed(() =>
  new Map(state.value.stations.map((station) => [station.id, station]))
);

const filteredStations = computed(() =>
  areaFilter.value === "全部区域"
    ? stations.value
    : stations.value.filter((station) => station.area === areaFilter.value)
);

const gunsByStation = computed(() => {
  const map = new Map<string, FuelGun[]>();
  for (const station of state.value.stations) map.set(station.id, []);
  for (const gun of state.value.guns) map.get(gun.stationId)?.push(gun);
  return map;
});

const visibleStations = computed(() =>
  selectedStationId.value === "all"
    ? filteredStations.value
    : filteredStations.value.filter((station) => station.id === selectedStationId.value)
);

const gunsTable = computed(() =>
  visibleStations.value.flatMap((station) =>
    (gunsByStation.value.get(station.id) ?? []).map((gun) => ({ station, gun }))
  )
);

const activeBatches = computed(() =>
  state.value.batches.filter((batch) => batch.status === "进行中")
);

const finishedBatches = computed(() =>
  state.value.batches.filter((batch) => batch.status !== "进行中")
);

const urgentGunCount = computed(
  () =>
    state.value.guns.filter(
      (gun) =>
        gun.status === "营业" &&
        daysUntilDate(gun.validUntil, today.value) <= REMAINING_LIMIT_DAYS &&
        !findOpenBatchForGun(state.value, gun.id)
    ).length
);

const warningStationIds = computed(
  () =>
    new Set(
      state.value.guns
        .filter(
          (gun) =>
            gun.status === "营业" &&
            daysUntilDate(gun.validUntil, today.value) <= REMAINING_LIMIT_DAYS &&
            !findOpenBatchForGun(state.value, gun.id)
        )
        .map((gun) => gun.stationId)
    )
);

const selectedGuns = computed(() =>
  selectedGunIds.value
    .map((id) => state.value.guns.find((gun) => gun.id === id))
    .filter((gun): gun is FuelGun => Boolean(gun))
);

const selectedAreas = computed(() =>
  Array.from(new Set(selectedGuns.value.map((gun) => findStation(state.value, gun.stationId)?.area)))
);

const pendingValidation = computed(() =>
  validateBatchCreation(state.value, selectedGunIds.value, today.value)
);

watch(
  state,
  (value) => {
    saveState(value);
  },
  { deep: true }
);

watch(selectedStationId, (id) => stationMap?.setSelected(id === "all" ? null : id));

function getGun(gunId: string) {
  return state.value.guns.find((gun) => gun.id === gunId);
}

function getOpenBatch(gunId: string) {
  return findOpenBatchForGun(state.value, gunId);
}

function remainingText(gun: FuelGun) {
  const remaining = daysUntilDate(gun.validUntil, today.value);
  if (remaining < 0) return `已逾期 ${Math.abs(remaining)} 天`;
  if (remaining === 0) return "今日到期";
  return `剩余 ${remaining} 天`;
}

function remainingClass(gun: FuelGun) {
  const remaining = daysUntilDate(gun.validUntil, today.value);
  if (remaining < 0) return "danger-text";
  if (remaining <= REMAINING_LIMIT_DAYS) return "warning-text";
  return "muted-text";
}

function isDue(gun: FuelGun) {
  return daysUntilDate(gun.validUntil, today.value) <= REMAINING_LIMIT_DAYS;
}

function toggleGun(gun: FuelGun, checked: boolean) {
  notice.value = null;
  if (checked) {
    if (!selectedGunIds.value.includes(gun.id)) selectedGunIds.value.push(gun.id);
  } else {
    selectedGunIds.value = selectedGunIds.value.filter((id) => id !== gun.id);
  }
}

function clearSelection() {
  selectedGunIds.value = [];
  notice.value = null;
}

function setAreaFilter(area: AreaFilter) {
  areaFilter.value = area;
  selectedStationId.value = "all";
}

function selectStation(stationId: string) {
  const station = stationById.value.get(stationId);
  if (!station) return;
  selectedStationId.value = stationId;
  areaFilter.value = station.area;
}

function setNotice(type: NoticeType, title: string, details: string[] = []) {
  notice.value = { type, title, details };
}

function submitBatch() {
  const result = createBatch(state.value, selectedGunIds.value, today.value);
  if (!result.ok) {
    setNotice("error", result.message, result.reasons);
    return;
  }

  for (const gunId of selectedGunIds.value) completionDates[gunId] = today.value;
  selectedGunIds.value = [];
  setNotice("success", `批次 ${result.data.batchId} 已创建，枪号已锁定。`, [
    `完成检定后将按最晚完成日统一延期 ${EXTENSION_DAYS} 天。`
  ]);
}

function completionValue(gunId: string) {
  return completionDates[gunId] ?? today.value;
}

function setCompletionDate(gunId: string, event: Event) {
  completionDates[gunId] = (event.target as HTMLInputElement).value;
}

function finishBatch(batch: CalibrationBatch) {
  const payload = Object.fromEntries(
    batch.guns
      .filter((item) => !item.withdrawn)
      .map((item) => [item.gunId, completionValue(item.gunId)])
  );
  const result = completeBatch(state.value, batch.id, payload);
  if (!result.ok) {
    setNotice("error", result.message, result.reasons);
    return;
  }

  selectedGunIds.value = selectedGunIds.value.filter(
    (gunId) => !batch.guns.some((item) => item.gunId === gunId)
  );
  setNotice("success", `批次 ${batch.id} 已完成。`, [
    `在册枪号有效期统一延期至 ${result.data.extendedUntil}。`
  ]);
}

function reportWithdrawal(gun: FuelGun, batchId: string, batchEnded: boolean) {
  setNotice(
    "info",
    `${gunDisplayName(state.value, gun)} 已自动撤出批次 ${batchId}。`,
    [
      "枪号已恢复批次创建前的原检定有效期。",
      batchEnded ? "该批次已无在册枪号，批次结束。" : "批次继续锁定其余枪号。"
    ]
  );
}

function changeGunStatus(gun: FuelGun, event: Event) {
  const nextStatus = (event.target as HTMLSelectElement).value as GunStatus;
  if (nextStatus === gun.status) return;

  const result =
    nextStatus === "停用"
      ? withdrawGunFromActiveBatch(state.value, gun.id, "枪号停用", today.value)
      : undefined;

  gun.status = nextStatus;
  if (result) reportWithdrawal(gun, result.batchId, result.batchEnded);
}

function changeGunFuel(gun: FuelGun, event: Event) {
  const nextFuel = (event.target as HTMLSelectElement).value as FuelType;
  if (nextFuel === gun.fuelType) return;

  const previousFuel = gun.fuelType;
  const result = withdrawGunFromActiveBatch(
    state.value,
    gun.id,
    `油品由${previousFuel}改为${nextFuel}`,
    today.value
  );

  gun.fuelType = nextFuel;
  if (result) reportWithdrawal(gun, result.batchId, result.batchEnded);
}

function deactivateAndWithdraw(gunId: string) {
  const gun = getGun(gunId);
  if (!gun) return;
  const result = withdrawGunFromActiveBatch(state.value, gunId, "枪号停用", today.value);
  gun.status = "停用";
  if (result) reportWithdrawal(gun, result.batchId, result.batchEnded);
}

function batchActiveCount(batch: CalibrationBatch) {
  return batch.guns.filter((item) => !item.withdrawn).length;
}

function resetDemo() {
  const confirmed = window.confirm("将清空浏览器中的排期改动并恢复五座油站预置数据，是否继续？");
  if (!confirmed) return;
  state.value = resetState();
  selectedGunIds.value = [];
  selectedStationId.value = "all";
  areaFilter.value = "全部区域";
  Object.keys(completionDates).forEach((key) => delete completionDates[key]);
  setNotice("success", "已恢复浏览器本地预置数据。");
}

onMounted(() => {
  if (!mapElement.value) return;
  stationMap = createStationMap(
    mapElement.value,
    stations.value,
    selectedStationId.value === "all" ? null : selectedStationId.value,
    selectStation
  );
  stationMap.setWarnings(warningStationIds.value);

  watch(warningStationIds, (ids) => stationMap?.setWarnings(ids));
});

onBeforeUnmount(() => {
  stationMap?.remove();
  stationMap = null;
});
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油计量 · 浏览器本地闭环</p>
          <h1>油站计量枪检定排期台</h1>
          <p class="subtitle">
            预置五座油站、十五把加油枪和区域地图。勾选同区域 2–4 把营业且 7 日内到期的枪号建立检定批次。
          </p>
        </div>
        <div class="header-actions">
          <span class="storage-note">数据仅保存于 localStorage</span>
          <button class="secondary" type="button" @click="resetDemo">恢复预置数据</button>
        </div>
      </header>

      <section class="metrics">
        <article class="metric">
          <span>预置油站</span>
          <strong>{{ state.stations.length }}</strong>
        </article>
        <article class="metric">
          <span>加油枪</span>
          <strong>{{ state.guns.length }}</strong>
        </article>
        <article class="metric">
          <span>进行中批次</span>
          <strong>{{ activeBatches.length }}</strong>
        </article>
        <article class="metric urgent">
          <span>待排期枪号</span>
          <strong>{{ urgentGunCount }}</strong>
        </article>
      </section>

      <section class="map-panel">
        <div class="section-heading">
          <div>
            <h2>油站区域地图</h2>
            <p>点击地图标记或油站卡片可筛选枪号；红点表示存在 7 日内到期且未入批次的营业枪。</p>
          </div>
          <div class="area-tabs">
            <button
              type="button"
              :class="{ active: areaFilter === '全部区域' }"
              @click="setAreaFilter('全部区域')"
            >
              全部区域
            </button>
            <button
              v-for="area in areas"
              :key="area"
              type="button"
              :class="{ active: areaFilter === area }"
              @click="setAreaFilter(area)"
            >
              {{ area }}
            </button>
          </div>
        </div>
        <div class="map-layout">
          <div ref="mapElement" class="leaflet-map" />
          <div class="station-cards">
            <button
              v-for="station in filteredStations"
              :key="station.id"
              type="button"
              class="station-card"
              :class="{ selected: selectedStationId === station.id, warning: warningStationIds.has(station.id) }"
              @click="selectStation(station.id)"
            >
              <span class="station-area">{{ station.area }}</span>
              <strong>{{ station.name }}</strong>
              <small>{{ station.address }}</small>
              <span>{{ gunsByStation.get(station.id)?.length ?? 0 }} 把加油枪</span>
            </button>
          </div>
        </div>
      </section>

      <section class="schedule-grid">
        <section class="panel gun-panel">
          <div class="panel-title">
            <div>
              <h2>加油枪选择</h2>
              <p>整单校验，任一枪不满足条件则不创建批次，原批次和标记保持不变。</p>
            </div>
            <button class="secondary small" type="button" :disabled="selectedGunIds.length === 0" @click="clearSelection">
              清空勾选
            </button>
          </div>

          <div class="selection-summary" :class="pendingValidation.ok ? 'valid' : 'invalid'">
            <div>
              <strong>已选 {{ selectedGunIds.length }} 把</strong>
              <span>
                区域：
                <template v-if="selectedAreas.length === 0">未选择</template>
                <template v-else>{{ selectedAreas.join("、") }}</template>
              </span>
            </div>
            <button type="button" :disabled="!pendingValidation.ok" @click="submitBatch">建立检定批次</button>
          </div>

          <ul v-if="!pendingValidation.ok && selectedGunIds.length > 0" class="validation-list">
            <li v-for="reason in pendingValidation.reasons" :key="reason">{{ reason }}</li>
          </ul>

          <div class="gun-table-wrap">
            <table class="gun-table">
              <thead>
                <tr>
                  <th>选择</th>
                  <th>油站 / 枪号</th>
                  <th>油品</th>
                  <th>枪状态</th>
                  <th>有效期</th>
                  <th>当前批次</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="{ station, gun } in gunsTable" :key="gun.id" :class="{ selected: selectedGunIds.includes(gun.id) }">
                  <td>
                    <input
                      type="checkbox"
                      :checked="selectedGunIds.includes(gun.id)"
                      @change="toggleGun(gun, ($event.target as HTMLInputElement).checked)"
                    />
                  </td>
                  <td>
                    <strong>{{ station.name }} {{ gun.gunNo }}</strong>
                    <small>{{ station.area }}</small>
                  </td>
                  <td>
                    <select class="table-select" :value="gun.fuelType" @change="changeGunFuel(gun, $event)">
                      <option v-for="fuel in fuelTypes" :key="fuel" :value="fuel">{{ fuel }}</option>
                    </select>
                  </td>
                  <td>
                    <select
                      class="table-select"
                      :class="gun.status === '停用' ? 'stopped' : ''"
                      :value="gun.status"
                      @change="changeGunStatus(gun, $event)"
                    >
                      <option v-for="status in gunStatuses" :key="status" :value="status">{{ status }}</option>
                    </select>
                  </td>
                  <td>
                    <span :class="remainingClass(gun)">{{ gun.validUntil }}</span>
                    <small :class="remainingClass(gun)">{{ remainingText(gun) }}</small>
                  </td>
                  <td>
                    <span v-if="getOpenBatch(gun.id)" class="batch-pill">
                      已锁定 {{ getOpenBatch(gun.id)?.id }}
                    </span>
                    <span v-else-if="gun.status === '营业' && isDue(gun)" class="due-pill">可建批</span>
                    <span v-else class="muted-text">—</span>
                  </td>
                </tr>
                <tr v-if="gunsTable.length === 0">
                  <td colspan="6" class="empty-cell">当前区域暂无油站</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <aside class="panel rules-panel">
          <h2>建批规则</h2>
          <ol>
            <li>同一区域选择 2–4 把枪，跨区域整单拒绝。</li>
            <li>任一枪已有未结束批次、枪状态不是营业，或检定剩余超过 7 天，整单拒绝。</li>
            <li>建批成功后只锁定枪号，不提前延长有效期。</li>
            <li>完成时按各枪最晚完成日，将全部在册枪号统一延期 {{ EXTENSION_DAYS }} 天。</li>
            <li>批次期间停用或改油品，该枪自动撤出并恢复原有效期。</li>
          </ol>

          <div v-if="notice" class="notice" :class="notice.type">
            <strong>{{ notice.title }}</strong>
            <ul v-if="notice.details.length">
              <li v-for="item in notice.details" :key="item">{{ item }}</li>
            </ul>
          </div>
        </aside>
      </section>

      <section class="batch-grid">
        <section class="panel">
          <div class="panel-title">
            <div>
              <h2>进行中批次</h2>
              <p>批次锁定建批时的枪号、油站和油品信息。</p>
            </div>
          </div>

          <div v-if="activeBatches.length === 0" class="empty-block">暂无进行中批次</div>

          <article v-for="batch in activeBatches" :key="batch.id" class="batch-card">
            <header>
              <div>
                <span class="batch-id">{{ batch.id }}</span>
                <strong>{{ batch.area }} · {{ batchActiveCount(batch) }} 把在册</strong>
              </div>
              <span class="open-status">进行中</span>
            </header>

            <div class="batch-guns">
              <div v-for="item in batch.guns" :key="item.gunId" class="batch-gun" :class="{ withdrawn: item.withdrawn }">
                <div v-if="item.withdrawn" class="batch-gun-main">
                  <strong>{{ stationById.get(item.stationId)?.name }} {{ item.gunNo }}</strong>
                  <span>锁定油品：{{ item.fuelType }} ｜ 原有效期：{{ item.previousValidUntil }}</span>
                  <em>已撤出：{{ item.withdrawReason }}</em>
                  <small>已恢复原有效期；撤出日期 {{ item.withdrawnAt }}</small>
                </div>
                <template v-else>
                  <div class="batch-gun-main">
                    <strong>{{ stationById.get(item.stationId)?.name }} {{ item.gunNo }}</strong>
                    <span>锁定油品：{{ item.fuelType }} ｜ 原有效期：{{ item.previousValidUntil }}</span>
                  </div>
                  <div class="completion-control">
                  <label>
                    完成日期
                    <input
                      type="date"
                      :min="batch.createdAt"
                      :value="completionValue(item.gunId)"
                      @input="setCompletionDate(item.gunId, $event)"
                    />
                  </label>
                  <button class="secondary small" type="button" @click="deactivateAndWithdraw(item.gunId)">
                    模拟停用
                  </button>
                  </div>
                </template>
              </div>
            </div>

            <footer v-if="batchActiveCount(batch) > 0">
              <p>完成后按最晚完成日统一延期 {{ EXTENSION_DAYS }} 天。</p>
              <button type="button" @click="finishBatch(batch)">完成检定并延期</button>
            </footer>
          </article>
        </section>

        <section class="panel history-panel">
          <h2>批次记录</h2>
          <div v-if="finishedBatches.length === 0" class="empty-block">暂无已结束批次</div>
          <article v-for="batch in finishedBatches" :key="batch.id" class="history-item">
            <div>
              <strong>{{ batch.id }}</strong>
              <span>{{ batch.area }}</span>
            </div>
            <span class="history-status" :class="batch.status">{{ batch.status }}</span>
            <p v-if="batch.status === '已完成'">
              最晚完成 {{ batch.completedAt }}，统一延期至 {{ batch.extendedUntil }}
            </p>
            <p v-else>在册枪号全部撤出，未执行延期。</p>
            <small>
              完成 {{ batch.guns.filter((gun) => gun.completedAt).length }} 把 ·
              撤出 {{ batch.guns.filter((gun) => gun.withdrawn).length }} 把
            </small>
          </article>
        </section>
      </section>
    </div>
  </main>
</template>
