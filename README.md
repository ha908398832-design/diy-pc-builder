# 装机助手

[![CI](https://github.com/ha908398832-design/diy-pc-builder/actions/workflows/ci.yml/badge.svg)](https://github.com/ha908398832-design/diy-pc-builder/actions/workflows/ci.yml)

**单文件离线网页版的 DIY 装机选配与兼容性校验工具。**

双击 `dist/装机助手.html` 即用 —— 无需安装、无需联网、无外部依赖。

```
8 大品类 · 716 个硬件型号 · 32 条兼容性规则 · 500 项测试 · 零依赖
```

[MIT 许可](LICENSE) · [贡献指南](CONTRIBUTING.md) · [数据来源与合规声明](NOTICE.md) · [安全策略](SECURITY.md) · [行为准则](CODE_OF_CONDUCT.md) · [更新日志](CHANGELOG.md)

---

## 它能做什么

| 能力 | 说明 |
|---|---|
| **选件** | 8 品类共 716 个型号，别名模糊搜索（`7800x3d`、`4070S`、`小雕` 都能命中） |
| **看参数** | 芯片级归并 + 型号级明细；勾选 2~4 个可并排对比，差异项自动高亮 |
| **查兼容** | 32 条规则自动校验，每条给出**原因**与**怎么改** |
| **算功耗** | CPU 取**峰值功耗**（不是标称 TDP），给出建议电源瓦数与余量 |
| **存方案** | 多方案保存 / 切换 / 重命名 / 删除（带二次确认） |
| **导出清单** | xlsx / csv / 文本三种格式 |
| **可扩充** | 用 CSV 模板自己加型号，支持覆盖 / 跳过 / 并存三种重名策略 |

### 32 条兼容性规则

- 🔴 **17 条错误**：插槽不符、内存代数不符、机箱装不下、显卡超长/超厚、电源瓦数或接口不足、无核显又无独显……
- 🟡 **11 条警告**：电源余量 <20%、散热压不住、内存需降频、老主板要刷 BIOS、PCIe 降速……
- 🔵 **4 条提示**：电源买太大、升级空间、平台末期、二手风险

> **只提示不拦截** —— 不兼容的型号照样能选中，软件只负责醒目提醒并在导出清单里标注。

### 芯片级归并

同一芯片在不同品牌/版本上的尺寸差异很大（实测 GTX 1060 有 175mm ITX / 242mm 标准 /
290mm 长卡三种），这些差异**直接决定能否装进机箱**。

所以显卡按 `chipset`、主板按 `chipset·板型` 归并：

```
芯片行   GTX 1660 SUPER  ▸ 4 个版本   [ITX][单风扇][单槽薄][标准][矿卡]   168~280 mm   2~3 槽
  └─点击展开
     耕升    GTX 1660 SUPER Pegasus            168mm  2槽   1×8pin
     EVGA   GTX 1660 SUPER SC ULTRA GAMING    202mm  2.5槽  1×8pin
     七彩虹  iGame GTX 1660 SUPER Ultra 6G     247mm  2槽   1×8pin
     技嘉    GTX 1660 SUPER GAMING OC          280mm  3槽   1×8pin
```

**归并只发生在展示层** —— 规则引擎仍按具体型号的尺寸计算，
所以「短卡能装进小机箱、长卡装不进」能得到正确结论。

---

## 快速开始

### 直接用

双击 `dist/装机助手.html`。就这一步。

### 从源码构建

本项目**零依赖**，只需要 Node.js ≥ 18，无需 `npm install`。

```bash
node tools/gen-data-bundle.mjs    # data/*.json → src/data/bundle.js
node tools/build.mjs              # 内联 CSS + JS + 数据 → dist/装机助手.html

node tools/gate.mjs               # 一键跑完全部门禁（推荐）
```

`tools/gate.mjs` 依次执行 8 步：

```
生成 JSON Schema → 生成 CSV 模板 → 生成数据包 → 校验硬件数据
→ 构建单文件产物 → 构建可复现性 → 无价格门禁 → 全量测试
```

---

## 目录结构

```
dist/装机助手.html       最终交付物（单文件，纳入版本控制）
prd.md                   产品需求文档 —— 唯一开发依据
NOTICE.md                第三方数据来源与声明
LICENSE                  MIT
CONTRIBUTING.md          贡献指南（含硬约束说明）
CHANGELOG.md             更新日志

docs/                    开发计划 / 验收记录 / 技术文档
data/*.json              8 品类硬件数据库（716 条）
csv-templates/*.csv      自行扩充型号的模板
schema/fields.js         字段规范（单一数据源）
schema/hardware.schema.json   由 fields.js 生成

src/core/                纯逻辑，不接触 DOM，可完整单测
  enums.js                 枚举唯一来源（防字面量分裂）
  rules-data.js            32 条规则的声明式注册表
  rules.js                 规则引擎
  power.js                 功耗计算
  status.js                状态灯汇总
  search.js                搜索 / 筛选 / 排序
  grouping.js              芯片级归并（纯函数）
  store.js                 状态与持久化
  csv.js                   CSV 解析与合并

src/ui/
  render.js                纯函数渲染（数据 → HTML 字符串，可单测）
  app.js                   唯一接触 DOM 的层，尽量薄
  export.js                导出（含自写的零依赖 xlsx 写入器）

tools/                   构建、校验、门禁、数据管线脚本
tests/                   500 项测试
```

---

## 架构要点

**为什么核心逻辑写得像库**
`src/core/*` 与 `src/ui/render.js` 都是纯函数、不接触 DOM。
所以 32 条规则、功耗计算、搜索、**甚至渲染输出**都能在 Node 里直接单测。
只有 `app.js` 碰 DOM，且尽量薄。

**为什么自己写打包器**
项目要求「零安装 + 单文件 + 断网可用」，引入 Rollup/esbuild 会带来 `node_modules`。
模块图很小，`tools/build.mjs` 这个迷你打包器足够且完全可控。

**为什么枚举集中在一处**
`AM4` 与 `am4` 这类字面量分裂会让插槽规则（E1）大面积误判。
`src/core/enums.js` 是唯一来源，校验脚本会检查越界。

**为什么有可复现性门禁**
生成物与源数据不同步会静默地把过期数据打进产物（真实踩过）。
`tools/check-reproducible.mjs` 重新生成后逐字节比对，不一致即失败。

---

## 测试

```bash
node tools/gate.mjs               # 全部门禁（推荐）
node --test tests/*.test.mjs      # 500 项测试
node tools/validate-data.mjs      # 数据校验
node tools/check-no-price.mjs     # 无价格门禁（A15）
```

覆盖范围：

- 32 条规则逐条**正反例**（触发 + 不触发）
- 真实 716 条数据的整机场景回归
- 功耗计算 PRD 算例
- 搜索别名匹配、状态灯双计数口径、持久化
- 渲染转义防注入、xlsx 结构合法性
- 芯片归并**不影响规则计算**（短卡/长卡在同一机箱上结论不同）
- 弹窗事件可达性（曾因事件委托根节点不对导致所有弹窗按钮失效）
- **构建产物冒烟测试** —— 在 Node + DOM shim 中真实执行产物脚本，
  验证模块图、渲染输出、无外部请求

---

## 本期范围

**不含价格与预算**（M5 已推迟到 P1）。
`tools/check-no-price.mjs` 扫描界面代码与产物，确保不出现 `¥` / `总价` / `金额`。

> ⚠️ 注意区分：**「功耗预算」是电源瓦数计算（M4），属于本期范围**，
> 与钱无关，完整保留。门禁脚本对该词做了白名单处理。

---

## 数据来源

- **手工整理**：716 条中的 476 条，依据厂商公开规格整理，属事实性数据
- **第三方派生**：240 条（显卡 191 + 主板 49）派生自
  [`docyx/pc-part-dataset`](https://github.com/docyx/pc-part-dataset)

⚠️ **MIT 许可证只覆盖代码与文档，不覆盖上述第三方派生数据。**
详见 [NOTICE.md](./NOTICE.md)。

若你需要一份不含第三方数据的版本：

```bash
node tools/strip-third-party.mjs
```

---

## 已知限制

- **主板数据未达目标**：当前 81 条，目标 130 条。公开数据集对主板只提供
  `socket` 与 `form_factor`，而规则最依赖的字段（`memoryType` / `pcieVersion` /
  `m2Slots` / `sataPorts`）全部缺失，故暂未扩充
- **显卡厚度为估算值**：`thicknessSlots` 无可靠来源，已列入 `estimated`，
  界面以 `≈` 呈现
- **非关键字段允许近似**：噪声、时序、电压、频率细节等可给近似值，
  但**必须列入该记录的 `estimated`**，界面会以 `≈` 提示
- **导出 xlsx 为自写实现**：已用 LibreOffice 验证可正常打开；
  界面同时提供 CSV 选项作为兜底

---

## 贡献

欢迎提交 Issue 与 PR。**开始前请读 [CONTRIBUTING.md](./CONTRIBUTING.md)** ——
里面写明了项目的硬约束（零依赖、单文件离线、不含价格、只提示不拦截、
关键字段不得近似），以及提交要求。

发现某个硬件规格写错了？请用「数据纠错」Issue 模板并附上厂商规格链接。

---

## 许可证

[MIT](./LICENSE) —— 只覆盖代码与文档。

硬件型号名与品牌名为其各自所有者的商标，本项目仅作**指称性使用**
（指明兼容性对象），不主张任何权利。
