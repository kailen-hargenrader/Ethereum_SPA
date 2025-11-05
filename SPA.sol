// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";


/*
AUCTION PROCESS

1. Auction is posted by seller with required reserve price above zero. 
The auction has two stages, commit and reveal, with specified times for the stages.
Seller pays transition fees into contract.

NOTE: NFT must be transfered to contract separately from constructor. 
This means that bids can be placed without the item being known. Interesting, but not an issue since tokenID is public.

WHY: Reserve price must be above zero to prevent griefing. Otherwise, attackers could flood the commitments.
The times for the stages must be specified so that the auction is fair to bidders.

2. Bidders begin committing. When bidders commit, they must pay the reserve price up front.
Then they submit a hash of the amount above the reserve that they want to bid in addition to random salt.
Bidders must commit before the specified commit end time.
If bidders commit multiple times, they burn the reserve prices of outdated bids.

WHY: Bidders pay the reserve price up front to prevent griefing, same reason that changing bids burns previous reserve.
Bidders submit a hashed bid with salt to protect privacy.
Bidders must commit before specified commit end time. This prevents DoS attacks on the next call to change 
from commit to reveal stage.

3. After commit end time, anyone can call the switch to reveal stage. Gets paid commit reveal transition fee. 

WHY: Fairness. The end time is set, so delays between commit and reveal stage would affect bidders.
Fee encourages the auction to keep going.

4. Bidders reveal their bids. They must reveal before the specified reveal end time.
To reveal, bidders announce their bid (sent bid to contract also) and salt, whose hash is verified.
Once, bid is verified. Update top bid and second top bid.
Don't refund here, let bidder pull refund.

WHY: Bidders reveal their own bids so that they burn their own gas.
The top bid and second top bid are updated in real time. If a bidder
sees that they are outbid, then they never have to waste gas revealing their bid. However, if they don't reveal their bid
then they lose the reserve. To ensure fairness, the reserve price should be high enough that all bidders are incentivized to reveal.
refunding in reveal allows reentrancy attacks, which is why we use checks and effects.
Earliest reveal wins ties for simplicity and to encourage early reveals.

5. After reveal end time, anyone can call end auction. Caller gets paid reveal end transition fee.

WHY: Fairness, ensures transfer of NFT can occur.
Encourages auction to keep going.

6. Bidders can pull refunds. Seller can pull earnings. Top bidder can pull NFT.
Set refund value to zero before issuing refund to prevent reentrancy attacks.
Set itemTokenID to zero before issuing NFT to prevent reentrancy attacks.

WHY: Checks and effects.
*/

// Events
event NFTPosted(address indexed seller, uint256 indexed tokenId);
event BidCommitted(address indexed bidder, bytes32 hashedBid);
event TransitionToReveal(address indexed caller);
event BidRevealed(address indexed bidder, uint256 bid, uint256 salt, uint256 topBid, uint256 secondTopBid);
event TransitionToEnd(address indexed caller);
event RefundClaimed(address indexed bidder, uint256 amount);
event NFTClaimed(address indexed bidder, uint256 tokenId);
event NFTClaimedBack(address indexed seller, uint256 tokenId);

