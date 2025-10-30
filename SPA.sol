// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";


contract SecondPriceAuction is Ownable, IERC721Receiver {
    address payable public seller;
    address payable public topBidder;
    uint256 public topBid;
    uint256 public secondTopBid;
    uint256 public reservePrice;
    uint256 public auctionEndTime;
    uint256 public itemTokenId;
    address public itemContractAddress;
    bool public auctionOver;
    mapping(address => uint256) public pendingReturns;


    constructor(uint256 _reservePrice, uint256 _auctionEndTime, address _itemContractAddress) Ownable(msg.sender) {
        require(_auctionEndTime > block.timestamp, "Auction end time must be in the future.");
        seller = payable(msg.sender);
        topBidder = payable(msg.sender);
        topBid = 0;
        secondTopBid = 0;
        reservePrice = _reservePrice;
        auctionEndTime = _auctionEndTime;
        itemContractAddress = _itemContractAddress;
        auctionOver = false;
        _transferOwnership(seller);
    }

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external override returns (bytes4) {
        require(msg.sender == itemContractAddress, "Item not from correct contract.");
        require(IERC721(msg.sender).ownerOf(tokenId) == seller, "Item must belong to seller.");
        require(operator == seller, "Only seller can post an item for auction.");
        require(itemTokenId == 0, "Item already posted for auction.");
        itemTokenId = tokenId;
        itemContractAddress = msg.sender;
        return IERC721Receiver.onERC721Received.selector;
    }

    function end_auction() external {
        // anyone can end after auctionEndTime
        require(!auctionOver, "Auction already over.");
        require(msg.sender == seller || block.timestamp > auctionEndTime, "Auction is not terminable yet.");
        auctionOver = true;
        if (itemTokenId == 0) {
            pendingReturns[topBidder] += topBid;
        }
        else if (topBid < reservePrice) {
            pendingReturns[topBidder] += topBid;
            IERC721(itemContractAddress).safeTransferFrom(address(this), seller, itemTokenId);
        }
        else{
            pendingReturns[seller] += topBid;
            IERC721(itemContractAddress).safeTransferFrom(address(this), topBidder, itemTokenId);
        }    
    }

    function placeBid() external payable { 
        require(!auctionOver, "Auction is over.");
        require(msg.value >= topBid, "Bid too low.");
        pendingReturns[topBidder] += topBid;
        topBidder = payable(msg.sender);
        secondTopBid = topBid;
        topBid = msg.value;
    }

    function getRefund() external {
        require(pendingReturns[msg.sender] > 0, "No refund due");
        uint256 refund = pendingReturns[msg.sender];
        pendingReturns[msg.sender] = 0;
        payable(msg.sender).transfer(refund);
    }
}