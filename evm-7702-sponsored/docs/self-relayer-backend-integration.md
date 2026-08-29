# EIP-7702 自研代付后端对接文档

> 适用对象：自研 Relayer 与业务后端工程师
> 当前模式：`platform_subsidized`，Sponsor 承担原生 gas，用户手续费为 0

## 1. 架构与业务口径

自研代付不经过任何第三方 relayer。用户链下完成 EIP-7702 authorization 和 EIP-712 SponsoredCall 签名，后端使用自有 Sponsor 钱包发送 EIP-7702 type-4 交易：

```text
用户签名 → 后端重建并校验业务 calls → Relayer 分配 Sponsor nonce
        → SponsorRouter → 用户 EOA 的委托逻辑 → 执行业务转账
```

当前纯代付固定为：

```text
gasFeeAmount = 0
serviceFeeAmount = 0
```

用户只支付业务 ERC-20 金额；Sponsor 支付原生 gas。平台可以记录 Sponsor 的实际 gas 成本，但不得扣用户平台余额，也不得生成用户手续费账单。收费能力保留，后续开启时需同步变更报价、签名、Registry policy、结算和前端展示。

## 2. 网络与合约配置

后端支持以下网络配置：

| 网络 | Chain ID | Registry | Account Implementation | Router |
|---|---:|---|---|---|
| Ethereum | 1 | `0x00000000000000000000000057f71eb4fbe79dd9` | `0x0000000000000000000000007f6e04fe6180d1e7` | `0x0000000000000000000000005dc708e8e59868b7` |
| BSC | 56 | `0x000000000000000000000000ca848390f7e66b59` | `0x0000000000000000000000004d9bca433fc66f62` | `0x000000000000000000000000ab2d2b5fb2e29d11` |
| BSC Testnet | 97 | `0x000000000000000000000000c64f55a7740cef97` | `0x00000000000000000000000063c7480ea2a283e4` | `0x000000000000000000000000c56f61bc69930ed6` |
| Arbitrum One | 42161 | `0x000000000000000000000000ca848390f7e66b59` | `0x0000000000000000000000004d9bca433fc66f62` | `0x0000000000000000000000005dc708e8e59868b7` |
| Polygon PoS | 137 | `0x000000000000000000000000ca848390f7e66b59` | `0x0000000000000000000000004d9bca433fc66f62` | `0x00000000000000000000000072111f5ddfc88a71` |

自研 Sponsor 为 `0x000000000000000000000000e5007247e6ad64ed`。地址必须进入受版本管理的链配置，并在服务启动时链上 readback，不能只相信环境变量。

当前 Registry 费用 policy 为：

```text
maxGasFeeAmount = 0
maxServiceFeeAmount = 0
maxTotalFeeAmount = 0
maxCalls = 10
```

合约配置可用不等于业务 capability 自动开放。生产后端必须独立管理每条链的启用状态，并在启动时完成下文 readback 后才提供流量。

业务 token 地址和 decimals 统一从 `evm-7702-sponsored/sdk/chains.ts` 加载。Polygon 只允许原生 USDC `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`，不得使用 USDC.e `0x0000000000000000000000000922fb7af6f5f458`。

## 3. 后端模块职责

| 模块 | 职责 |
|---|---|
| Capability/Config | 返回实际开放的链、token、合约地址和计费模式 |
| Quote | 从可信订单生成 calls、费用、nonce、deadline 和待签 payload |
| Signature Verifier | 校验两份签名、地址、链、nonce、deadline、callsHash |
| Relayer | 管理 Sponsor transaction nonce，构造并广播 type-4 交易 |
| Receipt Reconciler | 解析 receipt、事件、余额变化，完成业务结算 |
| Risk/Ops | 限额、暂停、Sponsor 余额、RPC、nonce gap 和告警 |

## 4. 链配置与启动 readback

每条链至少配置：

```text
chainId, rpcUrls
policyRegistry, accountImplementation, sponsorRouter
sponsorAddress
supportedBusinessTokens[address, symbol, decimals]
billingMode, confirmations, maxCalls, gasPolicy
```

启动或发布 preflight 必须确认：

- 三个地址均有代码，bytecode 与批准 artifact 匹配
- `Registry.router == SponsorRouter`
- `Account.policyRegistry == Registry`
- `Router.policyRegistry == Registry`
- `paused == false`
- `isSponsorAllowed(selfSponsor) == true`
- `maxCalls`、费用上限和 owner 符合发布配置
- Sponsor 配置地址与签名密钥派生地址一致
- Sponsor 原生币余额高于安全阈值

