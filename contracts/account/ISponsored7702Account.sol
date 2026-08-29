// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Types} from "../types/Types.sol";

interface ISponsored7702Account is IERC1271 {
    event SponsoredExecuted(address indexed account, address indexed sponsor, uint256 indexed nonce, bytes32 callsHash);
    event SelfExecuted(address indexed account, bytes32 callsHash);
    event CallExecuted(
        address indexed account,
        uint256 indexed index,
        address indexed target,
        uint256 value,
        bytes returnData
    );
    event NonceUsed(address indexed account, uint256 indexed nonce);
    event FeePaid(
        address indexed account,
        address indexed sponsor,
        address indexed feeToken,
        address feeReceiver,
        uint256 gasFeeAmount,
        uint256 serviceFeeAmount,
        uint256 totalFeeAmount
    );

    function executeFromSelf(Types.Call[] calldata calls) external payable returns (bytes[] memory returnData);

    function executeSponsoredFromRouter(
        Types.SponsoredCall calldata request,
        Types.Call[] calldata calls,
        bytes calldata userSignature,
        address sponsor
    ) external payable returns (bytes[] memory returnData);

    function getNonce() external view returns (uint256);

    function getSponsoredCallDigest(Types.SponsoredCall calldata request) external view returns (bytes32);
}
