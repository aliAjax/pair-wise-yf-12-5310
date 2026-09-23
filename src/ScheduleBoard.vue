<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AREAS,
  EXTEND_DAYS,
  FUEL_TYPES,
  GUN_STATUSES,
  MAX_GUNS,
  MIN_GUNS,
  REMAIN_LIMIT_DAYS,
  canFinish,
  daysUntil,
  gunBlockers,
  offsetISO,
  remainingEntries,
  rejectMessage,
  todayISO,
  type Batch,
  type Gun,
  type RejectCode,
  type Station,
} from "./rules";
import { useStore } from "./storage";

const store = useStore();
const { state } = store;

// ---------- 地图 ----------

const mapEl = ref<HTMLElement | null>(null);
const selectedStationId = ref<string>("S1");
let map: L.Map | null = null;
const markers = new Map<string, L.Marker>();

function pinIcon(station: Station, selected: boolean): L.DivIcon {
  const locked = store.state.guns.some(
    (g) => g.stationId === station.id && store.batchOfGun(g.id)
  );
  const color = selected ? "#c84b31" : locked ? "#b8860b" : "#176b87";
  return L.divIcon({
    className: "",
    iconSize: [30, 38],
    iconAnchor: [15, 38],
    html: `<div style="position:relative;width:30px;height:38px">
      <svg width="30" height="38" viewBox="0 0 30 38">
        <path d="M15 0C6.7 0 0 6.7 0 15c0 10 15 23 15 23s15-13 15-23C30 6.7 23.3 0 15 0z" fill="${color}" stroke="#fff" stroke-width="2"/>
        <circle cx="15" cy="15" r="6" fill="#fff"/>
      </svg>
    </div>`,
  });
}

function refreshMarkers() {
  for (const [id, marker] of markers) {
    const station = store.getStation(id);
    if (station) marker.setIcon(pinIcon(station, id === selectedStationId.value));
  }
}

function focusStation(station: Station) {
  selectedStationId.value = station.id;
  if (map) map.flyTo([station.lat, station.lng], 13, { duration: 0.4 });
  refreshMarkers();
}

onMounted(() => {
  if (!mapEl.value) return;
  map = L.map(mapEl.value, { zoomControl: true, attributionControl: false }).setView(
    [30.66, 104.07],
    11
  );
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    // 离线/内网环境底图加载失败时保留灰色坐标底图与站点标记
    crossOrigin: true,
  }).addTo(map);

  for (const station of state.stations) {
    const marker = L.marker([station.lat, station.lng], {
      icon: pinIcon(station, station.id === selectedStationId.value),
      title: station.name,
    })
      .addTo(map)
      .bindPopup(
        `<b>${station.name}</b><br/>${station.area} · ${station.address}<br/>` +
          `油枪 ${state.guns.filter((g) => g.stationId === station.id).length} 把`
      )
      .on("click", () => focusStation(station));
    markers.set(station.id, marker);
  }
  nextTick(() => map?.invalidateSize());
});

// ---------- 筛选与选择 ----------

const areaFilter = ref<"全部区域" | (typeof AREAS)[number]>("全部区域");

const visibleStations = computed<Station[]>(() =>
  areaFilter.value === "全部区域"
    ? state.stations
    : state.stations.filter((s) => s.area === areaFilter.value)
);

function gunsOfStation(stationId: string): Gun[] {
  return state.guns.filter((g) => g.stationId === stationId);
}

const selectedGunIds = ref<string[]>([]);

const selectionArea = computed<string | null>(() => {
  const first = selectedGunIds.value[0];
  return first ? store.getGun(first)?.area ?? null : null;
});

function isChecked(gun: Gun): boolean {
  return selectedGunIds.value.includes(gun.id);
}

function blockedChips(gun: Gun): RejectCode[] {
  return gunBlockers(state, gun);
}

