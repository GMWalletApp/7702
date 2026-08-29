// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library Types {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    struct SponsoredCall {
        address account;
        uint256 nonce;
        uint256 deadline;
        address sponsor;
        address feeToken;
        uint256 gasFeeAmount;
        uint256 serviceFeeAmount;
        address feeReceiver;
        bytes32 callsHash;
    }

    struct FeePolicy {
        uint256 maxGasFeeAmount;
        uint256 maxServiceFeeAmount;
        uint256 maxTotalFeeAmount;
        uint256 maxCalls;
    }
}
