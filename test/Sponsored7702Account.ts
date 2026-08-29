import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbiParameters,
  parseEventLogs,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

const CALL_TYPEHASH = keccak256(
  new TextEncoder().encode("Call(address target,uint256 value,bytes32 dataHash)"),
);

const sponsoredCallTypes = {
  SponsoredCall: [
    { name: "account", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "sponsor", type: "address" },
    { name: "feeToken", type: "address" },
    { name: "gasFeeAmount", type: "uint256" },
    { name: "serviceFeeAmount", type: "uint256" },
    { name: "feeReceiver", type: "address" },
    { name: "callsHash", type: "bytes32" },
  ],
} as const;

type SponsoredCall = {
  account: Address;
  nonce: bigint;
  deadline: bigint;
  sponsor: Address;
  feeToken: Address;
  gasFeeAmount: bigint;
  serviceFeeAmount: bigint;
  feeReceiver: Address;
  callsHash: Hex;
};

type Call = {
  target: Address;
  value: bigint;
  data: Hex;
};

function hashCall(call: Call): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32,address,uint256,bytes32"), [
      CALL_TYPEHASH,
      call.target,
      call.value,
      keccak256(call.data),
    ]),
  );
}

function hashCalls(calls: Call[]): Hex {
  return keccak256(concat(calls.map(hashCall)));
}