function toggleGun(gun: Gun) {
  const idx = selectedGunIds.value.indexOf(gun.id);
  if (idx >= 0) {
    selectedGunIds.value.splice(idx, 1);
    return;
  }
  if (selectedGunIds.value.length >= MAX_GUNS) {
    pushNotice("warn", `单批次最多选择 ${MAX_GUNS} 把枪`);
    return;
  }
  if (selectionArea.value && gun.area !== selectionArea.value) {
    pushNotice("warn", `本批次已限定 ${selectionArea.value}，不能跨区域选枪`);
    return;
  }
  const blockers = blockedChips(gun);
  if (blockers.length > 0) {
    pushNotice("warn", `${gun.id} 不可入批：${blockers.map(rejectMessage).join("、")}`);
    return;
  }
  selectedGunIds.value.push(gun.id);
}

function clearSelection() {
  selectedGunIds.value = [];
  rejects.value = [];
}

// ---------- 建批 ----------

const rejects = ref<{ gunId: string; message: string }[]>([]);

function submitBatch() {
  const result = store.createBatch(selectedGunIds.value);
  if (!result.ok) {
    // 整单拒绝：原批次与标记不变，仅展示拒绝原因
    rejects.value = result.rejects;
    pushNotice("error", "整单拒绝：存在不符合建批条件的油枪");
    return;
  }
  rejects.value = [];
  pushNotice("success", `批次 ${result.batchId} 已建立，枪号已锁定`);
  selectedGunIds.value = [];
}

// ---------- 批次操作 ----------

