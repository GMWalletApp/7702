# EIP-7702 自研代付内部 rollout 记录

> 仅供项目维护、审计和问题追踪。前端与后端工程师应使用同级目录中的对接文档，不依赖本文件完成接入。

## 文档边界

以下内容只记录部署、策略变更、验收交易、故障与修复过程。当前接口契约分别维护在：

- `../self-relayer-frontend-integration.md`
- `../self-relayer-backend-integration.md`

## 2026-08-11 五链纯代付

Ethereum、BSC、BSC Testnet、Arbitrum One 和 Polygon Registry 的费用 policy 统一为：

```text
maxGasFeeAmount = 0
maxServiceFeeAmount = 0
maxTotalFeeAmount = 0
maxCalls = 10
```

详细管理交易和五链 readback 见：

- `../../reports/five-chain-pure-subsidy-policy-2026-08-11.md`

## 2026-08-11 Polygon 部署

Polygon PoS 主网完成 Registry、Account Implementation 和 SponsorRouter 部署、production artifact 校验、三方绑定、Sponsor allowlist、原生 USDC allowlist 及纯代付 policy 配置。

固定地址：

```text
SponsorPolicyRegistry  0x000000000000000000000000ca848390f7e66b59
Sponsored7702Account   0x0000000000000000000000004d9bca433fc66f62
SponsorRouter          0x00000000000000000000000072111f5ddfc88a71
native USDC            0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359
```

部署交易、gas、bytecode hash 和 RPC 兼容性记录见：

- `../../reports/polygon-mainnet-deployment-2026-08-11.md`

## 2026-08-11 Polygon 纯代付验收

自研 Sponsor 完成 Polygon 主网零费用 EIP-7702 type-4 canary：

```text
tx        0x0000000000000000000000000000000000000000000000003845f98c574bbf19
block     91814794
payment   0.001 native USDC
FeePaid   0
user POL  unchanged
nonce     0 -> 1
```

验收后 SDK Polygon 原生 USDC 状态更新为 `verified=true`、`needsCanary=false`。完整 receipt、余额与事件对账见：

- `../../reports/polygon-pure-subsidy-canary-2026-08-11.md`

## 既有 delegation 兼容性修复

canary 用户原先委托到其他 EIP-7702 implementation。Polygon RPC 在 `eth_estimateGas` 时仍按旧 delegation 执行，导致第一次 live 尝试在广播前 revert；没有产生交易哈希，也没有资产变化。

自研发送器随后增加：

- 从固定 storage slot 读取 sponsored nonce；
- 恢复并校验 authorization signer；
- 用目标 Account runtime 做 state override 已签名模拟；
- 使用经过模拟验证的受控 gas limit；
- receipt 后断言 type-4、from/to、事件、余额、用户原生币零变化和 nonce。

修复提交：`95b364a fix: handle existing 7702 delegations in relayer`。

## 分支同步记录

共享部署、SDK 和文档改动以 `feat/core` 为真相源，再单向合并到：

- `feat/self-relayer`
- legacy third-party relayer branch

自研发送器兼容性修复只属于 `feat/self-relayer`，不合并回 `feat/core`。
