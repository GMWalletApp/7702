# 自研 relayer 迁移设计

日期：2026-08-05
状态：已确认，待实施

## 背景

旧上游仓库已不可访问，工作已迁移到当前维护仓库。业务方要求「上自研版代付」，去掉对第三方 relayer 的依赖。

调研确认了一个关键事实：**`feat/eip-7702-wallet` 分支本身就是自研的**。

| 日期 | commit | 事件 |
|---|---|---|
| 2026-05-01 | `26bbcbc` | `Sponsored7702Account.sol` 首次提交 |
| 2026-05-06 | `7133366` | `SponsorPolicyRegistry` 落地 |
| 2026-05-07 | `a68c78f` | `SponsorRouter` + fee policy |
| 2026-05-08 | `b611fd7` | 自研发送路径（sponsor 私钥直发 type-4） |
| 2026-05-09 | `13ae791` | 第三方 relayer 通道首次出现 |

合约层对第三方 relayer 零依赖。旧 provider 只是一条可选的交易发送通道，比自研路径晚 8 天才加入。

因此本次工作不是「把功能搬到另一套架构」，而是：**把已有的自研发送路径补齐到生产可用，并与第三方 relayer 路径在分支层面解耦**。

被否决的方案：把 fee 机制、策略注册表等迁移到 `origin/dev` 的两合约架构。`dev` 分支零费用机制，而业务确认要保留收费，迁移等于重写 800 行合约并重新走完主网验证，评估 3–5 天。

## 分支结构

采用共同基座模型：

```
feat/core                 共享基座
  ├─ feat/self-relayer    = core + 自研发送脚本
  └─ legacy provider branch = core + 第三方发送脚本
```

合约改动只在 `core` 上做一次，merge 进两个下游分支。下游相对 core 只是新增文件，merge 冲突面极小。

被否决的方案：两个平行分支 + cherry-pick。两条分支部署的是**同一批链上合约地址**，一旦合约代码 drift，排查成本极高。

### 归属划分

**`feat/core`**

```
contracts/                     15 个文件，全部
deploy/                        6 个部署与配置脚本，全部
test/                          除旧 provider execute-body 测试外全部
scripts/                       env-helpers.ts, check-rpc.ts,
                               simulation-state.ts, router-migration-plan.ts
evm-7702-sponsored/            sdk/ abi/ examples/ docs/ reports/
                               scripts/ 中除 run-fee-token-canary.ts 外全部
ignition/                      含 deployments/ 四链地址记录
hardhat.config.ts  tsconfig.json  .gitignore  AGENTS.md  README.md
package.json                   31 条共享 script
.env.example                   共享键（去掉 10 个旧 provider 专用键）
```

**旧 provider 分支 = core +**

```
各链 provider payload 生成脚本
各链 provider execute 调用脚本
provider contract-method helper
provider execute-body 测试
evm-7702-sponsored/scripts/run-fee-token-canary.ts
package.json  + 8 条 provider prepare/call 命令
.env.example  + 10 个 provider 专用键
```

**`feat/self-relayer` = core +**

```
scripts/arbitrum-one/run-sponsored-token-payment.ts
scripts/arbitrum-one/run-self-token-payment.ts
scripts/arbitrum-one/run-sponsored-batch-payment.ts
scripts/bsc-testnet/run-sponsored.ts
scripts/bsc-testnet/run-sponsored-token-payment.ts
package.json  + 5 条 sponsored:* / self:*
```

两个判断：

- `ignition/deployments/` 属于受控运维记录，不进入公开分支。合约地址由部署环境或 capability 服务提供。
- `evm-7702-sponsored/reports/` 放 core。四链验收报告记录的是「合约在四链验收通过」，与验收当时走哪条通道无关。

`run-fee-token-canary.ts`（1,280 行）划归旧 provider 分支：它直接调用第三方 token / execute endpoint、bearer token 与轮询，搬到自研分支等于重写。自研版金丝雀脚本列为后续项。

## sponsor 地址切换

### 现状

`.env` 中四条链的 `<CHAIN>_SPONSOR_ADDRESS` 当时装的是第三方在各链的 relayer 钱包，全局 `SPONSOR_ADDRESS` 才是自有地址。

