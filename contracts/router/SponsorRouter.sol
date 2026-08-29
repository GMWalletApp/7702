// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISponsored7702Account} from "../account/ISponsored7702Account.sol";
import {Errors} from "../errors/Errors.sol";
import {ISponsorPolicyRegistry} from "../policy/ISponsorPolicyRegistry.sol";
import {Types} from "../types/Types.sol";
import {ISponsorRouter} from "./ISponsorRouter.sol";

contract SponsorRouter is ISponsorRouter {
    ISponsorPolicyRegistry public immutable policyRegistry;

    constructor(address policyRegistry_) {
        if (policyRegistry_ == address(0) || policyRegistry_.code.length == 0) {
            revert Errors.InvalidPolicyRegistry();
        }

        policyRegistry = ISponsorPolicyRegistry(policyRegistry_);
    }

    function executeSponsored(
        Types.SponsoredCall calldata request,
        Types.Call[] calldata calls,
        bytes calldata userSignature
    ) external payable returns (bytes[] memory returnData) {
        if (msg.value != 0) {
            revert Errors.UnexpectedNativeValue();
        }
        if (!policyRegistry.isSponsor(msg.sender)) {
            revert Errors.NotSponsor();
        }
        if (request.sponsor != msg.sender) {
            revert Errors.InvalidSponsor();
        }
        if (request.account.code.length == 0) {
            revert Errors.AccountNotDelegated();
        }

        policyRegistry.validateFee(
            request.feeToken,
            request.feeReceiver,
            request.gasFeeAmount,
            request.serviceFeeAmount
        );

        returnData = ISponsored7702Account(request.account).executeSponsoredFromRouter(
            request,
            calls,
            userSignature,
            msg.sender
        );

        emit SponsoredCallForwarded(request.account, msg.sender, request.callsHash);
    }
}