合约在总费用为 0 时跳过 feeToken allowlist 和 feeReceiver policy；不要照搬当前 CLI 对 feeToken 的无条件白名单检查。正费用请求仍必须满足这两项 policy。

## 5. Quote 与可信 calls

业务接口只接受语义化字段：

```json
{
  "chainId": 56,
  "account": "0xUser",
  "token": "0xToken",
  "recipient": "0xMerchant",
  "amount": "1000000000000000000",
  "clientRequestId": "order-20260810-001"
}
```

后端必须从可信订单重新编码 ERC-20 `transfer(recipient, amount)`，不能接受客户端任意 `target/value/data` 后原样广播。需要校验 chain、token、recipient、amount、selector、`value == 0`、calls 数量和订单状态；禁止任意 `approve`、未知合约调用和原生币转账。

纯代付 payload：

```json
{
  "account": "0xUser",
  "nonce": "7",
  "deadline": "1786321200",
  "sponsor": "0x000000000000000000000000e5007247e6ad64ed",
  "feeToken": "0x0000000000000000000000000000000000000000",
  "gasFeeAmount": "0",
  "serviceFeeAmount": "0",
  "feeReceiver": "0x0000000000000000000000000000000000000000",
  "callsHash": "0x..."
}
```

推荐零费用时使用零地址降低歧义，但这些字段仍属于 EIP-712 digest，任何变更都必须重新签名。Quote 应保存规范化 calls、`callsHash`、payload、过期时间和配置版本。

## 6. 三种 nonce

| nonce | 唯一键 | 管理要求 |
|---|---|---|
| sponsored nonce | `chainId + user` | 从可靠链上状态读取，防止 SponsoredCall 重放 |
| authorization nonce | `chainId + user` | 按用户 EOA nonce 和钱包签名规则生成 |
| Sponsor tx nonce | `chainId + sponsor` | Relayer 串行分配或数据库加锁，防止并发复用 |

`account code == 0x` 不代表 sponsored nonce 是 0。用户可能已清除 delegation，但账户存储仍保留。

Sponsor nonce allocator 应在数据库事务中锁定 `chainId + sponsor`，比较 RPC `pending` nonce、数据库 next nonce 和未确认交易后再分配。广播结果不明时进入 `unconfirmed`，禁止立刻复用 nonce。即使同一 Sponsor 跨链复用，各链 nonce 和余额也必须独立管理。

## 7. 两份签名校验

### EIP-7702 authorization

校验 chain ID、delegation address、用户 signer、authorization nonce 和字段归一化。authorization 只绑定 chain、implementation 和用户 EOA nonce，不绑定 Sponsor、商户、金额与 calls，不能单独充当业务授权。

### EIP-712 SponsoredCall

Domain：

```text
name = Sponsored7702Account
version = 1
chainId = 请求链
verifyingContract = 用户 EOA
```

签名字段为 `account`、`nonce`、`deadline`、`sponsor`、`feeToken`、`gasFeeAmount`、`serviceFeeAmount`、`feeReceiver`、`callsHash`。后端必须重新计算 `callsHash`，恢复 signer，并拒绝任一字段不一致或过期的请求。

## 8. 构造和广播 type-4 交易

Sponsor 是交易 `from`，该链 `SponsorRouter` 是 `to`，authorization 放入 authorization list；Router calldata 包含签名请求、calls 和 SponsoredCall 签名。

广播前再次校验 quote 未使用且未过期、sponsored nonce、Sponsor allowlist、paused、bytecode readback、订单状态、余额、gas 估算与风控阈值。

广播后立即保存：

```text
chainId
sponsorAddress
sponsorTxNonce
txHash
rawTransactionHash 或 payloadHash
submittedAt
rpcEndpoint
```

不能把普通合约调用或 type-2 交易当作接入成功；链上 receipt 必须确认交易类型为 EIP-7702 type-4。

## 9. 幂等与状态机

建议唯一约束：`clientRequestId`、`quoteId`、`payloadHash`、`chainId + user + sponsoredNonce`、`chainId + sponsor + sponsorTxNonce`、`chainId + txHash`。

建议状态：

```text
accepted → signing_verified → broadcasting → submitted → unconfirmed
         → confirmed → reconciling → settled
```

终止状态可以是 `rejected`、`expired`、`reverted`、`reconciliation_failed`。只有 `settled` 是业务最终成功。

HTTP 超时或 RPC 返回不明不能触发新交易。先按 Sponsor nonce、用户 sponsored nonce、txHash 和 receipt 查清原交易状态。

