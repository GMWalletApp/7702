// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISponsored7702Account} from "./ISponsored7702Account.sol";
import {ISponsorPolicyRegistry} from "../policy/ISponsorPolicyRegistry.sol";
import {Errors} from "../errors/Errors.sol";
import {CallHashLib} from "../libraries/CallHashLib.sol";
import {SignatureLib} from "../libraries/SignatureLib.sol";
import {Types} from "../types/Types.sol";

contract Sponsored7702Account is EIP712, ISponsored7702Account {
    using CallHashLib for Types.Call[];
    using SafeERC20 for IERC20;

    bytes4 internal constant ERC1271_MAGICVALUE = 0x1626ba7e;
    bytes4 internal constant ERC1271_INVALID = 0xffffffff;

    bytes32 public constant SPONSORED_CALL_TYPEHASH = keccak256(
        "SponsoredCall(address account,uint256 nonce,uint256 deadline,address sponsor,address feeToken,uint256 gasFeeAmount,uint256 serviceFeeAmount,address feeReceiver,bytes32 callsHash)"
    );
    bytes32 private constant ACCOUNT_STORAGE_LOCATION =
        0x88925b974227fac3545917acf2ff1490142a294cee7612791c3dc8128e942e00;

    ISponsorPolicyRegistry public immutable policyRegistry;

    struct AccountStorage {
        uint256 nonce;
    }

    constructor(address policyRegistry_) EIP712("Sponsored7702Account", "1") {
        if (policyRegistry_ == address(0) || policyRegistry_.code.length == 0) {
            revert Errors.InvalidPolicyRegistry();
        }

        policyRegistry = ISponsorPolicyRegistry(policyRegistry_);
    }

    receive() external payable {}

    function executeFromSelf(Types.Call[] calldata calls) external payable returns (bytes[] memory returnData) {
        if (msg.sender != address(this)) {
            revert Errors.SelfCallOnly();
        }

        bytes32 callsHash = calls.hashCalls();
        returnData = _executeBatch(calls);

        emit SelfExecuted(address(this), callsHash);
    }

    function executeSponsoredFromRouter(
        Types.SponsoredCall calldata request,
        Types.Call[] calldata calls,
        bytes calldata userSignature,
        address sponsor
    ) external payable returns (bytes[] memory returnData) {
        if (msg.sender != policyRegistry.router()) {
            revert Errors.NotRouter();
        }
        if (calls.length == 0) {
            revert Errors.EmptyCalls();
        }
        if (request.account != address(this)) {
            revert Errors.InvalidAccount();
        }
        if (request.sponsor != sponsor) {
            revert Errors.InvalidSponsor();
        }
        policyRegistry.validateCallCount(calls.length);
        if (request.callsHash != calls.hashCalls()) {
            revert Errors.InvalidSignature();
        }

        policyRegistry.validateFee(
            request.feeToken,
            request.feeReceiver,
            request.gasFeeAmount,
            request.serviceFeeAmount
        );

        returnData = _executeSponsored(request, calls, userSignature, sponsor);
    }

    function getNonce() external view returns (uint256) {
        return _accountStorage().nonce;
    }

    function getSponsoredCallDigest(Types.SponsoredCall calldata request) external view returns (bytes32) {
        return _hashSponsoredCall(request);
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4 magicValue) {
        if (SignatureLib.isValidSigner(hash, signature, address(this))) {
            return ERC1271_MAGICVALUE;
        }

        return ERC1271_INVALID;
    }

    function _executeSponsored(
        Types.SponsoredCall calldata request,
        Types.Call[] calldata calls,
        bytes calldata userSignature,
        address sponsor
    ) internal returns (bytes[] memory returnData) {
        AccountStorage storage accountStorage = _accountStorage();
        uint256 currentNonce = accountStorage.nonce;
        if (request.nonce != currentNonce) {
            revert Errors.InvalidNonce();
        }
        if (request.deadline < block.timestamp) {
            revert Errors.SignatureExpired();
        }

        bytes32 digest = _hashSponsoredCall(request);
        if (!SignatureLib.isValidSigner(digest, userSignature, address(this))) {
            revert Errors.InvalidSignature();
        }

        accountStorage.nonce = currentNonce + 1;
        emit NonceUsed(address(this), currentNonce);

        _paySponsorFee(request);
        returnData = _executeBatch(calls);

        emit SponsoredExecuted(address(this), sponsor, currentNonce, request.callsHash);
    }

    function _executeBatch(Types.Call[] calldata calls) internal returns (bytes[] memory returnData) {
        if (calls.length == 0) {
            revert Errors.EmptyCalls();
        }

        returnData = new bytes[](calls.length);
        for (uint256 i = 0; i < calls.length; ++i) {
            Types.Call calldata call_ = calls[i];
            if (call_.target == address(0)) {
                revert Errors.InvalidTarget();
            }

            (bool success, bytes memory result) = call_.target.call{value: call_.value}(call_.data);
            if (!success) {
                revert Errors.CallFailed(i, result);
            }

            returnData[i] = result;
            emit CallExecuted(address(this), i, call_.target, call_.value, result);
        }
    }

    function _hashSponsoredCall(Types.SponsoredCall calldata request) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                SPONSORED_CALL_TYPEHASH,
                request.account,
                request.nonce,
                request.deadline,
                request.sponsor,
                request.feeToken,
                request.gasFeeAmount,
                request.serviceFeeAmount,
                request.feeReceiver,
                request.callsHash
            )
        );

        return _hashTypedDataV4(structHash);
    }

    function _paySponsorFee(Types.SponsoredCall calldata request) internal {
        uint256 totalFeeAmount = request.gasFeeAmount + request.serviceFeeAmount;
        if (totalFeeAmount == 0) {
            return;
        }

        if (!IERC20(request.feeToken).trySafeTransfer(request.feeReceiver, totalFeeAmount)) {
            revert Errors.FeePaymentFailed();
        }

        emit FeePaid(
            address(this),
            request.sponsor,
            request.feeToken,
            request.feeReceiver,
            request.gasFeeAmount,
            request.serviceFeeAmount,
            totalFeeAmount
        );
    }

    function _accountStorage() internal pure returns (AccountStorage storage accountStorage) {
        bytes32 location = ACCOUNT_STORAGE_LOCATION;
        assembly {
            accountStorage.slot := location
        }
    }
}
