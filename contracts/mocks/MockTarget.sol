// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockTarget {
    uint256 public value;
    string public text;
    address public lastSender;
    uint256 public lastValue;

    event ValueSet(address indexed sender, uint256 value, uint256 ethValue);
    event TextSet(address indexed sender, string text);

    error MockFailure(bytes data);

    function setValue(uint256 newValue) external payable returns (uint256) {
        value = newValue;
        lastSender = msg.sender;
        lastValue = msg.value;

        emit ValueSet(msg.sender, newValue, msg.value);

        return newValue;
    }

    function setText(string calldata newText) external {
        text = newText;
        lastSender = msg.sender;

        emit TextSet(msg.sender, newText);
    }

    function fail(bytes calldata data) external pure {
        revert MockFailure(data);
    }
}
