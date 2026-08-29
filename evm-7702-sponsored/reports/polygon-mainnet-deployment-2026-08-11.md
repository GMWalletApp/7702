# Polygon PoS 自研代付合约部署记录

> 日期：2026-08-11
> 网络：Polygon PoS Mainnet
> Chain ID：137
> 分支：`feat/self-relayer`
> 源码提交：`ce85c92`
> Ignition deployment ID：`chain-137-router-v2`

## 1. 结论

Polygon PoS 主网的自研 EIP-7702 代付合约已经部署并完成基础配置。三份链上 bytecode 与当前 production artifact 的规范化 hash 一致，Registry、Account Implementation、SponsorRouter 三方绑定正确。

当前采用纯代付策略：

```text
maxGasFeeAmount = 0
maxServiceFeeAmount = 0
maxTotalFeeAmount = 0
maxCalls = 10
```

自研 Sponsor 已加入 allowlist；Polygon 原生 USDC 已加入手续费币种 allowlist。费用上限全部为 0，因此当前 Sponsor 不能向用户收取链上 ERC-20 手续费。

合约部署、Registry 配置、固定 runtime code hash readback、自研发送入口、SDK chain ID 137、canary target、索引文档和五链 preflight 已完成。真实零费用 type-4 业务 canary 也已成功并完成余额、事件和 nonce 对账；生产后端 capability、nonce allocator 和告警仍不在本仓库内，因此暂不能据此宣称业务系统已对用户开放。

## 2. 合约地址

| 合约 | 地址 |
|---|---|
| SponsorPolicyRegistry | `0x000000000000000000000000ca848390f7e66b59` |
| Sponsored7702Account | `0x0000000000000000000000004d9bca433fc66f62` |
| SponsorRouter | `0x00000000000000000000000072111f5ddfc88a71` |

参与地址：

| 角色 | 地址 |
|---|---|
| Registry owner / deployer | `0x000000000000000000000000ef303ac085f1e696` |
| 自研 Sponsor | `0x000000000000000000000000e5007247e6ad64ed` |
| feeReceiver | `0x0000000000000000000000006627860470681dea` |
| 原生 USDC | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |

## 3. 交易记录

