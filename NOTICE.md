# 第三方数据来源与声明

本文件说明本仓库中**非原创**的数据来源、其许可状态，以及使用者的注意事项。

> **一句话总结**：MIT 许可证只覆盖**代码与文档**；`data/` 中有 **240 条**
> 记录派生自第三方公开数据集（显卡 191 条 + 主板 49 条），
> 其合规状态独立于 MIT，再分发前请自行评估。

---

## 1. 数据类型总览

| 品类 | 总数 | 第三方派生 | 手工整理 |
|---|---:|---:|---:|
| CPU | 80 | 0 | 80 |
| **主板** | **130** | **49** | **81** |
| **显卡** | **261** | **191** | **70** |
| 内存 | 55 | 0 | 55 |
| 电源 | 50 | 0 | 50 |
| 机箱 | 50 | 0 | 50 |
| 散热器 | 45 | 0 | 45 |
| 硬盘 | 45 | 0 | 45 |
| **合计** | **716** | **240** | **476** |

**第三方派生数据存在于显卡与主板两个品类，占全库 33.5%。**

---

## 2. 来源

### 2.1 数据集

- **仓库**：[`docyx/pc-part-dataset`](https://github.com/docyx/pc-part-dataset)
- **内容**：从 [PCPartPicker](https://pcpartpicker.com) 抓取的硬件数据集（66,778 条）
- **仓库许可**：MIT —— ⚠️ **该 MIT 仅覆盖其代码（抓取脚本等），不覆盖抓取所得的数据本身**

### 2.2 本仓库从中取用了什么

**显卡**取用**型号名与板卡长度**：

| 字段 | 来源 | 说明 |
|---|---|---|
| `brand` | 数据集 `name` 前缀解析 | 品牌 |
| `name`（型号部分） | 数据集 `name` | 厂商型号名，如 `VENTUS XS OC` |
| `length_mm` | 数据集 `length` | **板卡真实长度（mm）** |
| `chipset` | 数据集 `chipset` | 芯片名，用于归并 |

**主板**取用**芯片组、板型、内存槽数与最大容量**：

| 字段 | 来源 | 说明 |
|---|---|---|
| `brand` / `name` | 数据集 `name` 前缀与剩余部分 | 品牌与型号名 |
| `chipset` | 数据集 `name` 中提取 | 归并键 |
| `formFactor` | 数据集 `form_factor` | 板型（映射到本项目枚举） |
| `memorySlots` | 数据集 `memory_slots` | 内存槽数 |
| `maxMemory` | 数据集 `max_memory` | 最大内存容量 |

> 主板的 `socket` **不取数据集** —— 它把 6/7 代（本项目 `LGA1151`）与
> 8/9 代（本项目 `LGA1151-2`）都写作 `LGA1151`，无法区分，直接用会造成 E1 误判。
> 主板 `socket` 一律由芯片组参照表推导。

**未从数据集取用的字段**（来自本仓库自行整理的参照表）：

- 显卡：`vram` `memoryType` `busWidth` `tdp` `recommendedPsu` `pcie8pin` `pcie12vhpwr`
  `pcieVersion` `gameScore` `productivityScore` `coolerType`
- 主板：`socket` `memoryType` `pcieVersion`（芯片组决定）；
  `maxMemorySpeed` `m2Slots` `sataPorts` `cpuPowerConnectors` `vrmPhases`
  `length_mm` `width_mm` `wifi` `usbC` `biosFlashback`（**因主板型号而异，已列入 `estimated`**）

**标注为估算值的字段**（本仓库未能核实到具体型号，界面显示 `≈`）：

- 显卡：`thicknessSlots` `height_mm` `outputs`
- 主板：`maxMemorySpeed` `m2Slots` `sataPorts` `cpuPowerConnectors` `vrmPhases`
  `length_mm` `width_mm` `wifi` `usbC` `biosFlashback`

> ⚠️ 主板的上述字段是**该芯片组的典型值**，不是具体型号的实测值。
> 涉及这些字段的规则（E12 CPU 供电接口、E14 存储接口、E15 内存槽数、
> W3 内存降频、W7 VRM 相数）在派生记录上可能与该型号实际不符，请以实物为准。

溯源方式：所有派生记录的 `notes` 字段都注明了原始条目名，例如

```json
"notes": "长度 204mm 取自 PCPartDataset（原条目「MSI VENTUS XS OC」）；厚度与输出接口为估算值。"
```

可用以下命令列出全部派生记录：

```bash
node -e "const a=require('./data/gpu.json');console.log(a.filter(r=>/PCPartDataset/.test(r.notes||'')).map(r=>r.id+' <- '+r.notes).join('\n'))"
```

---

## 3. 合规状态与风险提示

### 3.1 事实性数据与数据库汇编

- **单条规格**（如「某型号板卡长 168mm」）属**事实性数据**，在多数法域（如美国
  Feist v. Rural Telephone 判例）不构成著作权客体。
- **整库汇编**在部分法域可能受**数据库特别权利**保护（如欧盟
  Database Directive 96/9/EC）。

### 3.2 未能核实的事项

撰写本文件时尝试查阅 PCPartPicker 的服务条款，但其条款页对自动访问返回
**HTTP 403（Cloudflare 拦截）**，因此**无法确认**其条款是否允许再分发抓取所得的数据。

**本仓库不对该数据的可再分发性作任何保证。**

### 3.3 使用建议

| 使用场景 | 风险 |
|---|---|
| 本地个人使用、学习研究 | 低 |
| 公开仓库再分发 | ⚠️ 存在不确定性，请自行评估 |
| 商业用途 | ⚠️ 建议先取得 PCPartPicker 授权，或改用自行核实的数据 |

---

## 4. 如何移除第三方派生数据

若你需要一份**仅含手工整理数据**的版本，运行：

```bash
node tools/strip-third-party.mjs          # 移除记录 + 同步数据规模约束
node tools/strip-third-party.mjs --dry    # 仅预览，不写入
```

执行后：

- `data/gpu.json` 由 261 条降为 70 条（仅保留手工整理部分）
- `schema/fields.js` 的显卡 `minCount` 同步下调，使门禁仍可通过
- 移除的记录**不可恢复**（除非 `git checkout data/gpu.json`）

执行后仓库即**不含任何第三方派生数据**（716 → 476 条）。

---

## 5. 其它第三方内容

| 内容 | 说明 |
|---|---|
| 硬件规格（非显卡部分） | 依据厂商公开规格与公开资料手工整理，属事实性数据 |
| 硬件型号名与商标 | 各型号名与品牌名为其各自所有者的商标，本仓库仅作**指称性使用**（指明兼容性对象），不主张任何权利 |

---

## 6. 更正请求

若你是某项数据的权利人或其代理人，认为本仓库的收录方式不当，
请通过 Issue 联系，我们会及时移除相关内容。

---

*本文件最后更新：随仓库首次公开发布*
