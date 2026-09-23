# 油站计量枪检定排期台

- 行业：石油
- 技术栈：Vue3、Vite、TypeScript、Leaflet
- 启动：`npm install && npm run dev`
- 构建：`npm run build`

功能预置五座油站、十五把加油枪和区域地图。仅可在同区域选择 2–4 把营业且检定剩余不超过 7 天的加油枪建批；任一条件不满足时整单拒绝且不改原数据。批次完成后按最晚完成日统一延期 180 天；批次期间停用枪号或变更油品会自动撤出该枪并恢复原有效期。

代码按规则、存储、界面拆分为 `src/scheduling/rules.ts`、`src/scheduling/storage.ts` 和 `src/scheduling/mapBoard.ts`（界面交互在 `src/App.vue`），所有数据仅保存在浏览器 `localStorage` 中，不访问后端。