// SPA
contract SecondPriceAuction is IERC721Receiver {
    address payable public seller;
    address payable public topBidder;
    uint256 public topBid;
    uint256 public secondTopBid;
    uint256 public reservePrice;
    uint256 public auctionRevealTime;
    uint256 public auctionEndTime;
    uint256 public commitRevealTransitionFee;
    uint256 public revealEndTransitionFee;
    uint256 public noPostingFee;
    uint256 public itemTokenId;
    address public itemContractAddress;
    bool public ownsNFT;
    bool public commit;
    bool public reveal;
    bool public auctionOver;
    mapping(address => bytes32) public bidSaltHashes;
    mapping(address => uint256) public pendingReturns;


    constructor(
        address _seller,
        uint256 _reservePrice, 
        uint256 _auctionRevealTime,
        uint256 _auctionEndTime,
        uint256 _commitRevealTransitionFee,
        uint256 _revealEndTransitionFee,
        uint256 _noPostingFee,
        address _itemContractAddress
    ) payable {
        require(_reservePrice > 0, "Reserve price must be greater than zero to prevent griefing attacks.");
        require(_auctionRevealTime > block.timestamp, "Auction has no commit stage.");
        require(_auctionEndTime > _auctionRevealTime, "Auction has no reveal stage.");
        require(msg.value == _commitRevealTransitionFee + _revealEndTransitionFee + _noPostingFee, "Fee value must be included in contract.");
        seller = payable(_seller);
        reservePrice = _reservePrice;
        auctionRevealTime = _auctionRevealTime;
        auctionEndTime = _auctionEndTime;
        commitRevealTransitionFee = _commitRevealTransitionFee;
        revealEndTransitionFee = _revealEndTransitionFee;
        noPostingFee = _noPostingFee;
        itemContractAddress = _itemContractAddress;
        ownsNFT = false;
        commit = true;
        reveal = false;
        auctionOver = false;
    }

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external override returns (bytes4) {
        require(!auctionOver, "Too late to post!");
        require(msg.sender == itemContractAddress, "Item not from correct contract.");
        require(from == seller, "Item must belong to seller.");
        require(operator == seller, "Only seller can post an item for auction.");
        require(!ownsNFT, "Item already posted for auction.");
        itemTokenId = tokenId;
        ownsNFT = true;
        pendingReturns[seller] += noPostingFee;

        // clear previous approvals
        // IERC721(itemContractAddress).approve(address(0), tokenId);
        emit NFTPosted(seller, tokenId);
        return IERC721Receiver.onERC721Received.selector;
    }

    function placeBid(bytes32 hashedBidSalt) external payable {
        require(commit, "Not in commit stage.");
        require(msg.value == reservePrice, "Reserve price must be paid upfront.");
        bidSaltHashes[msg.sender] = hashedBidSalt;
        emit BidCommitted(msg.sender, hashedBidSalt);
    }

    function transitionToReveal() external{
        require(commit && block.timestamp > auctionRevealTime, "Not time for reveal stage or already in reveal stage.");
        commit = false;
        reveal = true;
        pendingReturns[msg.sender] += commitRevealTransitionFee;
        emit TransitionToReveal(msg.sender);
    }

    function revealBid(uint256 bid, uint256 salt) external payable{
        require(reveal, "Not in reveal stage.");
        require(bidSaltHashes[msg.sender] != bytes32(0), "No committed bid");
        require(msg.value == bid, "Bid value must match.");
        require(keccak256(abi.encodePacked(bid, salt)) == bidSaltHashes[msg.sender], "Reveal does not match bid.");
        if (topBidder == address(0) && bid >= reservePrice) {
            topBid = bid;
            topBidder = payable(msg.sender);
            
        }
        else if (bid > topBid) {
            pendingReturns[topBidder] += topBid + reservePrice;
            secondTopBid = topBid;
            topBid = bid;
            topBidder = payable(msg.sender);
            
        }
        else {
            pendingReturns[msg.sender] += bid + reservePrice;
        }
        bidSaltHashes[msg.sender] = bytes32(0);
        emit BidRevealed(msg.sender, bid, salt, topBid, secondTopBid);
    }

    function transitionToEnd() external {
        require(reveal && block.timestamp > auctionEndTime, "Not time for end stage or already in end stage.");
        reveal = false;
        auctionOver = true;
        pendingReturns[msg.sender] += revealEndTransitionFee;
        if (ownsNFT){
            if (topBidder != address(0)) {
                pendingReturns[topBidder] += topBid - secondTopBid;
                pendingReturns[seller] += secondTopBid + reservePrice;
            } else {
                topBidder = seller;
            }
        } else {
            if (topBidder != address(0)) {
                uint256 refundAmount = topBid + reservePrice + noPostingFee;
                pendingReturns[topBidder] += refundAmount;
            }
        }
        emit TransitionToEnd(msg.sender);
    }

    function getRefund() external {
        require(pendingReturns[msg.sender] > 0, "No refund due.");
        uint256 refund = pendingReturns[msg.sender];
        pendingReturns[msg.sender] = 0;
        payable(msg.sender).transfer(refund);
        emit RefundClaimed(msg.sender, refund);
    }

    function getNFT() external {
        require(auctionOver, "Auction not over yet.");
        require(ownsNFT, "NFT not owned by contract.");
        require(msg.sender == topBidder, "NFT not owed.");

        ownsNFT = false;

        IERC721(itemContractAddress).transferFrom(address(this), topBidder, itemTokenId);
        emit NFTClaimed(msg.sender, itemTokenId);
    }
}