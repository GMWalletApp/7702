// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Types} from "../types/Types.sol";

interface ISponsorRouter {
    event SponsoredCallForwarded(address indexed account, address indexed sponsor, bytes32 callsHash);

    function executeSponsored(
        Types.SponsoredCall calldata request,
        Types.Call[] calldata calls,
        bytes calldata userSignature
    ) external payable returns (bytes[] memory returnData);
}
