# EIP-7702 自研代付前端对接文档

> 适用对象：钱包与前端工程师
> 当前业务模式：纯代付（用户不偿还 gas，不收服务费）

## 1. 对接目标

前端负责收集业务参数、展示代付结果，并配合用户完成两份签名；后端负责生成可信交易内容、提交 EIP-7702 type-4 交易并支付原生 gas。

当前纯代付模式固定为：

- `gasFeeAmount = 0`
- `serviceFeeAmount = 0`
- 用户只支付业务金额，例如向商户转出 1 USDT
- Sponsor 钱包承担 ETH、BNB、POL 等原生 gas
- 同一笔交易中没有用户到 `feeReceiver` 的 ERC-20 偿还
- 不产生 `FeePaid` 事件

合约收费能力继续保留。后续开启收费时，由后端报价并把手续费字段加入用户签名，前端不能自行决定费用。

## 2. 网络与合约配置

| 网络 | Chain ID | Policy Registry | Account Implementation | Sponsor Router |
|---|---:|---|---|---|
| Ethereum | 1 | `0x00000000000000000000000057f71eb4fbe79dd9` | `0x0000000000000000000000007f6e04fe6180d1e7` | `0x0000000000000000000000005dc708e8e59868b7` |
| BSC | 56 | `0x000000000000000000000000ca848390f7e66b59` | `0x0000000000000000000000004d9bca433fc66f62` | `0x000000000000000000000000ab2d2b5fb2e29d11` |
| BSC Testnet | 97 | `0x000000000000000000000000c64f55a7740cef97` | `0x00000000000000000000000063c7480ea2a283e4` | `0x000000000000000000000000c56f61bc69930ed6` |
| Arbitrum One | 42161 | `0x000000000000000000000000ca848390f7e66b59` | `0x0000000000000000000000004d9bca433fc66f62` | `0x0000000000000000000000005dc708e8e59868b7` |
| Polygon PoS | 137 | `0x000000000000000000000000ca848390f7e66b59` | `0x0000000000000000000000004d9bca433fc66f62` | `0x00000000000000000000000072111f5ddfc88a71` |

前端不得硬编码合约、Sponsor 或 token 地址。生产运行时以后端 capability 与 quote 返回值为准；本表仅用于开发期核对网络和合约组合。

## 3. 推荐接口边界

以下是前后端应遵循的契约，具体 URL 可由业务后端统一命名。

### 3.1 获取能力配置

`GET /v1/sponsored/chains`

响应至少包含：

```json
{
  "chains": [
    {
      "chainId": 56,
      "name": "BSC",
      "enabled": true,
      "billingMode": "platform_subsidized",
      "accountImplementation": "0x0000000000000000000000004d9bca433fc66f62",
      "sponsorRouter": "0x000000000000000000000000ab2d2b5fb2e29d11",
      "tokens": [
        {
          "symbol": "USDT",
          "address": "0x...",
          "decimals": 18
        }
      ]
    }
  ]
}
```

前端只展示后端 capability 中 `enabled = true` 且 token 明确启用的组合。SDK 配置用于构造和校验 payload，不是产品开放状态的真相源。

### 3.2 创建代付预览

`POST /v1/sponsored/preview`

请求示例：

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

响应示例：

```json
{
  "quoteId": "q_...",
  "expiresAt": 1786321200,
  "billingMode": "platform_subsidized",
  "display": {
    "businessAmount": "1",
    "businessToken": "USDT",
    "userFee": "0",
    "gasPayer": "Sponsor"
  },
  "payload": {
    "account": "0xUser",
    "nonce": "7",
    "deadline": "1786321200",
    "sponsor": "0x000000000000000000000000e5007247e6ad64ed",
    "feeToken": "0x0000000000000000000000000000000000000000",
    "gasFeeAmount": "0",
    "serviceFeeAmount": "0",
    "feeReceiver": "0x0000000000000000000000000000000000000000",
    "callsHash": "0x..."
  },
  "calls": [
    {
      "target": "0xToken",
      "value": "0",
      "data": "0x..."
    }
  ]
}
```

金额必须使用最小单位的十进制字符串，禁止用 JavaScript `number` 传链上整数。

### 3.3 提交签名

`POST /v1/sponsored/execute`

```json
{
  "quoteId": "q_...",
  "clientRequestId": "order-20260810-001",
  "sponsoredSignature": "0x...",
  "authorization": {
    "address": "0xAccountImplementation",
    "chainId": 56,
    "nonce": "123",
    "r": "0x...",
    "s": "0x...",
    "v": "28",
    "yParity": 1
  }
}
```

响应至少返回 `requestId`、当前状态和可选 `txHash`。前端不得因超时自动创建新 quote 或重复签名，应先按 `clientRequestId` 查询原请求。

### 3.4 查询状态

`GET /v1/sponsored/requests/{requestId}`

建议状态：

- `accepted`：后端已接收
- `broadcasting`：Sponsor 正在提交交易
- `submitted`：已有 `txHash`
- `confirmed`：链上交易成功
- `settled`：链上金额、事件和余额已完成对账
- `failed`：确定失败，可以展示原因
- `expired`：quote 或签名过期，需要重新预览

只有 `settled` 才是业务最终成功。`submitted`、`unconfirmed` 或请求超时都不能直接当作失败重试。

## 4. 两份签名与三个 nonce

### 4.1 EIP-7702 authorization

这份签名授权用户 EOA 委托给 `Account Implementation`。它只绑定 chain ID、implementation 地址和用户 EOA nonce，不绑定 Sponsor、商户、金额或业务 calls。

authorization 在交易成功后通常继续保留，不是一次性授权。前端需要明确提示用户这是账户委托，而不是普通 ERC-20 转账签名。

### 4.2 EIP-712 SponsoredCall