## 10. Receipt 与结算

所有成功交易至少确认：

- `receipt.status == success`
- 交易类型为 type-4
- `from == selfSponsor`
- `to == 该链 SponsorRouter`
- `SponsoredCallForwarded` 恰好 1 条
- 用户 sponsored nonce 递增 1
- 每个业务 call 的事件和余额变化与订单一致

Account 事件可能从用户 EOA 地址发出，因为委托逻辑在用户账户上下文执行；索引器不能只监听 implementation 地址。

### 纯代付模式

- 用户 token 减少 = 业务金额
- 商户 token 增加 = 业务金额
- 用户平台余额扣费 = 0
- 用户到 feeReceiver 的手续费 `Transfer` = 0
- `FeePaid` = 0
- Sponsor 原生 gas 成本单独记为平台成本

单商户付款通常只有 1 条业务 `Transfer`，不能继续沿用收费验收中“恰好 2 条 Transfer”的规则。

### 收费模式

当总费用大于 0 时，额外确认 fee token 受支持、feeReceiver 正确、手续费 `Transfer` 等于总费用、`FeePaid` 恰好 1 条。当前五链的 gas、service 和 total fee 上限都为 0；恢复任何收费前必须先变更链上 policy 并完成独立发布审批。

## 11. 数据存储

至少保存：

- Quote：订单字段、calls、callsHash、sponsoredNonce、deadline、完整费用字段、配置版本
- Signature：两份签名、authorizationNonce、recoveredSigner、payloadHash
- Relay transaction：Sponsor nonce、txHash、状态、区块、gasUsed、effectiveGasPrice、nativeGasCost
- Reconciliation：业务/费用 Transfer、关键事件计数、各方余额变化、用户平台扣费、settledAt

签名、原始交易和错误详情属于敏感审计数据，应加密、限权并设置保留周期。

## 12. 风控与运维

- Sponsor 私钥进入 KMS/HSM 或受控签名服务，禁止放普通应用环境变量。
- 每链设置单笔 gas、每日补贴、用户、设备、IP 和商户限额。
- 监控 Sponsor 余额、pending nonce、nonce gap、RPC 分叉和替换交易。
- target、selector、token、recipient 必须白名单化，禁止透传任意 calls。
- pause、Sponsor allowlist、owner transfer 等管理操作需审批和链上审计。
- 同一 Sponsor 跨链复用会扩大密钥泄露影响，应评估按链拆分 Sponsor。

## 13. Polygon 运行要求

- chain ID 固定为 `137`，原生 gas 币为 POL。
- 业务 USDC 固定为原生 USDC `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`，decimals 为 `6`。
- 使用 Polygon 对应的 Registry、Account Implementation 和 SponsorRouter，禁止复用其他链 Router 地址。
- 用户可能已经委托到其他 EIP-7702 implementation。读取 sponsored nonce 时必须读取本项目固定 storage slot，不能调用当前 delegation 的 `getNonce()`。
- 广播前恢复并核对 authorization signer，并用目标 Account runtime 做完整已签名模拟。
- RPC 预估无法正确应用 delegation 替换时，使用经过模拟验证的受控 gas limit，禁止绕过签名模拟直接广播。
- capability、Sponsor transaction nonce allocator、索引、对账和告警均按独立生产链配置。

## 14. 发布清单

- [ ] 目标链固定 runtime code hash 与批准部署清单一致
- [ ] 三合约绑定、owner、paused、Sponsor allowlist、policy readback 正确
- [ ] Sponsor KMS/HSM、余额和每链 nonce allocator 就绪
- [ ] capability 只开放已验收链和 token
- [ ] 两份签名均由服务端恢复并逐字段校验
- [ ] 重复请求、超时和 RPC 不明结果不会双发
- [ ] receipt 校验 type-4、from、to、事件和余额
- [ ] 纯代付用户链上手续费和平台扣费均为 0
- [ ] 目标链完成零费用 canary 与 receipt 对账
- [ ] capability、索引、对账和告警完成后再开放流量

## 15. 代码参考

- `contracts/policy/SponsorPolicyRegistry.sol`
- `contracts/account/Sponsored7702Account.sol`
- `contracts/router/SponsorRouter.sol`
- `scripts/sponsored-payment.ts`
- `scripts/sponsored-payment-checks.ts`
- `evm-7702-sponsored/scripts/check-five-chain-deployments.ts`
- `evm-7702-sponsored/sdk/`
- `evm-7702-sponsored/docs/indexer.md`
