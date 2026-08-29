# Polygon PoS 自研纯代付 canary 验收

> 日期：2026-08-11
> 网络：Polygon PoS Mainnet
> Chain ID：137
> 模式：`platform_subsidized`

## 结论

Polygon 自研 Sponsor 生产路径已完成一笔真实 EIP-7702 type-4 零费用交易。用户只支付 `0.001 USDC` 业务金额，用户 POL 余额不变；Sponsor 支付全部原生 gas，同一笔交易没有手续费 ERC-20 Transfer，也没有 `FeePaid`。

交易：[`0x0000000000000000000000000000000000000000000000003845f98c574bbf19`](https://explorer.example/tx/redacted)

## 参与地址

| 角色 | 地址 |
|---|---|
| 用户 | `0x0000000000000000000000007741ac3b13402f19` |
| 自研 Sponsor | `0x000000000000000000000000e5007247e6ad64ed` |
| 商户 | `0x000000000000000000000000727d326c544b07bc` |
| 原生 USDC | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| SponsorRouter | `0x00000000000000000000000072111f5ddfc88a71` |
| Account Implementation | `0x0000000000000000000000004d9bca433fc66f62` |

## 交易回执

| 项目 | 实际值 |
|---|---|
| status | `success` |
| block | `91814794` |
| type | `eip7702` / `0x4` |
| from | Sponsor `0x695E…012A` |
| to | SponsorRouter `0x9d4F…fF27` |
| gasUsed | `198519` |
| `SponsoredCallForwarded` | `1` |
| `FeePaid` | `0` |
| USDC `Transfer` | `1`，用户 → 商户 |

## 余额与 nonce 对账

| 项目 | 交易前 | 交易后 | 变化 |
|---|---:|---:|---:|
| 用户原生 USDC | `1.062284` | `1.061284` | `-0.001` |
| 商户原生 USDC | `0` | `0.001` | `+0.001` |
| 用户 POL | `0.05` | `0.05` | `0` |
| Sponsor POL | `2.94459577532443` | `2.889233723937102826` | `-0.055362051387327174` |
| sponsored nonce | `0` | `1` | `+1` |

交易后用户 EIP-7702 delegation designator 为：

```text
0xef01001f62534e8b753033e02ff579d4ec6231b6645abc
```

其目标正是本项目的 `Sponsored7702Account` implementation。

## 零费用断言

本次请求的 `gasFeeAmount=0`、`serviceFeeAmount=0`，Registry policy 为 `0/0/0/10`。验收同时满足：

- 用户没有支付 POL gas；
- 用户只减少业务金额 `0.001 USDC`；
- 商户只增加 `0.001 USDC`；
- feeReceiver 没有收到手续费；
- receipt 中没有 `FeePaid`；
- Sponsor 的 POL 减少量等于本次 gas 成本。

因此该交易证明的是“纯代付”，不是先扣费再返还，也不是 ERC-20 偿还模式。

## 兼容性问题与修复

用户在 canary 前已经委托到另一份 EIP-7702 实现。Polygon RPC 在 `eth_estimateGas` 阶段仍按旧 delegation 执行，第一次尝试在广播前 revert，没有产生交易哈希或资产变化。

自研发送器增加了以下保护后重试成功：

- 直接从 `Sponsored7702Account` 固定 storage slot 读取 sponsored nonce，不调用当前外部 delegation 的 `getNonce()`；
- 恢复并核对 EIP-7702 authorization signer；
- 广播前用 state override 将用户地址代码替换为目标 Account runtime，执行完整已签名 `eth_call`；
- 使用受控 gas limit，避免节点再次按旧 delegation 进行错误预估；
- receipt 后强制断言 type-4、from/to、事件、token 余额、用户 POL 不变和 nonce 递增。

相关回归测试为 `117 passing`。

## 开放边界

这笔 canary 证明 Polygon 合约、自研发送器和原生 USDC 零费用链上路径可用，因此 SDK Polygon 条目可设为 `verified=true`、`needsCanary=false`。

它不证明外部业务后端已经上线。生产开放前仍需完成 capability、Sponsor KMS/HSM、transaction nonce allocator、幂等、索引、对账、监控告警、前端钱包兼容和发布审批。
