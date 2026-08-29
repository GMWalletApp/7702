# 五链纯代付策略变更记录

> 日期：2026-08-11
> 模式：`platform_subsidized`
> 目标 policy：`maxGasFeeAmount=0`、`maxServiceFeeAmount=0`、`maxTotalFeeAmount=0`、`maxCalls=10`

## 结论

Ethereum、BSC、BSC Testnet、Arbitrum One 已从允许 ERC-20 gas 偿还的正数上限切换为强制纯代付。Polygon 部署时已经是相同的 `0/0/0/10`，无需再次写入。

五条链现在都在合约 Registry 层禁止 Sponsor 对用户收取链上 gas 费或服务费。手续费币种 allowlist 和收费合约代码继续保留；将来恢复收费必须由 owner 显式提高 policy 上限并完成新的发布验收。

## 链上交易

| 网络 | 交易 | 区块 | Gas Used | 状态 |
| --- | --- | ---: | ---: | --- |
| Ethereum | [`0x885fab3d…0739c`](https://explorer.example/tx/redacted) | 25,729,320 | 34,633 | success |
| BSC | [`0x4dfb2cbd…7c9ad`](https://explorer.example/tx/redacted) | 115,247,406 | 34,633 | success |
| BSC Testnet | [`0x72456042…d3aa`](https://explorer.example/tx/redacted) | 124,390,047 | 34,633 | success |
| Arbitrum One | [`0xc6158c31…fa5a`](https://explorer.example/tx/redacted) | 493,305,269 | 34,819 | success |
| Polygon PoS | 部署配置交易 [`0x765b82fe…4e850`](https://explorer.example/tx/redacted) | 91,810,237 | 61,414 | success |

## 五链回读要求

`npm run preflight:five-chain` 必须同时满足：

- 固定地址的 runtime code hash 与批准部署清单完全一致
- Registry、Account、Router 三方绑定正确
- `paused=false`
- 自研 Sponsor 在 allowlist
- 当前参考 fee token 在 allowlist
- fee policy 为 `0/0/0/10`

预检按每条链固定 runtime code hash 校验，不再依赖当前工作区碰巧属于 default 还是 production 编译 profile。

## Polygon canary 结果

Polygon `sponsored:payment:polygon` 与 `polygon-usdc` canary 入口已经补齐。用户地址补充 Polygon 原生 USDC 后，2026-08-11 完成真实零费用 type-4 canary：

- 交易：[`0x53b0c2d8…4150d`](https://explorer.example/tx/redacted)
- 区块：`91814794`
- type：`0x4` / `eip7702`
- 用户业务付款：`0.001 USDC`
- 手续费 Transfer：`0`
- `FeePaid`：`0`
- 用户 POL 变化：`0`
- Sponsor POL gas 成本：`0.055362051387327174 POL`
- sponsored nonce：`0→1`

Polygon SDK 条目据此更新为 `verified=true`、`needsCanary=false`。这只代表仓库内链上路径已验收；外部生产后端 capability、nonce allocator、索引、对账和告警仍需独立发布验收。完整证据见 `polygon-pure-subsidy-canary-2026-08-11.md`。
