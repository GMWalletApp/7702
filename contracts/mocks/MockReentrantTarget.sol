// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISponsored7702Account} from "../account/ISponsored7702Account.sol";
import {Types} from "../types/Types.sol";

contract MockReentrantTarget {
    bool public sponsoredEntryBlocked;
    bool public selfEntryBlocked;

    function attemptAccountEntryPoints(address account) external {
        Types.Call[] memory emptyCalls = new Types.Call[](0);
        Types.SponsoredCall memory emptyRequest;

        try ISponsored7702Account(account).executeSponsoredFromRouter(
            emptyRequest,
            emptyCalls,
            "",
            address(this)
        ) returns (bytes[] memory) {
            sponsoredEntryBlocked = false;
        } catch {
            sponsoredEntryBlocked = true;
        }

        try ISponsored7702Account(account).executeFromSelf(emptyCalls) returns (bytes[] memory) {
            selfEntryBlocked = false;
        } catch {
            selfEntryBlocked = true;
        }
    }
}
