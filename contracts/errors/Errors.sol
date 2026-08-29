// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library Errors {
    error NotSponsor();
    error InvalidSponsor();
    error InvalidAccount();
    error InvalidNonce();
    error SignatureExpired();
    error InvalidSignature();
    error EmptyCalls();
    error InvalidTarget();
    error CallFailed(uint256 index, bytes returnData);
    error ZeroAddress();
    error Unauthorized();
    error InvalidFeeToken();
    error UnsupportedFeeToken();
    error InvalidFeeReceiver();
    error FeePaymentFailed();
    error SelfCallOnly();
    error InvalidPolicyRegistry();
    error PolicyPaused();
    error NotRouter();
    error InvalidRouter();
    error AccountNotDelegated();
    error UnexpectedNativeValue();
    error GasFeeTooHigh();
    error ServiceFeeTooHigh();
    error TotalFeeTooHigh();
    error TooManyCalls();
}
