// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockNoReturnERC20 {
    string public constant name = "Mock No Return Token";
    string public constant symbol = "MNRT";
    uint8 public constant decimals = 18;

    mapping(address account => uint256 balance) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external {
        uint256 senderBalance = balanceOf[msg.sender];
        require(senderBalance >= amount, "insufficient balance");

        unchecked {
            balanceOf[msg.sender] = senderBalance - amount;
        }
        balanceOf[to] += amount;

        emit Transfer(msg.sender, to, amount);
    }
}