const sortedBatches = computed<Batch[]>(() =>
  [...state.batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
);

function batchStationName(gunId: string): string {
  const gun = store.getGun(gunId);
  return gun ? store.getStation(gun.stationId)?.name ?? "" : "";
}

function completionPreview(batch: Batch): { latest: string; next: string } | null {
  const dates = remainingEntries(batch)
    .map((g) => g.completedAt)
    .filter((d): d is string => Boolean(d))
    .sort();
  if (dates.length === 0) return null;
  const latest = dates[dates.length - 1];
  return { latest, next: offsetISO(EXTEND_DAYS, latest) };
}

function finishBatch(batch: Batch) {
  if (store.completeBatch(batch.id)) {
    const preview = completionPreview(batch);
    pushNotice(
      "success",
      `批次 ${batch.id} 完成，在批枪统一延期至 ${preview?.next ?? ""}`
    );
    refreshMarkers();
  }
}

function onMarkDate(batchId: string, gunId: string, ev: Event) {
  const value = (ev.target as HTMLInputElement).value;
  store.markCompleted(batchId, gunId, value);
}

function onStatusChange(gun: Gun, ev: Event) {
  const value = (ev.target as HTMLSelectElement).value as Gun["status"];
  const wasLocked = Boolean(store.batchOfGun(gun.id));
  store.setGunStatus(gun.id, value);
  if (wasLocked && value !== "营业") {
    pushNotice("warn", `${gun.id} 已停用，自动撤出未结束批次并恢复原有效期`);
    selectedGunIds.value = selectedGunIds.value.filter((id) => id !== gun.id);
  }
  refreshMarkers();
}

function onFuelChange(gun: Gun, ev: Event) {
  const value = (ev.target as HTMLSelectElement).value as Gun["fuel"];
  const wasLocked = Boolean(store.batchOfGun(gun.id));
  store.setGunFuel(gun.id, value);
  if (wasLocked) {
    pushNotice("warn", `${gun.id} 改油品已自动撤出批次，原有效期不变`);
    selectedGunIds.value = selectedGunIds.value.filter((id) => id !== gun.id);
  }
}

// ---------- 提示条 ----------

interface Notice {
  id: number;
  type: "success" | "warn" | "error";
  text: string;
}
const notices = reactive<Notice[]>([]);
let noticeSeq = 0;

function pushNotice(type: Notice["type"], text: string) {
  const id = ++noticeSeq;
  notices.push({ id, type, text });
  window.setTimeout(() => {
    const i = notices.findIndex((n) => n.id === id);
    if (i >= 0) notices.splice(i, 1);
  }, 4200);
}

function resetData() {
  if (!window.confirm("恢复预置五座油站数据？浏览器内所有排期记录将被清空。")) return;
  store.resetAll();
  selectedGunIds.value = [];
  rejects.value = [];
  refreshMarkers();
  pushNotice("success", "已恢复预置数据");
}

// ---------- 指标 ----------

const metrics = computed(() => [
  { label: "油站", value: state.stations.length },
  { label: "油枪", value: state.guns.length },
  { label: "在批锁定枪", value: store.lockedGunCount() },
  { label: "进行中批次", value: store.activeBatchCount() },
]);

const now = todayISO();
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">强制检定 · 计量枪排期</p>
          <h1>油站计量枪检定排期台</h1>
          <p class="subtitle">
            框选同区域 2-4 把营业中且 7 天内到期的油枪建立检定批次；完成后按最晚完成日统一延期
            {{ EXTEND_DAYS }} 天，停用或改油品自动撤出。数据仅保存在本浏览器。
          </p>
        </div>
        <div class="head-actions">
          <div class="stack">
            <span class="tag">Vue3</span>
            <span class="tag">TypeScript</span>
            <span class="tag">Leaflet</span>
            <span class="tag">localStorage</span>
          </div>
          <button class="secondary" type="button" @click="resetData">恢复预置数据</button>
        </div>
      </header>

      <transition-group name="notice" tag="div" class="notices">
        <div v-for="n in notices" :key="n.id" class="notice" :class="n.type">{{ n.text }}</div>
      </transition-group>

      <section class="rules">
        <strong>排期规则</strong>
        <span>① 同区域选 {{ MIN_GUNS }}-{{ MAX_GUNS }} 把枪建批</span>
        <span>② 任一枪已有未结束批次、非营业或检定剩余超过 {{ REMAIN_LIMIT_DAYS }} 天，整单拒绝，原批次与标记不变</span>
        <span>③ 批次锁定枪号；完成后按最晚完成日统一延期 {{ EXTEND_DAYS }} 天</span>
        <span>④ 在批期间枪停用或改油品，自动撤出并恢复原有效期</span>
      </section>

      <section class="metrics">
        <article v-for="m in metrics" :key="m.label" class="metric">
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
        </article>
      </section>

      <div class="board">
        <!-- 左：地图 + 油站 -->
        <aside class="left-col">
          <div ref="mapEl" class="map" />
          <div class="station-list panel">
            <h2>油站（{{ visibleStations.length }}）</h2>
            <button
              v-for="s in visibleStations"
              :key="s.id"
              type="button"
              class="station-row"
              :class="{ active: s.id === selectedStationId }"
              @click="focusStation(s)"
            >
              <span class="dot" :class="s.area" />
              <span class="station-text">
                <b>{{ s.name }}</b>
                <small>{{ s.area }} · {{ s.address }}</small>
              </span>
              <span class="station-count">{{ gunsOfStation(s.id).length }} 枪</span>
            </button>
          </div>
        </aside>

        <!-- 右：选枪建批 + 批次 -->
        <section class="right-col">
          <div class="panel">
            <div class="toolbar">
              <h2>选择油枪建批</h2>
              <div class="filters">
                <button
                  v-for="a in ['全部区域', ...AREAS]"
                  :key="a"
                  type="button"
                  class="chip"
                  :class="{ on: areaFilter === a }"
                  @click="areaFilter = a as typeof areaFilter"
                >
                  {{ a }}
                </button>
              </div>
            </div>

            <div class="select-bar">
              <span>
                已选 <b>{{ selectedGunIds.length }}</b>/{{ MAX_GUNS }} 把
                <template v-if="selectionArea">（{{ selectionArea }}）</template>
              </span>
              <div class="select-actions">
                <button class="link" type="button" :disabled="!selectedGunIds.length" @click="clearSelection">
                  清空
                </button>
                <button
                  type="button"
                  :disabled="selectedGunIds.length < MIN_GUNS"
                  @click="submitBatch"
                >
                  建立检定批次
                </button>
              </div>
            </div>

            <div v-if="rejects.length" class="reject-box">
              <p class="reject-title">整单拒绝（未写入任何数据）</p>
              <ul>
                <li v-for="(r, i) in rejects" :key="i">
                  <template v-if="r.gunId !== '-'">枪号 {{ r.gunId }}：</template>{{ r.message }}
                </li>
              </ul>
            </div>

            <div class="gun-table">
              <template v-for="s in visibleStations" :key="s.id">
                <p class="gun-group">{{ s.name }}（{{ s.area }}）</p>
                <div
                  v-for="gun in gunsOfStation(s.id)"
                  :key="gun.id"
                  class="gun-row"
                  :class="{ checked: isChecked(gun) }"
                  @click="toggleGun(gun)"
                >
                  <span class="gun-check">
                    <input type="checkbox" :checked="isChecked(gun)" readonly @click.stop="toggleGun(gun)" />
                  </span>
                  <span class="gun-id">{{ gun.id }}</span>
                  <span class="gun-fuel">
                    <select :value="gun.fuel" @click.stop @change="onFuelChange(gun, $event)">
                      <option v-for="f in FUEL_TYPES" :key="f" :value="f">{{ f }}</option>
                    </select>
                  </span>
                  <span class="gun-status">
                    <select :value="gun.status" @click.stop @change="onStatusChange(gun, $event)">
                      <option v-for="st in GUN_STATUSES" :key="st" :value="st">{{ st }}</option>
                    </select>
                  </span>
                  <span class="gun-date">{{ gun.validUntil }}</span>
                  <span class="gun-days" :class="daysUntil(gun.validUntil, now) <= REMAIN_LIMIT_DAYS ? 'soon' : 'late'">
                    剩 {{ daysUntil(gun.validUntil, now) }} 天
                  </span>
                  <span class="gun-tags">
                    <em v-if="store.batchOfGun(gun.id)" class="tag-mini lock">
                      在批 {{ store.batchOfGun(gun.id)!.id }}
                    </em>
                    <em v-if="gun.status !== '营业'" class="tag-mini stop">{{ gun.status }}</em>
                    <em
                      v-if="daysUntil(gun.validUntil, now) > REMAIN_LIMIT_DAYS"
                      class="tag-mini late-tag"
                    >
                      未到期
                    </em>
                    <em v-if="!blockedChips(gun).length" class="tag-mini ok">可入批</em>
                  </span>
                </div>
              </template>
            </div>
          </div>

          <div class="panel">
            <div class="toolbar">
              <h2>检定批次（{{ sortedBatches.length }}）</h2>
            </div>

            <div v-if="!sortedBatches.length" class="empty">暂无批次</div>

            <article v-for="b in sortedBatches" :key="b.id" class="batch" :class="b.status">
              <div class="batch-head">
                <div>
                  <b>{{ b.id }}</b>
                  <span class="batch-area">{{ b.area }}</span>
                </div>
                <span class="batch-state" :class="b.status">{{ b.status }}</span>
              </div>
              <p class="batch-meta">
                建批 {{ b.createdAt }}
                <template v-if="b.finishedAt"> · 结束 {{ b.finishedAt }}</template>
              </p>

              <div class="batch-guns">
                <div v-for="bg in b.guns" :key="bg.gunId" class="batch-gun" :class="{ out: bg.withdrawnAt }">
                  <div class="bg-main">
                    <b>{{ bg.gunId }}</b>
                    <small>{{ batchStationName(bg.gunId) }}</small>
                    <span class="lock-fuel">锁定油品：{{ bg.lockedFuel }}</span>
                  </div>
                  <div v-if="bg.withdrawnAt" class="bg-out">
                    已撤出（{{ bg.withdrawReason }}，{{ bg.withdrawnAt }}）· 有效期恢复
                    {{ bg.restoredValidUntil }}
                  </div>
                  <div v-else class="bg-edit">
                    <label v-if="b.status === '进行中'">
                      完成日
                      <input
                        type="date"
                        :value="bg.completedAt ?? ''"
                        :max="now"
                        @change="onMarkDate(b.id, bg.gunId, $event)"
                      />
                    </label>
                    <span v-else class="done-date">完成日：{{ bg.completedAt ?? "-" }}</span>
                  </div>
                </div>
              </div>

              <div v-if="b.status === '进行中'" class="batch-foot">
                <span v-if="completionPreview(b)" class="extend-preview">
                  最晚完成 {{ completionPreview(b)!.latest }} → 统一延期至
                  <b>{{ completionPreview(b)!.next }}</b>
                </span>
                <span v-else class="extend-preview muted">全部在批枪登记完成日后可结束批次</span>
                <button type="button" :disabled="!canFinish(b)" @click="finishBatch(b)">
                  完成本批并延期 {{ EXTEND_DAYS }} 天
                </button>
              </div>
            </article>
          </div>
        </section>
      </div>
    </div>
  </main>
</template>
