// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ISponsorPolicyRegistry} from "./ISponsorPolicyRegistry.sol";
import {Errors} from "../errors/Errors.sol";
import {Types} from "../types/Types.sol";

contract SponsorPolicyRegistry is Ownable2Step, Pausable, ISponsorPolicyRegistry {
    mapping(address sponsor => bool allowed) private _sponsors;
    mapping(address token => bool supported) private _supportedFeeTokens;

    address private _feeReceiver;
    address private _router;
    Types.FeePolicy private _feePolicy;

    constructor(address initialOwner, address initialFeeReceiver) Ownable(initialOwner) {
        if (initialFeeReceiver == address(0)) {
            revert Errors.ZeroAddress();
        }

        _feeReceiver = initialFeeReceiver;
        emit FeeReceiverUpdated(initialFeeReceiver);
    }

    function isSponsor(address sponsor) external view returns (bool) {
        return _sponsors[sponsor];
    }

    function isSupportedFeeToken(address token) external view returns (bool) {
        return _supportedFeeTokens[token];
    }

    function feeReceiver() external view returns (address) {
        return _feeReceiver;
    }

    function router() external view returns (address) {
        return _router;
    }

    function feePolicy() external view returns (Types.FeePolicy memory) {
        return _feePolicy;
    }

    function paused() public view override(Pausable, ISponsorPolicyRegistry) returns (bool) {
        return super.paused();
    }

    function setSponsor(address sponsor, bool allowed) external onlyOwner {
        if (sponsor == address(0)) {
            revert Errors.ZeroAddress();
        }

        _sponsors[sponsor] = allowed;
        emit SponsorUpdated(sponsor, allowed);
    }

    function setSupportedFeeToken(address token, bool supported) external onlyOwner {
        if (token == address(0)) {
            revert Errors.ZeroAddress();
        }

        _supportedFeeTokens[token] = supported;
        emit FeeTokenUpdated(token, supported);
    }

    function setFeeReceiver(address receiver) external onlyOwner {
        if (receiver == address(0)) {
            revert Errors.ZeroAddress();
        }

        _feeReceiver = receiver;
        emit FeeReceiverUpdated(receiver);
    }

    function setRouter(address router_) external onlyOwner {
        if (router_ == address(0) || router_.code.length == 0) {
            revert Errors.InvalidRouter();
        }

        _router = router_;
        emit RouterUpdated(router_);
    }

    function setFeePolicy(Types.FeePolicy calldata policy) external onlyOwner {
        _feePolicy = policy;
        emit FeePolicyUpdated(
            policy.maxGasFeeAmount,
            policy.maxServiceFeeAmount,
            policy.maxTotalFeeAmount,
            policy.maxCalls
        );
    }

    function validateFee(
        address feeToken,
        address feeReceiver_,
        uint256 gasFeeAmount,
        uint256 serviceFeeAmount
    ) external view {
        if (paused()) {
            revert Errors.PolicyPaused();
        }

        Types.FeePolicy memory policy = _feePolicy;
        if (gasFeeAmount > policy.maxGasFeeAmount) {
            revert Errors.GasFeeTooHigh();
        }
        if (serviceFeeAmount > policy.maxServiceFeeAmount) {
            revert Errors.ServiceFeeTooHigh();
        }

        uint256 totalFeeAmount = gasFeeAmount + serviceFeeAmount;
        if (totalFeeAmount > policy.maxTotalFeeAmount) {
            revert Errors.TotalFeeTooHigh();
        }
        if (totalFeeAmount == 0) {
            return;
        }
        if (feeToken == address(0)) {
            revert Errors.InvalidFeeToken();
        }
        if (!_supportedFeeTokens[feeToken]) {
            revert Errors.UnsupportedFeeToken();
        }
        if (feeReceiver_ != _feeReceiver) {
            revert Errors.InvalidFeeReceiver();
        }
    }

    function validateCallCount(uint256 callCount) external view {
        if (paused()) {
            revert Errors.PolicyPaused();
        }

        uint256 maxCalls = _feePolicy.maxCalls;
        if (maxCalls != 0 && callCount > maxCalls) {
            revert Errors.TooManyCalls();
        }
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
