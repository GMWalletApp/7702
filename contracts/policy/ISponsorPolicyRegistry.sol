// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Types} from "../types/Types.sol";

interface ISponsorPolicyRegistry {
    event SponsorUpdated(address indexed sponsor, bool allowed);
    event FeeTokenUpdated(address indexed token, bool supported);
    event FeeReceiverUpdated(address indexed receiver);
    event RouterUpdated(address indexed router);
    event FeePolicyUpdated(
        uint256 maxGasFeeAmount,
        uint256 maxServiceFeeAmount,
        uint256 maxTotalFeeAmount,
        uint256 maxCalls
    );

    function isSponsor(address sponsor) external view returns (bool);

    function isSupportedFeeToken(address token) external view returns (bool);

    function feeReceiver() external view returns (address);

    function router() external view returns (address);

    function feePolicy() external view returns (Types.FeePolicy memory);

    function paused() external view returns (bool);

    function setSponsor(address sponsor, bool allowed) external;

    function setSupportedFeeToken(address token, bool supported) external;

    function setFeeReceiver(address receiver) external;

    function setRouter(address router_) external;

    function setFeePolicy(Types.FeePolicy calldata policy) external;

    function validateFee(
        address feeToken,
        address feeReceiver_,
        uint256 gasFeeAmount,
        uint256 serviceFeeAmount
    ) external view;

    function validateCallCount(uint256 callCount) external view;

    function pause() external;

    function unpause() external;
}