| 操作 | 交易哈希 | 区块 | Gas Used | 状态 |
|---|---|---:|---:|---|
| 部署 SponsorPolicyRegistry | [`0x4b1bc776…cfbc26`](https://explorer.example/tx/redacted) | 91810160 | 746,069 | success |
| 部署 SponsorRouter | [`0x5991d8ec…12aeb2`](https://explorer.example/tx/redacted) | 91810168 | 545,198 | success |
| 部署 Sponsored7702Account | [`0x4e24c8c1…9e5049`](https://explorer.example/tx/redacted) | 91810170 | 1,304,528 | success |
| Registry.setRouter | [`0xe1ccf075…ef93b`](https://explorer.example/tx/redacted) | 91810178 | 56,695 | success |
| Registry.setFeePolicy | [`0x765b82fe…4e850`](https://explorer.example/tx/redacted) | 91810237 | 61,414 | success |
| Registry.setSponsor | [`0x16201c74…170f7`](https://explorer.example/tx/redacted) | 91810240 | 54,631 | success |
| Registry.setSupportedFeeToken | [`0xe7c91b8a…0f46b`](https://explorer.example/tx/redacted) | 91810242 | 54,575 | success |
| 自研零费用 type-4 canary | [`0x53b0c2d8…4150d`](https://explorer.example/tx/redacted) | 91814794 | 198,519 | success |

七笔成功交易实际总成本约 `0.78594599520029625 POL`。

## 4. Bytecode 验证

规范化时清除 immutable 区域并剥离 Solidity metadata，再比较 `keccak256`：

| 合约 | Code Bytes | Expected Hash | Actual Hash | 结果 |
|---|---:|---|---|---|
| SponsorPolicyRegistry | 2,895 | `0x000000000000000000000000000000000000000000000000333d5709dba69272` | `0x000000000000000000000000000000000000000000000000333d5709dba69272` | match |
| Sponsored7702Account | 5,708 | `0x0000000000000000000000000000000000000000000000009efac986c099f54d` | `0x0000000000000000000000000000000000000000000000009efac986c099f54d` | match |
| SponsorRouter | 2,252 | `0x000000000000000000000000000000000000000000000000f81b1db122157664` | `0x000000000000000000000000000000000000000000000000f81b1db122157664` | match |

## 5. 链上配置 Readback

```text
owner = 0x000000000000000000000000ef303ac085f1e696
feeReceiver = 0x0000000000000000000000006627860470681dea
registry.router = 0x00000000000000000000000072111f5ddfc88a71
account.policyRegistry = 0x000000000000000000000000ca848390f7e66b59
router.policyRegistry = 0x000000000000000000000000ca848390f7e66b59
paused = false
sponsorAllowed = true
nativeUsdcAllowed = true
feePolicy = 0, 0, 0, 10
```

部署与配置结束后的余额：

```text
owner = 4.21405400479970375 POL
sponsor = 3 POL
owner nonce = 7
```

## 6. 部署过程说明

最初使用 dRPC 时，Hardhat Ignition 的 Polygon 模拟把 gas limit 退化为整块 `50,000,000`，节点因账户无法预留约 14 POL 而在 `eth_call` 阶段拒绝；两次尝试均未广播，owner nonce 和余额未变化。

切换到 Polygon 官方 RPC 列表中的 PublicNode 后，Ignition 返回真实 gas 估算并完成部署。后续 Polygon 部署和主网写操作应使用经过 Ignition 兼容性验证的 RPC，不应只以普通 `eth_estimateGas` 成功作为依据。

## 7. 尚未完成

- 外部生产后端 capability、Sponsor nonce allocator、索引进程、对账和告警
- 前端钱包兼容性与完整业务验收

## 8. 2026-08-11 接入进展

已补齐：

- `scripts/polygon/run-sponsored-token-payment.ts`
- `npm run sponsored:payment:polygon`
- `polygon-usdc` 自研 canary target
- SDK `chains.ts` chain ID 137 / Polygon native USDC（canary 后为 `verified=true`、`needsCanary=false`）
- `npm run preflight:five-chain`
- Sponsor add/remove、pause/unpause、owner transfer/accept 的 Polygon 运维命令
- `.env.example` Polygon 部署、USDC、纯代付和余额阈值配置
- 前端、后端、indexer 对接文档

初次 dry-run 在用户尚未获得原生 USDC 时正确被资产护栏拦截：

```text
USER_ADDRESS USDC balance is too low: balance=0, required=1000
```

该失败发生在签名和广播之前，没有产生交易，也没有花费 POL。补充资产后，用户账户仍委托到另一份 EIP-7702 实现；Polygon RPC 的 `eth_estimateGas` 对新 authorization 的替换行为不完整，第一次 live 尝试在产生交易哈希前失败。自研发送器随后改为直接读取固定 storage slot 中的 sponsored nonce、验证 authorization signer、先用 state override 对目标 Account 实现做已签名模拟，并显式设置受控 gas limit。

修复后同一生产入口先完成 signed simulation，再执行：

```shell
npm run canary:self-relayer -- --only=polygon-usdc --allow-mainnet
```

交易 [`0x53b0c2d8…4150d`](https://explorer.example/tx/redacted) 成功：type `0x4`、用户仅转出 `0.001 USDC`、`FeePaid=0`、用户 POL 不变、Sponsor 支付 gas、sponsored nonce `0→1`。完整对账见 `polygon-pure-subsidy-canary-2026-08-11.md`。

收费路径代码和历史实链交易继续保留，但当前五链费用上限均为 0，不应为测试收费临时打开 Polygon policy；恢复收费需走独立发布流程。