| 键 | 归属 |
|---|---|
| `SPONSOR_ADDRESS` | 自有地址 |
| `ARBITRUM_ONE_SPONSOR_ADDRESS` | 旧 provider relayer，与当时代码中的固定地址相同 |
| `ETHEREUM_SPONSOR_ADDRESS` | 旧 provider relayer |
| `BSC_SPONSOR_ADDRESS` | 旧 provider relayer |
| `BSC_TESTNET_SPONSOR_ADDRESS` | 旧 provider relayer |
| `INITIAL_OWNER` | registry owner |

`.env` 中不存在 `SPONSOR_PRIVATE_KEY` 或任何 `<CHAIN>_SPONSOR_PRIVATE_KEY`。自研脚本因此会在启动时抛 `Missing required environment variable`，这是它停在两条链、四个月未动的直接原因。

### 方案

`scripts/env-helpers.ts:22` 的回退链是 `<PREFIX>_<KEY>` 优先、全局 `<KEY>` 兜底。利用这一点，在 `feat/self-relayer` 上：

1. 删除四个 `<CHAIN>_SPONSOR_ADDRESS`，令四条链全部回退到全局 `SPONSOR_ADDRESS`
2. 补入 `SPONSOR_PRIVATE_KEY`（由操作者本地填写）
3. 四条链各执行一次 `npm run configure:<链>`

第 3 步无需新脚本：`deploy/configure-fee-policy.ts:20` 读的正是 `requiredNetworkAddress(prefix, "SPONSOR_ADDRESS")`，:75 直接调 `setSponsor([sponsorAddress, true])`。

EOA 私钥在所有 EVM 链上推导出同一地址，因此「一个地址代付四链」不需要任何额外机制。

`run-sponsored-token-payment.ts:138` 的 `assertExpectedAddress` 会校验私钥推导地址与 `SPONSOR_ADDRESS` 一致，填错立即报错，不会误发交易。

旧 provider 的四个地址当时暂未从白名单移除，作为迁移期回退通道，待自研路径四链跑通后再决定。

旧 provider 分支的 `.env` 当时保持现状。

### 风险

单一私钥管理四条链，泄露即四链代付能力同时失守，且该地址需在 ETH / BSC / Arbitrum 常备原生币。业务方已确认采用单地址方案。该地址应按主网热钱包标准保管，不与测试配置混放。

## 管理功能

方案 A 下管理权限无需转移：两个分支共用同一套链上合约、同一个 owner、同一套 `deploy/configure-*.ts`（均在 core）。

现有缺口：

| 合约能力 | 运维脚本 |
|---|---|
| `setRouter` / `setFeePolicy` / `setSupportedFeeToken` | 有 |
| `setSponsor(addr, true)` | 有 |
| `setSponsor(addr, false)` | 无 |
| `pause()` / `unpause()` | 无，脚本仅读 `paused()` |
| `transferOwnership` / `acceptOwnership` | 无，仅测试中出现 |

`deploy/configure-fee-policy.ts` 另有两个隐患：chainId 只打印不校验（:15、:38）；无 dry-run，一次执行即产生四笔写链交易。

## 实施状态（2026-08-05 收工时）

P0 至 P3 全部完成。当时分支为共享 core、旧 provider 和 self-relayer，测试 46 / 48 / 97。

已验证的链上事实：

- BSC Testnet 自研代付端到端跑通，多笔真实交易，事件与余额 delta 全部断言通过
- 四链合约与 bytecode 就位，registry 三方绑定一致
- 自有 sponsor 已在 Arbitrum One 与 BSC Testnet 放行

实施中发现并修掉的既有缺陷：

- `configure-bsc-testnet.ts` 丢弃 receipt，配置交易 revert 会被报成成功
- 四链 preflight 读 `<CHAIN>_SPONSOR_ADDRESS` 时不走 env 回退链，单 sponsor 配置下会误报四链全挂
- 代付脚本对「非零但不足以付 gas」的 sponsor 余额无防护，签名后才失败

仍待处理的见文末「遗留」。

### 原优先级清单

**P0 — 阻塞交付**

1. `.env`：补 `SPONSOR_PRIVATE_KEY`，删四个 `<CHAIN>_SPONSOR_ADDRESS`（操作者执行）
2. 新增 `scripts/ethereum/run-sponsored-token-payment.ts`
3. 新增 `scripts/bsc/run-sponsored-token-payment.ts`