这份签名才绑定单笔业务内容：

- `account`
- sponsored `nonce`
- `deadline`
- `sponsor`
- `feeToken`
- `gasFeeAmount`
- `serviceFeeAmount`
- `feeReceiver`
- `callsHash`

EIP-712 domain：

```text
name = Sponsored7702Account
version = 1
chainId = 当前链
verifyingContract = 用户 EOA 地址
```

前端必须展示并签后端返回的完整 payload，不能自行替换 `sponsor`、费用或 `callsHash`。

### 4.3 不同 nonce 不能混用

| nonce | 管理方 | 用途 |
|---|---|---|
| sponsored nonce | Account 合约逻辑/后端 | 防止同一 SponsoredCall 重放 |
| authorization nonce | 用户 EOA | EIP-7702 authorization 与交易 nonce 选择 |
| sponsor transaction nonce | 后端 Sponsor 钱包 | Sponsor 发出 type-4 交易 |

前端不得因为用户地址当前 `code` 为空就猜 sponsored nonce 为 `0`。用户可能曾经委托并执行后又清除 delegation，合约存储 nonce 仍可能非零；应使用后端 quote 返回值。

## 5. 前端签名流程

1. 从后端能力接口获取链、token 和合约地址。
2. 用户输入收款方和业务金额。
3. 调用 preview，展示业务金额、用户手续费为 0、Sponsor 支付 gas。
4. 校验钱包网络、账户地址、quote 过期时间和展示内容。
5. 钱包完成 EIP-7702 authorization 签名。
6. 钱包完成 EIP-712 SponsoredCall 签名。
7. 把两份签名连同 `quoteId`、`clientRequestId` 提交给后端。
8. 按 `requestId` 查询，直到 `settled` 或确定失败。

前端不得自行构造 ERC-20 calldata 后要求后端原样广播。后端必须根据可信订单数据重新编码并校验 `target`、selector、token、recipient 和 amount。

## 6. SDK 使用注意事项

仓库 `sdk/` 可作为编码参考，但接入前必须处理以下边界：

- `sdk/chains.ts` 提供链与 token 元数据；UI 是否开放仍以后端实时 capability 为准。
- SDK 目前根据本地 `tokenSymbol` 选择 `feeToken`，未核对后端 quote；生产前端应以后端 payload 为准。
- 当前 ABI 包未提供完整的 Registry 读取 ABI 和可靠的 sponsored nonce 查询封装。
- authorization 中包含 `bigint` 字段，不能直接 `JSON.stringify`；使用 `stringifySponsoredPayload` 或统一转成十进制字符串。
- 当前 viem 签 authorization 的路径要求钱包具备原生 EIP-7702 签名能力；普通 JSON-RPC 钱包连接不一定支持，必须逐钱包验收。
- `examples/payload.example.json` 是结构示例，不是可以直接广播的生产 payload。

推荐前端把“交易预览”和“签名内容”全部来自后端 quote，仅复用 SDK 的类型、hash 和序列化方法。

## 7. 纯代付模式的结果展示

一笔单商户 ERC-20 付款成功后，通常应看到：

- 1 条业务 `Transfer`：用户 → 商户
- 0 条手续费 `Transfer`：用户不会转给 `feeReceiver`
- 0 条 `FeePaid`
- 1 条 `SponsoredCallForwarded`
- Sponsor 原生币余额承担 gas

前端文案建议：

```text
你支付：1 USDT
网络费：由平台承担
服务费：0
```

不要显示“先扣费后返还”，因为当前模式根本不会从用户扣手续费。

## 8. 错误处理

| 场景 | 前端处理 |
|---|---|
| 钱包不支持 EIP-7702 authorization | 阻止提交并提示更换受支持钱包/版本 |
| 用户切换账户或网络 | 废弃当前 quote，重新 preview |
| quote/deadline 过期 | 重新 preview 和签名 |
| nonce 冲突 | 查询原请求状态；由后端刷新，不自行加一 |
| Sponsor 暂停或余额不足 | 展示服务暂不可用，不要求用户改用原生币 |
| 请求超时但已有可能广播 | 使用同一 `clientRequestId` 查询，禁止盲目重试 |
| receipt revert | 展示失败原因，业务订单不得标记完成 |

## 9. 链开放规则

前端不维护按链的发布进度。任一网络只有同时满足以下条件才可展示：

- 后端 capability 返回 `enabled=true`；
- capability 明确列出当前业务 token、地址和 decimals；
- 钱包支持目标网络的 EIP-7702 authorization 签名；
- quote 中的 chain、合约地址和 token 与 capability 一致；
- 后端状态查询和区块浏览器链接可用。

Polygon 只使用原生 USDC `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`，不得与 USDC.e `0x0000000000000000000000000922fb7af6f5f458` 混用。

## 10. 前端验收清单

- [ ] 支持的钱包可完成两份签名
- [ ] 钱包不支持时有明确提示
- [ ] 金额全程使用最小单位字符串/`bigint`
- [ ] 页面明确显示用户手续费为 0
- [ ] 网络或账户变化会使 quote 失效
- [ ] 重复点击不会创建重复交易
- [ ] 页面以 `settled` 为最终成功状态
- [ ] 区块浏览器链接指向正确链和 `txHash`
- [ ] 零费用交易不要求存在 `FeePaid`
- [ ] 任一网络仅在后端 capability 明确启用后可见和可选

## 11. 代码参考

- `evm-7702-sponsored/sdk/index.ts`
- `evm-7702-sponsored/sdk/types.ts`
- `evm-7702-sponsored/sdk/chains.ts`
- `contracts/account/Sponsored7702Account.sol`
- `contracts/policy/SponsorPolicyRegistry.sol`
- `contracts/router/SponsorRouter.sol`
