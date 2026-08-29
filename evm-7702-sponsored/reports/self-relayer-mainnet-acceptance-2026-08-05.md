# 自研 relayer 主网验收 — 2026-08-05

首次在 Ethereum、BSC、Arbitrum One 三条主网跑通自研代付，全程不经过第三方 relayer：用户链下签名，自有 sponsor 钱包发出 EIP-7702 type-4 交易并垫付原生 gas，用户在同一笔交易内用 ERC-20 偿还。

命令：`npm run canary:self-relayer -- --allow-mainnet`

这份是手写的验收记录。金丝雀自己生成的 `self-relayer-canary.md` 会被下一次运行覆盖，不适合长期留存。表中数据于同日直接从各链拉取回执核对，不依赖运行时输出。

## 参与方

四条链复用同一组地址。

| 角色 | 地址 | 说明 |
|---|---|---|
| 用户 | `0x0000000000000000000000007741ac3b13402f19` | 链下签名，通过 EIP-7702 委托，出付款与手续费 |
| sponsor | `0x000000000000000000000000e5007247e6ad64ed` | 发出交易，垫付原生 gas |
| 商户 | `0x000000000000000000000000727d326c544b07bc` | 收付款 |
| feeReceiver | `0x0000000000000000000000006627860470681dea` | 收手续费偿还 |

每笔交易的 `to` 是该链的 SponsorRouter：

| 链 | SponsorRouter | fee token |
|---|---|---|
| Ethereum | `0x0000000000000000000000005dc708e8e59868b7` | USDC `0xA0b86991…eB48`（6 位小数） |
| BSC | `0x000000000000000000000000ab2d2b5fb2e29d11` | USDT `0x55d39832…7955`（18 位小数） |
| Arbitrum One | `0x0000000000000000000000005dc708e8e59868b7` | USDC `0xaf88d065…5831`（6 位小数） |
| BSC Testnet | `0x000000000000000000000000c56f61bc69930ed6` | mock USDT / mock USDC（18 位小数） |

Ethereum 与 Arbitrum 的 router 同址是正常现象：同一 deployer 在两链上 nonce 相同，CREATE 算出的地址一致。

## 结果

五个目标全部成功。金额为链上 `Transfer` 事件的实际值。

| 链 | 币种 | 付款 | 手续费 | 用户共付 | gasUsed | sponsor 花费 |
|---|---|---|---|---|---|---|
| Ethereum | USDC | 0.001 | 0.001 | 0.002 | 158,102 | 0.0000170533 ETH |
| BSC | USDT | 0.001 | 0.001 | 0.002 | 145,336 | 0.0000072668 BNB |
| Arbitrum One | USDC | 0.001 | 0.01 | 0.011 | 158,848 | 0.00000317696 ETH |
| BSC Testnet | USDT (mock) | 0.001 | 0.001 | 0.002 | 146,472 | 0.0000146472 tBNB |
| BSC Testnet | USDC (mock) | 0.001 | 0.001 | 0.002 | 146,484 | 0.0000146484 tBNB |

三条主网合计 gas 成本约 0.0000202 ETH + 0.0000073 BNB。

### 交易哈希

- **Ethereum** [`0xb4386318…826170`](https://explorer.example/tx/redacted) — 区块 25686691
  `0x0000000000000000000000000000000000000000000000008f67eaef88f9f113`
- **BSC** [`0xc81eac7f…23ff7`](https://explorer.example/tx/redacted) — 区块 114107003
  `0x000000000000000000000000000000000000000000000000cc86a123fd358e03`
- **Arbitrum One** [`0x1da56658…0ed4ab`](https://explorer.example/tx/redacted) — 区块 491261001
  `0x000000000000000000000000000000000000000000000000d30cdfb70fdcaf5a`
- **BSC Testnet / USDT** [`0x55eaf1f2…26268`](https://explorer.example/tx/redacted) — 区块 123248856
  `0x00000000000000000000000000000000000000000000000019489b4b1f357941`
- **BSC Testnet / USDC** [`0x67131569…56d8c8`](https://explorer.example/tx/redacted) — 区块 123248904
  `0x00000000000000000000000000000000000000000000000019535dc4cd5f206b`

## 每笔核对的内容

链上回执逐笔确认：

- `status = success`
- `type = eip7702` —— 确实是 type-4 交易，不是普通合约调用
- `from` = sponsor 钱包 —— 垫付 gas 的是我们自己
- `to` = 该链的 SponsorRouter
- 恰好 2 条 ERC-20 `Transfer`：用户 → 商户（付款），用户 → feeReceiver（偿还）

脚本自身在发送后另外断言：`SponsoredCallForwarded` 恰好 1 条、`FeePaid` 恰好 1 条、account nonce 递增 1、用户与各收款方的余额变动与预期逐位相等。任一不符即报错退出。

## BSC 那笔的确认过程

BSC 交易发出后，脚本在等待回执时被 RPC 打断：

```
tx: 0x000000000000000000000000000000000000000000000000cc86a123fd358e03
An unknown RPC error occurred.
Details: Received an unexpected status code from https://bsc-rpc.publicnode.com
```

公共节点返回 403，属于限流，与交易本身无关。随后读链确认它确实已经执行：

| | 交易前 | 交易后 |
|---|---|---|
| account nonce | 4 | 5 |
| 用户 USDT | 1.496 | 1.494 |
| sponsor BNB | 0.00495372 | 0.0049464532 |

nonce 递增、用户余额精确减少 0.002（0.001 转账 + 0.001 手续费），与其余四条链行为一致。后续直接拉取回执也确认 `status = success`。

由此做了两个改动：`BSC_RPC_URL` 从公共节点换成有配额的端点；金丝雀新增 `unconfirmed` 状态，专门表示「已发出但未等到回执」，避免这种情况被当成失败而导致重跑重复扣款。

## 链上前置状态

同日 `npm run preflight:four-chain` 的结论：四条链的 registry、account 实现、router 均已部署，normalized bytecode 与本地编译产物逐一匹配，registry 三方绑定一致，均未暂停；当时自有 sponsor 与旧第三方 relayer 均在白名单中。当前独立分支只维护自研路径。

链上状态会变，**不要把这里的快照当作现状**，用 `npm run preflight:four-chain` 现查（只读，不发交易）。
