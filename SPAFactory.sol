// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { SecondPriceAuction } from "./SPA.sol";

event AuctionCreated(address indexed auctionAddress, address indexed seller, uint256 reservePrice);

//Factory
contract SecondPriceAuctionFactory {
    address[] public allAuctions;

    function createAuction(
        uint256 _reservePrice,
        uint256 _auctionRevealTime,
        uint256 _auctionEndTime,
        uint256 _commitRevealTransitionFee,
        uint256 _revealEndTransitionFee,
        uint256 _noPostingFee,
        address _itemContractAddress
    ) external payable returns (address) {
        require(_reservePrice > 0, "Reserve must be > 0");
        require(_auctionRevealTime > block.timestamp, "Invalid reveal time");
        require(_auctionEndTime > _auctionRevealTime, "Invalid end time");
        require(msg.value == _commitRevealTransitionFee + _revealEndTransitionFee + _noPostingFee, "Fee mismatch");

        SecondPriceAuction newAuction = new SecondPriceAuction{value: msg.value}(
            msg.sender,
            _reservePrice,
            _auctionRevealTime,
            _auctionEndTime,
            _commitRevealTransitionFee,
            _revealEndTransitionFee,
            _noPostingFee,
            _itemContractAddress
        );

        allAuctions.push(address(newAuction));
        emit AuctionCreated(address(newAuction), msg.sender, _reservePrice);
        return address(newAuction);
    }

    function getAllAuctions() external view returns (address[] memory) {
        return allAuctions;
    }
}