// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Types} from "../types/Types.sol";

library CallHashLib {
    bytes32 internal constant CALL_TYPEHASH = keccak256("Call(address target,uint256 value,bytes32 dataHash)");

    function hashCall(Types.Call calldata call_) internal pure returns (bytes32) {
        return keccak256(abi.encode(CALL_TYPEHASH, call_.target, call_.value, keccak256(call_.data)));
    }

    function hashCalls(Types.Call[] calldata calls) internal pure returns (bytes32) {
        bytes32[] memory callHashes = new bytes32[](calls.length);

        for (uint256 i = 0; i < calls.length; ++i) {
            callHashes[i] = hashCall(calls[i]);
        }

        return keccak256(abi.encodePacked(callHashes));
    }
}