**P1 — 主网安全护栏**

4. 7 个自研脚本补 `--dry-run`
5. `configure-fee-policy.ts` 补 chainId 硬校验与 dry-run
6. 补 `<CHAIN>_RELAYER_MIN_NATIVE_BALANCE` 阈值检查（现仅判 `=== 0n`）

**P2 — 校验强度对齐旧 provider 路径**

7. 事件断言：`SponsoredCallForwarded` 恰好 1 条、Transfer 条数下限、`FeePaid` 按 account 过滤
8. 顶层 catch 与排查提示

**P3 — 后续**

9. `deploy/manage-sponsor.ts`（增删 sponsor）
10. `deploy/pause-registry.ts`（急停与恢复）
11. `deploy/transfer-ownership.ts`（Ownable2Step 两步流程）
12. 自研版金丝雀脚本

## 测试策略

现有 37 个测试集中在合约层，脚本层仅 4 个。新增能力按同样方式处理：将 dry-run 判定、事件断言、余额阈值抽为纯函数并配单元测试，本地可跑、不产生链上开销。

上链顺序：BSC Testnet 验证通过后再进主网。

## 遗留

**需要操作者处理（代码侧无事可做）**

1. Ethereum 与 BSC 的 `sponsor:add` —— 自有 sponsor 尚未进这两条链的白名单。`.claude/settings.local.json` 对这两条命令设了硬 deny，需人工执行或先改配置。
2. Arbitrum One 的 sponsor 原生币 —— 余额 0.0000012 ETH，单笔约需 0.0000052 ETH。Ethereum 与 BSC 加完白名单后会遇到同一问题。
3. Arbitrum One 的用户 USDC —— 余额 0.054，`ARBITRUM_ONE_PAYMENT_AMOUNT` 配的是 0.1，`self:payment` 跑不动。金丝雀用最小金额不受影响。

**已知但未实现的业务边界：链下余额偿还**

业务场景：用户在以太坊上既无 ETH 也无 USDT/USDC，但已在平台充值 TRX，希望扣 TRX 偿还代付。

这打破了当前的核心假设。现有偿还是同链、同笔交易内的原子 ERC-20 转账（`_paySponsorFee` 的 `trySafeTransfer`），失败即整笔 revert，因此 sponsor 垫的 gas 不可能收不回来。TRX 在 TRON 链上、在平台托管余额里，以太坊交易无法原子地动它——sponsor 由此从零风险变为承担信用风险。

合约侧无需改动：总费用为 0 时 `_paySponsorFee` 直接 return，该路径已有测试覆盖；且发交易的就是平台自身，可在提交前查余额、先扣款、再提交。要建的全在平台侧：

1. 计价 —— gas 计价币种与扣费币种不同，需汇率源，并明确汇率波动由谁承担
2. 扣款与提交的时序 —— 先扣后发（发失败需退款）或先发后扣（扣失败即亏损），核心风控决策
3. 提交前余额预检 —— 唯一能实际防止损失的闸门
4. 对账 —— 链上 tx hash 与平台扣款流水的关联
5. 额度控制 —— 单用户与单日的垫付上限

注意零费用模式下链上 `maxGasFeeAmount` / `maxTotalFeeAmount` / `maxCalls` 等策略全部失效，风控需整体在平台侧重建。

已落地的相关防护：`assertFeeIntent` 要求 `SPONSORED_ALLOW_ZERO_FEE=true` 才放行零费用运行，避免配置疏漏静默变成无偿代付。

**可选的代码工作**

4. 合并两个 configure 脚本 —— `configure-bsc-testnet.ts` 与 `configure-fee-policy.ts` 逻辑已趋同，差别只在前者按 USDT/USDC/USDG 单独列 token。合并前需给 `.env` 补 `BSC_TESTNET_SUPPORTED_FEE_TOKENS`。
5. 金丝雀的主网闸门 —— 它用子进程拉起 hardhat，`.claude/settings.local.json` 里按命令名写的权限规则匹配不到内层 spawn，等于绕过了给主网设的闸门。可在脚本内加 `--allow-mainnet` 显式开关。