describe("Sponsored7702Account", function () {
  async function fixture() {
    const { viem } = await network.create();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
    const [user, sponsor, otherSponsor, feeReceiver, otherFeeReceiver] = await viem.getWalletClients();

    const registry = await viem.deployContract("SponsorPolicyRegistry", [
      user.account.address,
      feeReceiver.account.address,
    ]);
    await registry.write.setSponsor([sponsor.account.address, true]);

    const implementation = await viem.deployContract("Sponsored7702Account", [registry.address]);
    const router = await viem.deployContract("SponsorRouter", [registry.address]);
    await registry.write.setRouter([router.address]);
    await registry.write.setFeePolicy([
      {
        maxGasFeeAmount: 1_000_000n,
        maxServiceFeeAmount: 1_000_000n,
        maxTotalFeeAmount: 2_000_000n,
        maxCalls: 10n,
      },
    ]);
    const bytecode = await publicClient.getCode({ address: implementation.address });
    assert.ok(bytecode, "implementation bytecode should exist");

    const accountAddress = user.account.address;
    await testClient.setCode({ address: accountAddress, bytecode });

    const account = await viem.getContractAt("Sponsored7702Account", accountAddress, {
      client: { public: publicClient, wallet: sponsor },
    });
    const accountAsUser = await viem.getContractAt("Sponsored7702Account", accountAddress, {
      client: { public: publicClient, wallet: user },
    });
    const accountAsOtherSponsor = await viem.getContractAt("Sponsored7702Account", accountAddress, {
      client: { public: publicClient, wallet: otherSponsor },
    });
    const registryAsOtherSponsor = await viem.getContractAt("SponsorPolicyRegistry", registry.address, {
      client: { public: publicClient, wallet: otherSponsor },
    });
    const sponsorRouter = await viem.getContractAt("SponsorRouter", router.address, {
      client: { public: publicClient, wallet: sponsor },
    });
    const routerAsOtherSponsor = await viem.getContractAt("SponsorRouter", router.address, {
      client: { public: publicClient, wallet: otherSponsor },
    });

    const mockTarget = await viem.deployContract("MockTarget");
    const usdt = await viem.deployContract("MockERC20");
    const usdc = await viem.deployContract("MockERC20");
    const usdg = await viem.deployContract("MockERC20");
    const falseReturnToken = await viem.deployContract("MockFalseReturnERC20");
    const noReturnToken = await viem.deployContract("MockNoReturnERC20");
    const reentrantTarget = await viem.deployContract("MockReentrantTarget");

    await registry.write.setSupportedFeeToken([usdt.address, true]);
    await registry.write.setSupportedFeeToken([usdc.address, true]);
    await registry.write.setSupportedFeeToken([falseReturnToken.address, true]);
    await registry.write.setSupportedFeeToken([noReturnToken.address, true]);

    async function signSponsoredRequest(params: {
      calls: Call[];
      feeReceiverAddress?: Address;
      feeTokenAddress?: Address;
      gasFeeAmount?: bigint;
      serviceFeeAmount?: bigint;
      sponsorAddress?: Address;
      nonce?: bigint;
      deadline?: bigint;
      domainChainId?: number;
      verifyingContractAddress?: Address;
    }) {
      const chainId = await publicClient.getChainId();
      const block = await publicClient.getBlock();
      const request: SponsoredCall = {
        account: accountAddress,
        nonce: params.nonce ?? (await account.read.getNonce()),
        deadline: params.deadline ?? block.timestamp + 3600n,
        sponsor: params.sponsorAddress ?? sponsor.account.address,
        feeToken: params.feeTokenAddress ?? zeroAddress,
        gasFeeAmount: params.gasFeeAmount ?? 0n,
        serviceFeeAmount: params.serviceFeeAmount ?? 0n,
        feeReceiver: params.feeReceiverAddress ?? zeroAddress,
        callsHash: hashCalls(params.calls),
      };

      const signature = await user.signTypedData({
        account: user.account,
        domain: {
          name: "Sponsored7702Account",
          version: "1",
          chainId: params.domainChainId ?? chainId,
          verifyingContract: params.verifyingContractAddress ?? accountAddress,
        },
        types: sponsoredCallTypes,
        primaryType: "SponsoredCall",
        message: request,
      });

      return { request, signature };
    }

    return {
      account,
      accountAddress,
      accountAsOtherSponsor,
      accountAsUser,
      falseReturnToken,
      feeReceiver,
      mockTarget,
      noReturnToken,
      otherFeeReceiver,
      otherSponsor,
      publicClient,
      reentrantTarget,
      registry,
      registryAsOtherSponsor,
      router: sponsorRouter,
      routerAsOtherSponsor,
      signSponsoredRequest,
      sponsor,
      usdc,
      usdg,
      usdt,
      user,
    };
  }

  it("is ready to execute without initialization after the account code is set", async function () {
    const { account, accountAddress, accountAsUser, mockTarget, router, signSponsoredRequest } = await fixture();

    assert.equal(await account.read.getNonce(), 0n);

    const selfCalls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setText", args: ["self-ready"] }),
      },
    ];
    await accountAsUser.write.executeFromSelf([selfCalls]);

    assert.equal(await mockTarget.read.text(), "self-ready");
    assert.equal((await mockTarget.read.lastSender()).toLowerCase(), accountAddress.toLowerCase());
    assert.equal(await account.read.getNonce(), 0n);

    const sponsoredCalls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [9n] }),
      },
    ];
    const { request, signature } = await signSponsoredRequest({ calls: sponsoredCalls });
    await router.write.executeSponsored([request, sponsoredCalls, signature]);

    assert.equal(await mockTarget.read.value(), 9n);
    assert.equal(await account.read.getNonce(), 1n);
  });

  it("lets only the registry owner manage sponsors, fee tokens, fee receiver, router, and fee policy", async function () {
    const { feeReceiver, otherFeeReceiver, otherSponsor, registry, registryAsOtherSponsor, router, usdc, usdg, user } =
      await fixture();

    assert.equal(await registry.read.paused(), false);
    await registry.write.pause();
    assert.equal(await registry.read.paused(), true);
    await registry.write.unpause();
    assert.equal(await registry.read.paused(), false);

    await registry.write.setSponsor([otherSponsor.account.address, true]);
    assert.equal(await registry.read.isSponsor([otherSponsor.account.address]), true);

    await registry.write.setSponsor([otherSponsor.account.address, false]);
    assert.equal(await registry.read.isSponsor([otherSponsor.account.address]), false);

    assert.equal(await registry.read.isSupportedFeeToken([usdc.address]), true);
    assert.equal(await registry.read.isSupportedFeeToken([usdg.address]), false);

    await registry.write.setSupportedFeeToken([usdg.address, true]);
    assert.equal(await registry.read.isSupportedFeeToken([usdg.address]), true);

    await registry.write.setFeeReceiver([otherFeeReceiver.account.address]);
    assert.equal((await registry.read.feeReceiver()).toLowerCase(), otherFeeReceiver.account.address.toLowerCase());

    await registry.write.setFeeReceiver([feeReceiver.account.address]);
    assert.equal((await registry.read.router()).toLowerCase(), router.address.toLowerCase());

    await registry.write.setFeePolicy([
      {
        maxGasFeeAmount: 100n,
        maxServiceFeeAmount: 20n,
        maxTotalFeeAmount: 120n,
        maxCalls: 3n,
      },
    ]);
    const feePolicy = await registry.read.feePolicy();
    assert.equal(feePolicy.maxGasFeeAmount, 100n);
    assert.equal(feePolicy.maxServiceFeeAmount, 20n);
    assert.equal(feePolicy.maxTotalFeeAmount, 120n);
    assert.equal(feePolicy.maxCalls, 3n);

    await assert.rejects(
      registryAsOtherSponsor.write.setSupportedFeeToken([usdg.address, false]),
      /OwnableUnauthorizedAccount/,
    );
    await assert.rejects(registryAsOtherSponsor.write.setRouter([router.address]), /OwnableUnauthorizedAccount/);
    await assert.rejects(
      registryAsOtherSponsor.write.setFeePolicy([
        {
          maxGasFeeAmount: 1n,
          maxServiceFeeAmount: 1n,
          maxTotalFeeAmount: 1n,
          maxCalls: 1n,
        },
      ]),
      /OwnableUnauthorizedAccount/,
    );
    await assert.rejects(registryAsOtherSponsor.write.pause(), /OwnableUnauthorizedAccount/);
    await assert.rejects(registryAsOtherSponsor.write.unpause(), /OwnableUnauthorizedAccount/);
    await assert.rejects(registry.write.setSponsor([zeroAddress, true]), /ZeroAddress/);
    await assert.rejects(registry.write.setSupportedFeeToken([zeroAddress, true]), /ZeroAddress/);
    await assert.rejects(registry.write.setFeeReceiver([zeroAddress]), /ZeroAddress/);
    await assert.rejects(registry.write.setRouter([zeroAddress]), /InvalidRouter/);

    await registry.write.transferOwnership([otherSponsor.account.address]);
    assert.equal((await registry.read.owner()).toLowerCase(), user.account.address.toLowerCase());
    assert.equal((await registry.read.pendingOwner()).toLowerCase(), otherSponsor.account.address.toLowerCase());

    await registryAsOtherSponsor.write.acceptOwnership();
    assert.equal((await registry.read.owner()).toLowerCase(), otherSponsor.account.address.toLowerCase());

    await registryAsOtherSponsor.write.setSponsor([otherSponsor.account.address, true]);
    assert.equal(await registry.read.isSponsor([otherSponsor.account.address]), true);
  });

  it("executes from self without charging fees or consuming the sponsored nonce", async function () {
    const { accountAsUser, accountAddress, mockTarget, publicClient } = await fixture();
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [5n] }),
      },
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setText", args: ["self"] }),
      },
    ];

    const hash = await accountAsUser.write.executeFromSelf([calls]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const feePaid = parseEventLogs({
      abi: accountAsUser.abi,
      eventName: "FeePaid",
      logs: receipt.logs,
    });
    const [selfExecuted] = parseEventLogs({
      abi: accountAsUser.abi,
      eventName: "SelfExecuted",
      logs: receipt.logs,
    });

    assert.equal(await mockTarget.read.value(), 5n);
    assert.equal(await mockTarget.read.text(), "self");
    assert.equal((await mockTarget.read.lastSender()).toLowerCase(), accountAddress.toLowerCase());
    assert.equal(await accountAsUser.read.getNonce(), 0n);
    assert.equal(feePaid.length, 0);
    assert.equal(selfExecuted.args.callsHash, hashCalls(calls));
  });

  it("rejects executeFromSelf from non-self callers", async function () {
    const { account, mockTarget } = await fixture();
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [1n] }),
      },
    ];

    await assert.rejects(account.write.executeFromSelf([calls]), /SelfCallOnly/);
  });

  it("rejects sponsored execution when the account is called without the router", async function () {
    const { account, mockTarget, signSponsoredRequest, sponsor } = await fixture();
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [1n] }),
      },
    ];
    const { request, signature } = await signSponsoredRequest({ calls });

    await assert.rejects(
      account.write.executeSponsoredFromRouter([request, calls, signature, sponsor.account.address]),
      /NotRouter/,
    );
  });

  it("pauses sponsored execution without blocking executeFromSelf", async function () {
    const { account, accountAsUser, mockTarget, registry, router, signSponsoredRequest } = await fixture();
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [11n] }),
      },
    ];
    const { request, signature } = await signSponsoredRequest({ calls });

    await registry.write.pause();
    await assert.rejects(router.write.executeSponsored([request, calls, signature]), /PolicyPaused/);

    await accountAsUser.write.executeFromSelf([calls]);
    assert.equal(await mockTarget.read.value(), 11n);
    assert.equal(await account.read.getNonce(), 0n);

    await registry.write.unpause();
    await router.write.executeSponsored([request, calls, signature]);
    assert.equal(await account.read.getNonce(), 1n);
  });

  it("rejects non-sponsor relayers and mismatched sponsors", async function () {
    const { mockTarget, otherSponsor, router, routerAsOtherSponsor, signSponsoredRequest } = await fixture();
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [1n] }),
      },
    ];

    const nonSponsor = await signSponsoredRequest({
      calls,
      sponsorAddress: otherSponsor.account.address,
    });
    await assert.rejects(
      routerAsOtherSponsor.write.executeSponsored([nonSponsor.request, calls, nonSponsor.signature]),
      /NotSponsor/,
    );

    await assert.rejects(
      router.write.executeSponsored([nonSponsor.request, calls, nonSponsor.signature]),
      /InvalidSponsor/,
    );
  });

  it("rejects router requests for accounts without delegated code", async function () {
    const { mockTarget, otherSponsor, router, signSponsoredRequest } = await fixture();
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [1n] }),
      },
    ];
    const { request, signature } = await signSponsoredRequest({ calls });

    await assert.rejects(
      router.write.executeSponsored([
        {
          ...request,
          account: otherSponsor.account.address,
        },
        calls,
        signature,
      ]),
      /AccountNotDelegated/,
    );
  });

  it("executes a valid sponsored call and consumes the nonce", async function () {
    const { account, accountAddress, mockTarget, router, signSponsoredRequest } = await fixture();
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [42n] }),
      },
    ];
    const { request, signature } = await signSponsoredRequest({ calls });

    await router.write.executeSponsored([request, calls, signature]);

    assert.equal(await mockTarget.read.value(), 42n);
    assert.equal((await mockTarget.read.lastSender()).toLowerCase(), accountAddress.toLowerCase());
    assert.equal(await account.read.getNonce(), 1n);
  });

  it("rejects native value sent to the sponsor router", async function () {
    const { account, mockTarget, router, signSponsoredRequest } = await fixture();
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [42n] }),
      },
    ];
    const { request, signature } = await signSponsoredRequest({ calls });

    await assert.rejects(
      router.write.executeSponsored([request, calls, signature], { value: 1n }),
      /UnexpectedNativeValue/,
    );
    assert.equal(await mockTarget.read.value(), 0n);
    assert.equal(await account.read.getNonce(), 0n);
  });

  it("rejects sponsored batches above the registry maxCalls policy", async function () {
    const { account, mockTarget, registry, router, signSponsoredRequest } = await fixture();
    await registry.write.setFeePolicy([
      {
        maxGasFeeAmount: 1_000_000n,
        maxServiceFeeAmount: 1_000_000n,
        maxTotalFeeAmount: 2_000_000n,
        maxCalls: 1n,
      },
    ]);

    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [42n] }),
      },
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setText", args: ["too-many"] }),
      },
    ];
    const { request, signature } = await signSponsoredRequest({ calls });

    await assert.rejects(router.write.executeSponsored([request, calls, signature]), /TooManyCalls/);
    assert.equal(await mockTarget.read.value(), 0n);
    assert.equal(await account.read.getNonce(), 0n);
  });

  it("accepts the exact call-count boundary and atomically rejects one extra call", async function () {
    const { account, mockTarget, registry, router, signSponsoredRequest } = await fixture();
    await registry.write.setFeePolicy([
      {
        maxGasFeeAmount: 1_000_000n,
        maxServiceFeeAmount: 1_000_000n,
        maxTotalFeeAmount: 2_000_000n,
        maxCalls: 2n,
      },
    ]);

    const twoCalls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [42n] }),
      },
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setText", args: ["boundary"] }),
      },
    ];
    const accepted = await signSponsoredRequest({ calls: twoCalls });
    await router.write.executeSponsored([accepted.request, twoCalls, accepted.signature]);

    assert.equal(await mockTarget.read.value(), 42n);
    assert.equal(await mockTarget.read.text(), "boundary");
    assert.equal(await account.read.getNonce(), 1n);

    const threeCalls = [
      ...twoCalls,
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [99n] }),
      },
    ];
    const rejected = await signSponsoredRequest({ calls: threeCalls });
    await assert.rejects(
      router.write.executeSponsored([rejected.request, threeCalls, rejected.signature]),
      /TooManyCalls/,
    );

    assert.equal(await mockTarget.read.value(), 42n);
    assert.equal(await mockTarget.read.text(), "boundary");
    assert.equal(await account.read.getNonce(), 1n);
  });

  it("allows sponsored batches when registry maxCalls is zero", async function () {
    const { account, mockTarget, registry, router, signSponsoredRequest } = await fixture();

    await registry.write.setFeePolicy([
      {
        maxGasFeeAmount: 1_000_000n,
        maxServiceFeeAmount: 1_000_000n,
        maxTotalFeeAmount: 2_000_000n,
        maxCalls: 0n,
      },
    ]);

    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({
          abi: mockTarget.abi,
          functionName: "setValue",
          args: [42n],
        }),
      },
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({
          abi: mockTarget.abi,
          functionName: "setText",
          args: ["unlimited"],
        }),
      },
    ];

    const { request, signature } = await signSponsoredRequest({ calls });

    await router.write.executeSponsored([request, calls, signature]);

    assert.equal(await mockTarget.read.value(), 42n);
    assert.equal(await mockTarget.read.text(), "unlimited");
    assert.equal(await account.read.getNonce(), 1n);
  });

  it("charges USDT and USDC fees to the registry receiver", async function () {
    const {
      account,
      accountAddress,
      feeReceiver,
      mockTarget,
      publicClient,
      router,
      signSponsoredRequest,
      sponsor,
      usdc,
      usdt,
    } = await fixture();
    const gasFeeAmount = 25n;
    const serviceFeeAmount = 5n;
    const totalFeeAmount = gasFeeAmount + serviceFeeAmount;
    await usdt.write.mint([accountAddress, totalFeeAmount]);
    await usdc.write.mint([accountAddress, gasFeeAmount]);

    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [42n] }),
      },
    ];
    const usdtRequest = await signSponsoredRequest({
      calls,
      gasFeeAmount,
      serviceFeeAmount,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: usdt.address,
    });

    const hash = await router.write.executeSponsored([usdtRequest.request, calls, usdtRequest.signature]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const [feePaid] = parseEventLogs({
      abi: account.abi,
      eventName: "FeePaid",
      logs: receipt.logs,
    });

    assert.equal(await usdt.read.balanceOf([accountAddress]), 0n);
    assert.equal(await usdt.read.balanceOf([feeReceiver.account.address]), totalFeeAmount);
    assert.equal(feePaid.args.account.toLowerCase(), accountAddress.toLowerCase());
    assert.equal(feePaid.args.sponsor.toLowerCase(), sponsor.account.address.toLowerCase());
    assert.equal(feePaid.args.feeToken.toLowerCase(), usdt.address.toLowerCase());
    assert.equal(feePaid.args.feeReceiver.toLowerCase(), feeReceiver.account.address.toLowerCase());
    assert.equal(feePaid.args.gasFeeAmount, gasFeeAmount);
    assert.equal(feePaid.args.serviceFeeAmount, serviceFeeAmount);
    assert.equal(feePaid.args.totalFeeAmount, totalFeeAmount);

    const usdcRequest = await signSponsoredRequest({
      calls,
      gasFeeAmount,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: usdc.address,
    });
    await router.write.executeSponsored([usdcRequest.request, calls, usdcRequest.signature]);

    assert.equal(await usdc.read.balanceOf([accountAddress]), 0n);
    assert.equal(await usdc.read.balanceOf([feeReceiver.account.address]), gasFeeAmount);
  });

  it("accepts fee tokens whose transfer function returns no value", async function () {
    const { account, accountAddress, feeReceiver, mockTarget, noReturnToken, router, signSponsoredRequest } =
      await fixture();
    const gasFeeAmount = 10n;
    const serviceFeeAmount = 5n;
    const totalFeeAmount = gasFeeAmount + serviceFeeAmount;
    await noReturnToken.write.mint([accountAddress, totalFeeAmount]);

    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [17n] }),
      },
    ];
    const { request, signature } = await signSponsoredRequest({
      calls,
      gasFeeAmount,
      serviceFeeAmount,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: noReturnToken.address,
    });

    await router.write.executeSponsored([request, calls, signature]);

    assert.equal(await noReturnToken.read.balanceOf([accountAddress]), 0n);
    assert.equal(await noReturnToken.read.balanceOf([feeReceiver.account.address]), totalFeeAmount);
    assert.equal(await mockTarget.read.value(), 17n);
    assert.equal(await account.read.getNonce(), 1n);
  });

  it("allows USDG after the registry supports it", async function () {
    const { accountAddress, feeReceiver, mockTarget, registry, router, signSponsoredRequest, usdg } = await fixture();
    const gasFeeAmount = 10n;
    await usdg.write.mint([accountAddress, gasFeeAmount]);
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [7n] }),
      },
    ];

    const unsupported = await signSponsoredRequest({
      calls,
      gasFeeAmount,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: usdg.address,
    });
    await assert.rejects(
      router.write.executeSponsored([unsupported.request, calls, unsupported.signature]),
      /UnsupportedFeeToken/,
    );

    await registry.write.setSupportedFeeToken([usdg.address, true]);

    await router.write.executeSponsored([unsupported.request, calls, unsupported.signature]);
    assert.equal(await usdg.read.balanceOf([feeReceiver.account.address]), gasFeeAmount);
  });

  it("does not require fee token or receiver when total fee is zero", async function () {
    const { account, mockTarget, publicClient, router, signSponsoredRequest } = await fixture();
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [3n] }),
      },
    ];
    const { request, signature } = await signSponsoredRequest({ calls });

    const hash = await router.write.executeSponsored([request, calls, signature]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const feePaid = parseEventLogs({
      abi: account.abi,
      eventName: "FeePaid",
      logs: receipt.logs,
    });

    assert.equal(await mockTarget.read.value(), 3n);
    assert.equal(feePaid.length, 0);
  });

  it("rejects fees that exceed the global fee policy", async function () {
    const { feeReceiver, mockTarget, registry, router, signSponsoredRequest, usdt } = await fixture();
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [1n] }),
      },
    ];

    await registry.write.setFeePolicy([
      {
        maxGasFeeAmount: 10n,
        maxServiceFeeAmount: 100n,
        maxTotalFeeAmount: 100n,
        maxCalls: 10n,
      },
    ]);
    const gasTooHigh = await signSponsoredRequest({
      calls,
      gasFeeAmount: 11n,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: usdt.address,
    });
    await assert.rejects(
      router.write.executeSponsored([gasTooHigh.request, calls, gasTooHigh.signature]),
      /GasFeeTooHigh/,
    );

    await registry.write.setFeePolicy([
      {
        maxGasFeeAmount: 100n,
        maxServiceFeeAmount: 10n,
        maxTotalFeeAmount: 100n,
        maxCalls: 10n,
      },
    ]);
    const serviceTooHigh = await signSponsoredRequest({
      calls,
      serviceFeeAmount: 11n,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: usdt.address,
    });
    await assert.rejects(
      router.write.executeSponsored([serviceTooHigh.request, calls, serviceTooHigh.signature]),
      /ServiceFeeTooHigh/,
    );

    await registry.write.setFeePolicy([
      {
        maxGasFeeAmount: 10n,
        maxServiceFeeAmount: 10n,
        maxTotalFeeAmount: 10n,
        maxCalls: 10n,
      },
    ]);
    const totalTooHigh = await signSponsoredRequest({
      calls,
      gasFeeAmount: 6n,
      serviceFeeAmount: 5n,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: usdt.address,
    });
    await assert.rejects(
      router.write.executeSponsored([totalTooHigh.request, calls, totalTooHigh.signature]),
      /TotalFeeTooHigh/,
    );
  });

  it("accepts exact fee limits and rejects each policy limit above its boundary", async function () {
    const { account, accountAddress, feeReceiver, mockTarget, registry, router, signSponsoredRequest, usdt } =
      await fixture();
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [23n] }),
      },
    ];

    await registry.write.setFeePolicy([
      {
        maxGasFeeAmount: 10n,
        maxServiceFeeAmount: 5n,
        maxTotalFeeAmount: 15n,
        maxCalls: 1n,
      },
    ]);
    await usdt.write.mint([accountAddress, 15n]);
    const exact = await signSponsoredRequest({
      calls,
      gasFeeAmount: 10n,
      serviceFeeAmount: 5n,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: usdt.address,
    });
    await router.write.executeSponsored([exact.request, calls, exact.signature]);
    assert.equal(await usdt.read.balanceOf([feeReceiver.account.address]), 15n);
    assert.equal(await account.read.getNonce(), 1n);

    const gasTooHigh = await signSponsoredRequest({
      calls,
      gasFeeAmount: 11n,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: usdt.address,
    });
    await assert.rejects(
      router.write.executeSponsored([gasTooHigh.request, calls, gasTooHigh.signature]),
      /GasFeeTooHigh/,
    );

    const serviceTooHigh = await signSponsoredRequest({
      calls,
      serviceFeeAmount: 6n,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: usdt.address,
    });
    await assert.rejects(
      router.write.executeSponsored([serviceTooHigh.request, calls, serviceTooHigh.signature]),
      /ServiceFeeTooHigh/,
    );

    await registry.write.setFeePolicy([
      {
        maxGasFeeAmount: 10n,
        maxServiceFeeAmount: 5n,
        maxTotalFeeAmount: 14n,
        maxCalls: 1n,
      },
    ]);
    const totalTooHigh = await signSponsoredRequest({
      calls,
      gasFeeAmount: 10n,
      serviceFeeAmount: 5n,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: usdt.address,
    });
    await assert.rejects(
      router.write.executeSponsored([totalTooHigh.request, calls, totalTooHigh.signature]),
      /TotalFeeTooHigh/,
    );

    assert.equal(await usdt.read.balanceOf([feeReceiver.account.address]), 15n);
    assert.equal(await account.read.getNonce(), 1n);
  });

  it("rejects invalid fee token, receiver, and failed fee payments", async function () {
    const {
      account,
      accountAddress,
      falseReturnToken,
      feeReceiver,
      mockTarget,
      otherFeeReceiver,
      router,
      signSponsoredRequest,
      usdg,
      usdt,
    } = await fixture();
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [1n] }),
      },
    ];

    const invalidToken = await signSponsoredRequest({
      calls,
      gasFeeAmount: 10n,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: zeroAddress,
    });
    await assert.rejects(
      router.write.executeSponsored([invalidToken.request, calls, invalidToken.signature]),
      /InvalidFeeToken/,
    );

    const unsupportedToken = await signSponsoredRequest({
      calls,
      gasFeeAmount: 10n,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: usdg.address,
    });
    await assert.rejects(
      router.write.executeSponsored([unsupportedToken.request, calls, unsupportedToken.signature]),
      /UnsupportedFeeToken/,
    );

    const wrongReceiver = await signSponsoredRequest({
      calls,
      gasFeeAmount: 10n,
      feeReceiverAddress: otherFeeReceiver.account.address,
      feeTokenAddress: usdt.address,
    });
    await assert.rejects(
      router.write.executeSponsored([wrongReceiver.request, calls, wrongReceiver.signature]),
      /InvalidFeeReceiver/,
    );

    const insufficientFee = await signSponsoredRequest({
      calls,
      gasFeeAmount: 10n,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: usdt.address,
    });
    await assert.rejects(
      router.write.executeSponsored([insufficientFee.request, calls, insufficientFee.signature]),
      /FeePaymentFailed/,
    );

    await falseReturnToken.write.mint([accountAddress, 10n]);
    const falseReturnFee = await signSponsoredRequest({
      calls,
      gasFeeAmount: 10n,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: falseReturnToken.address,
    });
    await assert.rejects(
      router.write.executeSponsored([falseReturnFee.request, calls, falseReturnFee.signature]),
      /FeePaymentFailed/,
    );
  });

  it("binds signatures to account, sponsor, calls, fee token, and fee amounts", async function () {
    const { feeReceiver, mockTarget, otherSponsor, router, signSponsoredRequest, usdc, usdt } = await fixture();
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [1n] }),
      },
    ];
    const { request, signature } = await signSponsoredRequest({
      calls,
      gasFeeAmount: 10n,
      serviceFeeAmount: 0n,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: usdt.address,
    });

    await assert.rejects(
      router.write.executeSponsored([{ ...request, account: otherSponsor.account.address }, calls, signature]),
      /AccountNotDelegated/,
    );
    await assert.rejects(
      router.write.executeSponsored([{ ...request, gasFeeAmount: 11n }, calls, signature]),
      /InvalidSignature/,
    );
    await assert.rejects(
      router.write.executeSponsored([{ ...request, serviceFeeAmount: 1n }, calls, signature]),
      /InvalidSignature/,
    );
    await assert.rejects(
      router.write.executeSponsored([{ ...request, feeToken: usdc.address }, calls, signature]),
      /InvalidSignature/,
    );

    const modifiedCalls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [2n] }),
      },
    ];
    await assert.rejects(
      router.write.executeSponsored([request, modifiedCalls, signature]),
      /InvalidSignature/,
    );
  });

  it("binds EIP-712 signatures to the chain and delegated account domain", async function () {
    const { account, accountAddress, feeReceiver, mockTarget, publicClient, router, signSponsoredRequest, usdt } =
      await fixture();
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [31n] }),
      },
    ];
    await usdt.write.mint([accountAddress, 20n]);
    const common = {
      calls,
      gasFeeAmount: 10n,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: usdt.address,
    };
    const chainId = await publicClient.getChainId();
    const wrongChain = await signSponsoredRequest({
      ...common,
      domainChainId: chainId + 1,
    });
    await assert.rejects(
      router.write.executeSponsored([wrongChain.request, calls, wrongChain.signature]),
      /InvalidSignature/,
    );

    const wrongContract = await signSponsoredRequest({
      ...common,
      verifyingContractAddress: router.address,
    });
    await assert.rejects(
      router.write.executeSponsored([wrongContract.request, calls, wrongContract.signature]),
      /InvalidSignature/,
    );

    assert.equal(await mockTarget.read.value(), 0n);
    assert.equal(await account.read.getNonce(), 0n);
    assert.equal(await usdt.read.balanceOf([accountAddress]), 20n);
    assert.equal(await usdt.read.balanceOf([feeReceiver.account.address]), 0n);
  });

  it("rejects replayed nonces and expired requests", async function () {
    const { account, mockTarget, publicClient, router, signSponsoredRequest } = await fixture();
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [1n] }),
      },
    ];
    const { request, signature } = await signSponsoredRequest({ calls });

    await router.write.executeSponsored([request, calls, signature]);
    await assert.rejects(router.write.executeSponsored([request, calls, signature]), /InvalidNonce/);

    const block = await publicClient.getBlock();
    const expired = await signSponsoredRequest({ calls, deadline: block.timestamp - 1n });
    await assert.rejects(
      router.write.executeSponsored([expired.request, calls, expired.signature]),
      /SignatureExpired/,
    );
  });

  it("charges the sponsor fee before executing batch calls", async function () {
    const { accountAddress, feeReceiver, otherSponsor, router, signSponsoredRequest, usdt } = await fixture();
    const gasFeeAmount = 10n;
    await usdt.write.mint([accountAddress, gasFeeAmount]);

    const calls = [
      {
        target: usdt.address,
        value: 0n,
        data: encodeFunctionData({
          abi: usdt.abi,
          functionName: "transfer",
          args: [otherSponsor.account.address, gasFeeAmount],
        }),
      },
    ];
    const { request, signature } = await signSponsoredRequest({
      calls,
      gasFeeAmount,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: usdt.address,
    });

    await assert.rejects(router.write.executeSponsored([request, calls, signature]), /CallFailed/);
    assert.equal(await usdt.read.balanceOf([accountAddress]), gasFeeAmount);
    assert.equal(await usdt.read.balanceOf([feeReceiver.account.address]), 0n);
    assert.equal(await usdt.read.balanceOf([otherSponsor.account.address]), 0n);
  });

  it("rolls back target state, fees, nonce, and logs when a later batch call fails", async function () {
    const { account, accountAddress, feeReceiver, mockTarget, publicClient, router, signSponsoredRequest, usdt } =
      await fixture();
    const totalFeeAmount = 15n;
    await usdt.write.mint([accountAddress, totalFeeAmount]);
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [71n] }),
      },
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "fail", args: ["0xabcd"] }),
      },
    ];
    const { request, signature } = await signSponsoredRequest({
      calls,
      gasFeeAmount: 10n,
      serviceFeeAmount: 5n,
      feeReceiverAddress: feeReceiver.account.address,
      feeTokenAddress: usdt.address,
    });
    const fromBlock = await publicClient.getBlockNumber();

    await assert.rejects(
      router.write.executeSponsored([request, calls, signature], { gas: 2_000_000n }),
      /CallFailed/,
    );

    assert.equal(await mockTarget.read.value(), 0n);
    assert.equal(await account.read.getNonce(), 0n);
    assert.equal(await usdt.read.balanceOf([accountAddress]), totalFeeAmount);
    assert.equal(await usdt.read.balanceOf([feeReceiver.account.address]), 0n);
    const accountLogs = await publicClient.getLogs({
      address: accountAddress,
      fromBlock,
      toBlock: await publicClient.getBlockNumber(),
    });
    assert.equal(accountLogs.length, 0);
  });

  it("reverts invalid targets, empty calls, and failed calls", async function () {
    const { accountAsUser, mockTarget, router, signSponsoredRequest } = await fixture();
    const empty = await signSponsoredRequest({ calls: [] });
    await assert.rejects(router.write.executeSponsored([empty.request, [], empty.signature]), /EmptyCalls/);
    await assert.rejects(accountAsUser.write.executeFromSelf([[]]), /EmptyCalls/);

    const zeroTargetCalls = [{ target: zeroAddress, value: 0n, data: "0x" as Hex }];
    const zeroTarget = await signSponsoredRequest({ calls: zeroTargetCalls });
    await assert.rejects(
      router.write.executeSponsored([zeroTarget.request, zeroTargetCalls, zeroTarget.signature]),
      /InvalidTarget/,
    );

    const failingCalls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "fail", args: ["0x1234"] }),
      },
    ];
    const failing = await signSponsoredRequest({ calls: failingCalls });
    await assert.rejects(router.write.executeSponsored([failing.request, failingCalls, failing.signature]), /CallFailed/);
  });

  it("blocks reentrant account entry points without consuming another sponsored nonce", async function () {
    const { account, accountAddress, reentrantTarget, router, signSponsoredRequest } = await fixture();
    const calls = [
      {
        target: reentrantTarget.address,
        value: 0n,
        data: encodeFunctionData({
          abi: reentrantTarget.abi,
          functionName: "attemptAccountEntryPoints",
          args: [accountAddress],
        }),
      },
    ];
    const { request, signature } = await signSponsoredRequest({ calls });

    await router.write.executeSponsored([request, calls, signature]);

    assert.equal(await reentrantTarget.read.sponsoredEntryBlocked(), true);
    assert.equal(await reentrantTarget.read.selfEntryBlocked(), true);
    assert.equal(await account.read.getNonce(), 1n);
  });

  it("implements ERC-1271 signature checks", async function () {
    const { account, mockTarget, signSponsoredRequest } = await fixture();
    const calls = [
      {
        target: mockTarget.address,
        value: 0n,
        data: encodeFunctionData({ abi: mockTarget.abi, functionName: "setValue", args: [1n] }),
      },
    ];
    const { request, signature } = await signSponsoredRequest({ calls });
    const digest = await account.read.getSponsoredCallDigest([request]);

    assert.equal(await account.read.isValidSignature([digest, signature]), "0x1626ba7e");
    assert.equal(await account.read.isValidSignature([keccak256("0x1234"), signature]), "0xffffffff");
  });
});
